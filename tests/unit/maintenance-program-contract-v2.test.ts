import { createHash, webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { extractIdentities } from '../../workers/catalog-maintenance/src/extraction'
import type { CapturedSnapshot } from '../../workers/catalog-maintenance/src/capture'
import type { JobRow, MaintenanceEnv, ModelRequest, SchoolRow, SourceRow } from '../../workers/catalog-maintenance/src/types'
import { canonicalJson, type MaintenanceProposal } from '../../scripts/maintenance/contracts'

beforeAll(() => vi.stubGlobal('crypto', webcrypto))
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const url = 'https://example.edu.cn/international/catalogue', sourceId = hash(url)
const text = 'Example University offers bachelor programmes for international students. Majors: International Business, Accounting, Business Administration.'
const owner: SchoolRow = { university_id: 'uni-example', name_json: '{"en":"Example University"}', seed_json: '{}' }
function programme(name = 'Accounting') {
  return { universityId: owner.university_id, name: { en: name }, degreeLevel: 'bachelor', programType: 'degree', programUrl: url,
    evidence: { quote: name, locator: 'document' }, internationalEvidence: { quote: 'bachelor programmes for international students', locator: 'document' },
    fieldEvidence: [{ fieldPath: 'name.en', quote: name, locator: 'document' }, { fieldPath: 'degreeLevel', quote: 'bachelor programmes', locator: 'document' }] }
}
function fixture(options: { sourceText?: string; owners?: SchoolRow[]; pending?: number; canary?: string[]; blocked?: boolean } = {}) {
  const content = options.sourceText ?? text, rawSha = hash(content), key = `maintenance/snapshots/${sourceId}/${rawSha}.json`
  const snapshot: CapturedSnapshot = { version: 1, sourceId, sourceUrl: url, finalUrl: url, checkedAt: '2026-10-26T00:00:00.000Z',
    contentType: 'text/plain', rawSha256: rawSha, rawKey: 'raw.txt', textKey: 'text.txt', textSha256: rawSha, canonicalSha256: rawSha,
    parserCandidates: [{ kind: 'program', name: 'Accounting', degreeLevel: 'bachelor' }] }
  const objects = new Map<string, string>([[key, JSON.stringify(snapshot)], ['text.txt', content]])
  const requests: ModelRequest[] = [], proposals: MaintenanceProposal[] = [], priorChecks: unknown[][] = []
  let output: (request: ModelRequest) => unknown = () => ({ programs: [programme()] })
  const env = { SNAPSHOTS_BUCKET: { get: async (name: string) => objects.has(name) ? { text: async () => objects.get(name)!, size: objects.get(name)!.length } : null,
    put: async (name: string, value: string) => { objects.set(name, value) } },
  PIPELINE_DB: { prepare: (sql: string) => {
    let values: unknown[] = []
    const statement = { bind: (...args: unknown[]) => { values = args; return statement },
      first: async () => {
        if (sql.includes('maintenance_control')) return { canary_json: JSON.stringify(options.canary ?? []) }
        if (sql.includes('maintenance_model_attempts')) { priorChecks.push(values); return { count: options.pending ?? 0 } }
        return null
      }, all: async () => ({ results: options.owners ?? [owner] }),
      run: async () => { throw new Error('unexpected_nonatomic_write') },
      apply: () => {
        if (!sql.startsWith('INSERT OR IGNORE INTO maintenance_proposals(')) throw new Error('unexpected_batch_write')
        for (let offset = 0; offset < values.length; offset += 7) {
          const proposal = JSON.parse(String(values[offset + 5])) as MaintenanceProposal
          if (!proposals.some(existing => existing.id === proposal.id)) proposals.push(proposal)
        }
        return { success: true }
      } }
    return statement
  }, batch: async (statements: Array<{ apply(): unknown }>) => statements.map(statement => statement.apply()) },
  MODEL_ADMISSION: { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    const value = await request.json() as ModelRequest; requests.push(value)
    if (options.blocked) return Response.json({ ok: false, error: 'legacy_scope_stop_or_reservation' }, { status: 409 })
    return Response.json({ ok: true, attemptId: `fixture-${value.pass}`, output: output(value), artifactKey: `models/${value.reservationKey}.json`,
      artifactSha256: hash(value.payload), reused: false })
  } }) } } as unknown as MaintenanceEnv
  const row = { source_id: sourceId, url, allowed_hosts_json: '["example.edu.cn"]', category: 'masters_catalog' } as SourceRow
  const job = { source_id: sourceId, stage: 'extract', snapshot_key: key, snapshot_sha256: rawSha } as JobRow
  return { env, row, job, snapshot, requests, proposals, priorChecks, output: (factory: typeof output) => { output = factory } }
}

describe('explicit programme extraction contract v2', () => {
  it('keeps the complete v1 payload and reservation contract unchanged by default', async () => {
    const f = fixture(); await extractIdentities(f.env, f.job, f.row)
    const payload = JSON.parse(f.requests[0].payload)
    expect(payload).toEqual({ task: 'primary-official-international-program-identities', contractVersion: 1,
      instructions: expect.any(String), schools: [{ universityId: owner.university_id, name: { en: 'Example University' } }], sourceUrl: url,
      parserCandidates: f.snapshot.parserCandidates, SOURCE_TEXT: text })
    expect(hash(payload.instructions)).toBe('e8df585e506eef0733523d35f918ba93d875199eeca5e5fea94c1ef1d5fc1242')
    expect(f.requests[0].reservationKey).toBe(hash(`identity-v1:${sourceId}:${hash(f.requests[0].payload)}:primary`))
    expect(f.priorChecks).toEqual([])
  })

  it('provides trusted metadata, individual-programme guidance and two blind source-only passes', async () => {
    const f = fixture(); f.env.PROGRAM_EXTRACTION_CONTRACT_VERSION = '2'
    f.output(() => ({ programs: ['International Business', 'Accounting', 'Business Administration'].map(name => programme(name)) }))
    expect(await extractIdentities(f.env, f.job, f.row)).toEqual({ ready: 3, held: 0 })
    expect(f.requests).toHaveLength(2)
    const [primary, secondary] = f.requests.map(request => JSON.parse(request.payload))
    expect(primary.contractVersion).toBe(2)
    expect(primary.SOURCE_OWNED_METADATA).toEqual({ universityId: owner.university_id, programUrl: url, institutionName: { en: 'Example University' } })
    expect(primary.instructions).toContain('ONE individual')
    expect(primary.instructions).toContain('omit unsupported locales')
    expect(primary.instructions).toContain('Do not split an ambiguous comma-containing official title')
    expect(primary.OUTPUT_SCHEMA_EXAMPLE.programs[0]).toMatchObject({ universityId: owner.university_id, programUrl: url })
    expect(primary.SOURCE_TEXT).toBe(text)
    expect(secondary.SOURCE_TEXT).toBe(text)
    expect(secondary.task).toBe('independent-review-official-international-program-identities-v2')
    expect(Object.keys(secondary).sort()).toEqual(['CANDIDATE_HINTS', 'OUTPUT_SCHEMA_EXAMPLE', 'SOURCE_OWNED_METADATA', 'SOURCE_TEXT', 'contractVersion', 'instructions', 'sourceUrl', 'task'].sort())
    expect(f.requests[0].reservationKey).toBe(hash(`identity-v2:${sourceId}:${hash(f.requests[0].payload)}:primary`))
    expect(f.requests[1].reservationKey).toBe(hash(`identity-v2:${sourceId}:${hash(f.requests[1].payload)}:independent-review`))
    expect(f.proposals.every(proposal => Object.keys(proposal.fields).sort().join(',') === 'degreeLevel,internationalAdmissionsEvidence,name,programType,programUrl')).toBe(true)
  })

  it('does not turn repeated comma-joined clumps into independently reviewed programmes', async () => {
    const f = fixture(); f.env.PROGRAM_EXTRACTION_CONTRACT_VERSION = '2'
    f.output(() => ({ programs: [programme('International Business, Accounting, Business Administration')] }))
    expect(await extractIdentities(f.env, f.job, f.row)).toEqual({ ready: 0, held: 0 })
    expect(f.proposals).toEqual([])
  })

  it('holds real independent disagreements and keeps v2 candidate IDs separate from v1 history', async () => {
    const f = fixture(); await extractIdentities(f.env, f.job, f.row)
    const old = f.proposals[0], oldReservation = f.requests[0].reservationKey
    f.env.PROGRAM_EXTRACTION_CONTRACT_VERSION = '2'
    f.output(request => ({ programs: request.pass === 'primary' ? [programme()] : [] }))
    expect(await extractIdentities(f.env, f.job, f.row)).toEqual({ ready: 0, held: 1 })
    expect(f.proposals[0]).toBe(old)
    expect(f.proposals[1].id).not.toBe(old.id)
    expect(f.proposals[1].status).toBe('held')
    expect(f.requests[2].reservationKey).not.toBe(oldReservation)
  })

  it('does not use a new version prefix to repeat an unresolved request or escape a legacy guard', async () => {
    const unresolved = fixture({ pending: 1 }); unresolved.env.PROGRAM_EXTRACTION_CONTRACT_VERSION = '2'
    await expect(extractIdentities(unresolved.env, unresolved.job, unresolved.row)).rejects.toThrow('prior_model_outcome_requires_review')
    expect(unresolved.requests).toEqual([])
    expect(unresolved.priorChecks).toEqual([[sourceId, unresolved.snapshot.rawSha256]])
    const guarded = fixture({ blocked: true }); guarded.env.PROGRAM_EXTRACTION_CONTRACT_VERSION = '2'
    await expect(extractIdentities(guarded.env, guarded.job, guarded.row)).rejects.toThrow('legacy_scope_stop_or_reservation')
    expect(guarded.requests).toHaveLength(1)
  })

  it('requires the complete source owner mapping, even if the canary filters it down to one school', async () => {
    const f = fixture({ owners: [owner, { ...owner, university_id: 'uni-other' }], canary: [owner.university_id] })
    f.env.PROGRAM_EXTRACTION_CONTRACT_VERSION = '2'
    await expect(extractIdentities(f.env, f.job, f.row)).rejects.toThrow('program_source_requires_single_owner')
    expect(f.requests).toEqual([])
  })

  it('retains exact proof, explicit partition and configuration checks before issuing requests', async () => {
    const large = fixture({ sourceText: `${text}${' '.repeat(50001)}` }); large.env.PROGRAM_EXTRACTION_CONTRACT_VERSION = '2'
    await expect(extractIdentities(large.env, large.job, large.row)).rejects.toThrow('program_source_requires_explicit_partition')
    expect(large.requests).toEqual([])
    const invalid = fixture(); invalid.env.PROGRAM_EXTRACTION_CONTRACT_VERSION = 'future'
    await expect(extractIdentities(invalid.env, invalid.job, invalid.row)).rejects.toThrow('program_extraction_contract_version_invalid')
    expect(invalid.requests).toEqual([])
    const unproven = fixture(); unproven.env.PROGRAM_EXTRACTION_CONTRACT_VERSION = '2'
    unproven.output(() => ({ programs: [{ ...programme(), name: { en: 'Invented Degree' } }] }))
    expect(await extractIdentities(unproven.env, unproven.job, unproven.row)).toEqual({ ready: 0, held: 0 })
  })

  it('restricts model output to target rows even when another valid programme appears in context and binds cache keys to the exact partition', async () => {
    const sourceText = 'Example University offers bachelor programmes for international students.\nPrior row: International Business\nTarget row: Accounting\nOther row: Business Administration.'
    const f = fixture({ sourceText }); f.env.PROGRAM_EXTRACTION_CONTRACT_VERSION = '2'
    const contextEnd = sourceText.indexOf('Target row:')
    const content = { kind: 'program-identity-partition-v1', fullTextSha256: hash(sourceText), page: 1, rowNumbers: [2],
      contextRanges: [{ start: 0, end: contextEnd }], targetRanges: [{ start: sourceText.indexOf('Accounting'), end: sourceText.indexOf('Accounting') + 'Accounting'.length }] }
    const partition = { ...content, sha256: hash(canonicalJson(content)) }
    f.job.target_ids_json = canonicalJson(partition)
    f.output(() => ({ programs: [programme('International Business'), programme('Accounting')] }))
    expect(await extractIdentities(f.env, f.job, f.row)).toEqual({ ready: 1, held: 0 })
    expect(f.proposals.map(proposal => proposal.fields.name)).toEqual([{ en: 'Accounting' }])
    const [primary, secondary] = f.requests.map(request => JSON.parse(request.payload))
    expect(primary.TARGET_ROWS).toBe('Accounting')
    expect(primary.SOURCE_TEXT).toBe(`${sourceText.slice(0, contextEnd)}\nAccounting`)
    expect(primary.SOURCE_TEXT).toContain('International Business')
    expect(primary.SOURCE_TEXT).not.toContain('Business Administration')
    expect(primary.PARTITION_SCOPE).toEqual({ ...partition, instructions: expect.stringContaining('Do not mark the full catalogue complete') })
    expect(secondary.PARTITION_SCOPE).toEqual(primary.PARTITION_SCOPE)
    expect(secondary.TARGET_ROWS).toBe(primary.TARGET_ROWS)
    expect(Object.hasOwn(secondary, 'primary')).toBe(false)
    expect(f.proposals[0].source.snapshotSha256).toBe(hash(sourceText))
    const keys = f.requests.map(request => request.reservationKey)
    for (const request of f.requests) expect(request.reservationKey).toBe(hash(`identity-v2:${sourceId}:${hash(request.payload)}:${request.pass}`))
    await extractIdentities(f.env, f.job, f.row)
    expect(f.requests.slice(2).map(request => request.reservationKey)).toEqual(keys)
    const next = { ...content, rowNumbers: [3], targetRanges: [{ start: sourceText.indexOf('Business Administration'), end: sourceText.indexOf('Business Administration') + 'Business Administration'.length }] }
    f.job.target_ids_json = canonicalJson({ ...next, sha256: hash(canonicalJson(next)) })
    f.output(() => ({ programs: [programme('Business Administration')] }))
    expect(await extractIdentities(f.env, f.job, f.row)).toEqual({ ready: 1, held: 0 })
    expect(f.requests[4].reservationKey).not.toBe(keys[0])
    expect(f.requests[5].reservationKey).not.toBe(keys[1])
  })

  it('rejects forged partition digests, out-of-bounds and overlapping ranges before model admission or prior-request checks', async () => {
    const start = text.indexOf('Accounting')
    const valid = { kind: 'program-identity-partition-v1', fullTextSha256: hash(text), page: 1, rowNumbers: [2],
      contextRanges: [{ start: 0, end: text.indexOf('Majors:') }], targetRanges: [{ start, end: start + 'Accounting'.length }] }
    const cases = [
      { content: valid, checksum: '0'.repeat(64), error: 'program_partition_checksum_mismatch' },
      { content: { ...valid, fullTextSha256: 'f'.repeat(64) }, error: 'program_partition_checksum_mismatch' },
      { content: { ...valid, targetRanges: [{ start, end: text.length + 1 }] }, error: 'program_partition_range_invalid' },
      { content: { ...valid, contextRanges: [{ start: 0, end: start + 1 }] }, error: 'program_partition_range_invalid' },
    ]
    for (const item of cases) {
      const f = fixture(); f.env.PROGRAM_EXTRACTION_CONTRACT_VERSION = '2'
      f.job.target_ids_json = canonicalJson({ ...item.content, sha256: item.checksum ?? hash(canonicalJson(item.content)) })
      await expect(extractIdentities(f.env, f.job, f.row)).rejects.toThrow(item.error)
      expect(f.requests).toEqual([])
      expect(f.priorChecks).toEqual([])
      expect(f.proposals).toEqual([])
    }
  })
})
