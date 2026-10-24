import { createHash, webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { maintainFields, parseFieldExtraction, type FieldModelRunner } from '../../workers/catalog-maintenance/src/field-updates'
import type { CapturedSnapshot } from '../../workers/catalog-maintenance/src/capture'
import type { JobRow, MaintenanceEnv, ModelRequest, SourceRow } from '../../workers/catalog-maintenance/src/types'
import type { MaintenanceRecordTarget } from '../../scripts/maintenance/field-contracts'

beforeAll(() => { vi.stubGlobal('crypto', webcrypto) })
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const text = 'International students applying to Computer Science. Autumn 2027 admissions. Application deadline: 2027-09-30. Tuition: 20,000 CNY per academic year.'
const url = 'https://example.edu.cn/international/2027'
const sourceId = hash(url)
const applicabilityQuote = 'International students applying to Computer Science.'
const scopeQuote = 'Autumn 2027 admissions.'

function setup(sourceText = text) {
  const objects = new Map<string, string>([['text.txt', sourceText]])
  const env = { SNAPSHOTS_BUCKET: {
    get: async (key: string) => objects.has(key) ? { text: async () => objects.get(key)!, arrayBuffer: async () => new TextEncoder().encode(objects.get(key)!).buffer } : null,
    put: async (key: string, body: string | ArrayBuffer | Uint8Array) => { objects.set(key, typeof body === 'string' ? body : new TextDecoder().decode(body)) },
  } } as unknown as MaintenanceEnv
  const snapshot: CapturedSnapshot = { version: 1, sourceId, sourceUrl: url, finalUrl: url,
    checkedAt: '2026-10-24T00:00:00.000Z', contentType: 'text/plain', rawSha256: hash(sourceText), rawKey: 'raw.txt',
    textKey: 'text.txt', textSha256: hash(sourceText), canonicalSha256: hash(sourceText), parserCandidates: [] }
  const row = { source_id: sourceId, url, allowed_hosts_json: JSON.stringify(['example.edu.cn']) } as SourceRow
  const job = { job_id: 'test-job', source_id: sourceId, stage: 'extract', snapshot_sha256: snapshot.rawSha256 } as JobRow
  const target: MaintenanceRecordTarget = { recordId: 'cycle-computer-science', universityId: 'uni-example', entityType: 'admission-cycle',
    sourceIds: [sourceId], recordScopeSha256: 'a'.repeat(64), identity: { name: { en: 'Computer Science' } },
    year: '2027-2028', intake: 'autumn', reviewAfter: '2026-10-24', fields: {} }
  return { env, snapshot, row, job, target, objects }
}

function record(recordId = 'cycle-computer-science') {
  return { recordId, year: '2027-2028', intake: 'autumn', applicabilityQuote, scopeQuote,
    patches: [
      { fieldPath: 'closesOn', value: '2027-09-30', factStatus: 'known', quote: 'Application deadline: 2027-09-30.' },
      { fieldPath: 'tuitionCny', value: 20000, factStatus: 'known', quote: 'Tuition: 20,000 CNY per academic year.' },
      { fieldPath: 'tuitionPeriod', value: 'academic-year', factStatus: 'known', quote: 'Tuition: 20,000 CNY per academic year.' },
    ] }
}

function model(response: (request: ModelRequest, call: number) => unknown = () => ({ records: [record()] })) {
  const requests: ModelRequest[] = []
  const runner: FieldModelRunner = async (_env, request) => {
    requests.push(request)
    return { attemptId: `${request.pass}-${request.reservationKey}`, output: response(request, requests.length),
      artifactKey: `models/${request.reservationKey}.json`, artifactSha256: hash(request.reservationKey), reused: false }
  }
  return { requests, runner }
}

describe('document-level independent maintenance of existing facts', () => {
  it('creates a field-bound patch with both model artifacts and no whole-record audit renewal', async () => {
    const fixture = setup(), mock = model()
    const result = await maintainFields(fixture.env, fixture.job, fixture.row, fixture.snapshot, [fixture.target], mock.runner)
    expect(mock.requests).toHaveLength(2)
    expect(result.held).toEqual([])
    expect(result.proposals).toHaveLength(1)
    const proposal = result.proposals[0]
    expect(proposal).toMatchObject({ entityType: 'admission-cycle', recordId: fixture.target.recordId, operation: 'patch', scope: { year: '2027-2028', intake: 'autumn' } })
    expect(Object.keys(proposal.fields).sort()).toEqual(['patches', 'recordScopeSha256'])
    expect((proposal.fields.patches as unknown[])).toHaveLength(3)
    const receipt = JSON.parse(fixture.objects.get(proposal.review!.artifactKey!)!)
    expect(receipt.agreedFields).toEqual(proposal.fields)
    expect(receipt.primaryArtifactKey).toContain('models/')
    expect(receipt.modelArtifactKey).toContain('models/')
    expect(receipt.extractionAttemptId).not.toBe(receipt.reviewAttemptId)
    expect(mock.requests[1].payload).not.toContain('20000') // no primary numeric answer is fed into the second extractor
  })

  it('publishes agreed fields and leaves a disputed sibling unverified', async () => {
    const fixture = setup(), mock = model((_request, call) => {
      const candidate = record()
      if (call === 2) candidate.patches = candidate.patches.filter(patch => patch.fieldPath !== 'tuitionCny')
      return { records: [candidate] }
    })
    const result = await maintainFields(fixture.env, fixture.job, fixture.row, fixture.snapshot, [fixture.target], mock.runner)
    expect((result.proposals[0].fields.patches as Array<{ fieldPath: string }>).map(patch => patch.fieldPath)).toEqual(['closesOn', 'tuitionPeriod'])
    expect(result.held).toContainEqual({ recordId: fixture.target.recordId, reason: 'independent_field_disagreement:tuitionCny' })
  })

  it('requires exact admission year/intake evidence and explicit applicability', () => {
    const { target } = setup()
    const wrongYear = record(); wrongYear.year = '2026-2027'
    expect(parseFieldExtraction({ records: [wrongYear] }, text, [target]).size).toBe(0)
    const wrongScope = record(); wrongScope.scopeQuote = 'International students applying to Computer Science.'
    expect(parseFieldExtraction({ records: [wrongScope] }, text, [target]).size).toBe(0)
    const unrelated = record(); unrelated.applicabilityQuote = 'Tuition: 20,000 CNY per academic year.'
    expect(parseFieldExtraction({ records: [unrelated] }, text, [target]).size).toBe(0)
  })

  it('never applies a postgraduate-only universal rule to a bachelor programme', () => {
    const { target } = setup()
    const quote = 'All master international students pay the following tuition.'
    const sourceText = `${text} ${quote}`
    const candidate = { ...record(), applicabilityQuote: quote }
    expect(parseFieldExtraction({ records: [candidate] }, sourceText, [{ ...target, identity: { ...target.identity, degreeLevel: 'bachelor' } }]).size).toBe(0)
    expect(parseFieldExtraction({ records: [candidate] }, sourceText, [{ ...target, identity: { ...target.identity, degreeLevel: 'master' } }]).size).toBe(1)
    const namedQuote = 'All master international students applying to Computer Science pay the following tuition.'
    expect(parseFieldExtraction({ records: [{ ...candidate, applicabilityQuote: namedQuote }] }, `${text} ${namedQuote}`,
      [{ ...target, identity: { ...target.identity, degreeLevel: 'bachelor' } }]).size).toBe(0)
  })

  it('does not treat missing text as an official unannounced date or verify invented prices', () => {
    const { target } = setup()
    const candidate = record()
    candidate.patches = [
      { fieldPath: 'closesOn', value: null, factStatus: 'officially_not_announced', quote: applicabilityQuote },
      { fieldPath: 'tuitionCny', value: 30000, factStatus: 'known', quote: 'Tuition: 20,000 CNY per academic year.' },
    ] as unknown as ReturnType<typeof record>['patches']
    expect(parseFieldExtraction({ records: [candidate] }, text, [target]).size).toBe(0)
  })

  it('keeps repeated unchanged-source review model reservations stable across dates', async () => {
    const fixture = setup(), mock = model()
    await maintainFields(fixture.env, fixture.job, fixture.row, fixture.snapshot, [fixture.target], mock.runner)
    const second = await maintainFields(fixture.env, fixture.job, fixture.row,
      { ...fixture.snapshot, checkedAt: '2026-10-25T00:00:00.000Z' }, [fixture.target], mock.runner)
    expect(mock.requests[0].reservationKey).toBe(mock.requests[2].reservationKey)
    expect(mock.requests[1].reservationKey).toBe(mock.requests[3].reservationKey)
    expect(mock.requests[0].payload).toBe(mock.requests[2].payload)
    expect(second.proposals[0].source.checkedAt).toBe('2026-10-25T00:00:00.000Z')
  })

  it('makes two requests for many records in one document rather than two per record', async () => {
    const fixture = setup()
    const targets = Array.from({ length: 12 }, (_, index) => ({ ...fixture.target, recordId: `cycle-${index}` }))
    const mock = model(request => ({ records: (JSON.parse(request.payload).targets as Array<{ recordId: string }>).map(target => record(target.recordId)) }))
    const result = await maintainFields(fixture.env, fixture.job, fixture.row, fixture.snapshot, targets, mock.runner)
    expect(mock.requests).toHaveLength(2)
    expect(result.proposals).toHaveLength(12)
  })

  it('does not auto-retry a model request whose outcome is unknown', async () => {
    const fixture = setup(), runner = vi.fn<FieldModelRunner>().mockRejectedValue(new Error('model_outcome_unknown'))
    await expect(maintainFields(fixture.env, fixture.job, fixture.row, fixture.snapshot, [fixture.target], runner)).rejects.toThrow('model_outcome_unknown')
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('holds overlarge documents instead of silently omitting later content', async () => {
    const fixture = setup(`${text}${' '.repeat(100001)}`), mock = model()
    const result = await maintainFields(fixture.env, fixture.job, fixture.row, fixture.snapshot, [fixture.target], mock.runner)
    expect(mock.requests).toHaveLength(0)
    expect(result.held).toEqual([{ recordId: fixture.target.recordId, reason: 'large_source_requires_explicit_partition' }])
  })

  it('does not infer the current year for a legacy scholarship', () => {
    const fixture = setup()
    const target = { ...fixture.target, entityType: 'scholarship' as const, year: null, intake: null }
    const candidate = { ...record(), year: null, intake: null, scopeQuote: null,
      patches: [{ fieldPath: 'coverage.stipendCnyPerMonth', value: 20000, factStatus: 'known', quote: 'Tuition: 20,000 CNY per academic year.' }] }
    expect(parseFieldExtraction({ records: [candidate] }, text, [target]).size).toBe(0)
  })

  it('verifies captured text checksums before spending any model quota', async () => {
    const fixture = setup(), mock = model(); fixture.objects.set('text.txt', 'changed')
    await expect(maintainFields(fixture.env, fixture.job, fixture.row, fixture.snapshot, [fixture.target], mock.runner)).rejects.toThrow('field_text_checksum_mismatch')
    expect(mock.requests).toHaveLength(0)
  })
})
