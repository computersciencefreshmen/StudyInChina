import { createHash, webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { discoverAdmissionCycles, parseDiscoveredCycles, type CycleModelRunner } from '../../workers/catalog-maintenance/src/cycle-discovery'
import type { CapturedSnapshot } from '../../workers/catalog-maintenance/src/capture'
import type { JobRow, MaintenanceEnv, ModelRequest, SourceRow } from '../../workers/catalog-maintenance/src/types'
import type { MaintenanceRecordTarget } from '../../scripts/maintenance/field-contracts'

beforeAll(() => { vi.stubGlobal('crypto', webcrypto) })
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const url = 'https://example.edu.cn/programme-notice', sourceId = hash(url)
function cycle(programId = 'program-cs', name = 'Computer Science') {
  const dates = 'Application opens 2027-11-01; application deadline 2028-04-30.'
  return { programId, academicYear: '2028-2029', intake: 'autumn' as const, programQuote: `Master ${name}.`,
    internationalQuote: 'International students', cycleScopeQuote: `Autumn 2028 admissions for Master ${name}.`,
    patches: [{ fieldPath: 'opensOn', value: '2027-11-01', factStatus: 'known' as const, quote: dates },
      { fieldPath: 'closesOn', value: '2028-04-30', factStatus: 'known' as const, quote: dates },
      { fieldPath: 'dateStatus', value: 'published', factStatus: 'known' as const, quote: dates }] }
}
function notice(name = 'Computer Science') { return `International students: Master ${name}. Autumn 2028 admissions for Master ${name}. Application opens 2027-11-01; application deadline 2028-04-30.` }
function setup(text = notice()) {
  const objects = new Map<string, string>([['text.txt', text]])
  const env = { SNAPSHOTS_BUCKET: { get: async (key: string) => objects.has(key) ? { text: async () => objects.get(key)! } : null,
    put: async (key: string, value: string) => { objects.set(key, value) } } } as unknown as MaintenanceEnv
  const snapshot: CapturedSnapshot = { version: 1, sourceId, sourceUrl: url, finalUrl: url, checkedAt: '2026-10-24T00:00:00.000Z',
    contentType: 'text/plain', rawSha256: hash(text), rawKey: 'raw.bin', textKey: 'text.txt', textSha256: hash(text), canonicalSha256: hash(text), parserCandidates: [] }
  const target: MaintenanceRecordTarget = { recordId: 'program-cs', universityId: 'uni-fixture', entityType: 'program', sourceIds: [sourceId],
    recordScopeSha256: 'a'.repeat(64), identity: { name: { en: 'Computer Science' }, degreeLevel: 'master' }, year: null, intake: null,
    fields: {}, reviewAfter: '2026-10-24' }
  const row = { source_id: sourceId, url, allowed_hosts_json: JSON.stringify(['example.edu.cn']) } as SourceRow
  const job = { job_id: 'new-intake-fixture', source_id: sourceId, stage: 'maintain', snapshot_sha256: snapshot.rawSha256 } as JobRow
  return { env, snapshot, target, row, job, objects, text }
}
function model(output: (request: ModelRequest, count: number) => unknown = () => ({ cycles: [cycle()] })) {
  const requests: ModelRequest[] = []
  const runner: CycleModelRunner = async (_env, request) => { requests.push(request); return { attemptId: `${request.pass}:${request.reservationKey}`,
    output: output(request, requests.length), artifactKey: `model/${request.reservationKey}.json`, artifactSha256: hash(request.reservationKey), reused: requests.length > 2 } }
  return { runner, requests }
}

describe('independent discovery of new programme-specific intakes', () => {
  it('creates a new annual-cycle proposal with exact program scope and two independent extraction receipts', async () => {
    const f = setup(), m = model(), result = await discoverAdmissionCycles(f.env, f.job, f.row, f.snapshot, [f.target], m.runner)
    expect(result.held).toEqual([]); expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0]).toMatchObject({ entityType: 'admission-cycle', recordId: null, operation: 'create',
      scope: { year: '2028-2029', intake: 'autumn' }, fields: { programId: 'program-cs', programScopeSha256: 'a'.repeat(64) } })
    expect(m.requests).toHaveLength(2)
    expect(m.requests.every(request => request.recordIds?.includes('program-cs'))).toBe(true)
    expect(m.requests[1].payload).not.toContain('"cycles":[') // independent pass gets schema instructions, never the first answer
    const review = JSON.parse(f.objects.get(result.proposals[0].review!.artifactKey!)!)
    expect(review.agreedCycleFields).toEqual(result.proposals[0].fields)
    expect(review.cacheReuse).toEqual({ primary: false, secondary: false })
  })
  it('does not generalize a school-wide year or use the same name at another degree', () => {
    const f = setup(), generic = { ...cycle(), cycleScopeQuote: 'Autumn 2028 admissions' }
    expect(parseDiscoveredCycles({ cycles: [generic] }, f.text, [f.target], f.snapshot).size).toBe(0)
    expect(parseDiscoveredCycles({ cycles: [cycle()] }, f.text, [{ ...f.target, identity: { ...f.target.identity, degreeLevel: 'bachelor' } }], f.snapshot).size).toBe(0)
    expect(parseDiscoveredCycles({ cycles: [cycle('not-an-existing-program')] }, f.text, [f.target], f.snapshot).size).toBe(0)
  })
  it('holds same-name and same-degree ambiguous parent identities rather than guessing a program ID', () => {
    const f = setup(), duplicate = { ...f.target, recordId: 'ambiguous-program-copy' }
    expect(parseDiscoveredCycles({ cycles: [cycle()] }, f.text, [f.target, duplicate], f.snapshot).size).toBe(0)
  })
  it('requires independent date agreement before exposing a new cycle', async () => {
    const f = setup(), m = model((_request, count) => ({ cycles: count === 1 ? [cycle()] : [] }))
    const result = await discoverAdmissionCycles(f.env, f.job, f.row, f.snapshot, [f.target], m.runner)
    expect(result.proposals).toEqual([])
    expect(result.held).toContainEqual({ recordId: f.target.recordId, reason: 'new_cycle_independent_disagreement' })
  })
  it('rejects dates or money absent from original evidence even before the second model pass', async () => {
    const f = setup(), candidate = cycle(); candidate.patches[1].value = '2030-04-30'
    const m = model(() => ({ cycles: [candidate] }))
    expect((await discoverAdmissionCycles(f.env, f.job, f.row, f.snapshot, [f.target], m.runner)).proposals).toEqual([])
    expect(m.requests).toHaveLength(1)
  })
  it('holds overlarge/altered text and never silently truncates the catalogue', async () => {
    const large = setup(`${notice()}${' '.repeat(100001)}`), m = model()
    expect((await discoverAdmissionCycles(large.env, large.job, large.row, large.snapshot, [large.target], m.runner)).held[0].reason).toBe('new_cycle_large_source_requires_partition')
    const changed = setup(); changed.objects.set('text.txt', 'tampered')
    await expect(discoverAdmissionCycles(changed.env, changed.job, changed.row, changed.snapshot, [changed.target], m.runner)).rejects.toThrow('cycle_discovery_text_checksum_mismatch')
    expect(m.requests).toHaveLength(0)
  })
  it('keeps model reservations reusable for identical text but explicitly rebinds proof to current raw bytes', async () => {
    const f = setup(), m = model()
    await discoverAdmissionCycles(f.env, f.job, f.row, f.snapshot, [f.target], m.runner)
    const newHash = hash('cosmetic HTML byte change'), next = { ...f.snapshot, rawSha256: newHash, rawKey: 'new-raw.bin' }
    const result = await discoverAdmissionCycles(f.env, { ...f.job, snapshot_sha256: newHash }, f.row, next, [f.target], m.runner)
    expect(m.requests[0].reservationKey).toBe(m.requests[2].reservationKey)
    expect(m.requests[0].payload).toBe(m.requests[2].payload)
    expect(result.proposals[0].source.snapshotSha256).toBe(newHash)
    const review = JSON.parse(f.objects.get(result.proposals[0].review!.artifactKey!)!)
    expect(review.cacheReuse).toEqual({ primary: true, secondary: true })
  })
  it('does not retry an unknown model outcome or reuse the same attempt as independent review', async () => {
    const f = setup(), runner = vi.fn<CycleModelRunner>().mockRejectedValue(new Error('model_outcome_unknown'))
    await expect(discoverAdmissionCycles(f.env, f.job, f.row, f.snapshot, [f.target], runner)).rejects.toThrow('model_outcome_unknown')
    expect(runner).toHaveBeenCalledTimes(1)
    const sameAttempt: CycleModelRunner = async () => ({ attemptId: 'same-attempt', output: { cycles: [cycle()] }, artifactKey: 'model.json', artifactSha256: 'a'.repeat(64), reused: true })
    await expect(discoverAdmissionCycles(f.env, f.job, f.row, f.snapshot, [f.target], sameAttempt)).rejects.toThrow('new_cycle_independent_attempt_reused')
  })
})
