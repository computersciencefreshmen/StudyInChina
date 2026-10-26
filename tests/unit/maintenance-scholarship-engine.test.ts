import { createHash, webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { extractScholarshipIdentities, parseScholarshipIdentities, type ScholarshipIdentityModelRunner } from '../../workers/catalog-maintenance/src/scholarship-identities'
import type { CapturedSnapshot } from '../../workers/catalog-maintenance/src/capture'
import type { JobRow, MaintenanceEnv, ModelRequest, SchoolRow, SourceRow } from '../../workers/catalog-maintenance/src/types'
import { canonicalJson, type MaintenanceProposal } from '../../scripts/maintenance/contracts'

beforeAll(() => vi.stubGlobal('crypto', webcrypto))
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const url = 'https://example.edu.cn/international/scholarships', sourceId = hash(url)
const text = 'Example University provides the Example President Scholarship for international students. This is a university-funded scholarship.'
const school: SchoolRow = { university_id: 'uni-example', name_json: JSON.stringify({ en: 'Example University' }), seed_json: '{}' }
function award() {
  return { universityId: school.university_id, name: { en: 'Example President Scholarship' }, providerType: 'university', scholarshipUrl: url,
    evidence: { quote: text, locator: 'document' }, internationalEvidence: { quote: 'for international students', locator: 'document' },
    institutionEvidence: { quote: 'Example University', locator: 'document' },
    fieldEvidence: [{ fieldPath: 'name.en', quote: 'Example President Scholarship', locator: 'document' }, { fieldPath: 'providerType', quote: 'university-funded scholarship', locator: 'document' }] }
}
function setup(sourceText = text) {
  const rawSha256 = hash(sourceText), snapshotKey = `maintenance/snapshots/${sourceId}/${rawSha256}.json`
  const snapshot: CapturedSnapshot = { version: 1, sourceId, sourceUrl: url, finalUrl: url, checkedAt: '2026-10-24T00:00:00.000Z',
    contentType: 'text/plain', rawSha256, rawKey: 'raw.txt', textKey: 'text.txt', textSha256: rawSha256, canonicalSha256: rawSha256, parserCandidates: [] }
  const objects = new Map<string, string>([[snapshotKey, JSON.stringify(snapshot)], ['text.txt', sourceText]])
  const proposals: MaintenanceProposal[] = []
  const batchSizes: number[] = []
  const env = { SNAPSHOTS_BUCKET: {
    get: async (key: string) => objects.has(key) ? { text: async () => objects.get(key)!, size: objects.get(key)!.length } : null,
    put: async (key: string, body: string) => { objects.set(key, body) },
  }, PIPELINE_DB: { prepare: (sql: string) => {
    let args: unknown[] = []
    const statement = { bind: (...values: unknown[]) => { args = values; return statement },
      first: async () => sql.includes('maintenance_control') ? { canary_json: '[]' } : null, all: async () => ({ results: [school] }),
      run: async () => { if (sql.includes('maintenance_proposals')) throw Error('proposal_insert_requires_atomic_batch'); return { success: true } },
      applyProposals: (target: MaintenanceProposal[]) => {
        if (!sql.startsWith('INSERT OR IGNORE INTO maintenance_proposals(') || args.length === 0 || args.length % 7 !== 0)
          throw Error('unexpected_proposal_batch_statement')
        let changes = 0
        for (let offset = 0; offset < args.length; offset += 7) {
          const proposal = JSON.parse(String(args[offset + 5])) as MaintenanceProposal
          if (!target.some(existing => existing.id === proposal.id)) { target.push(proposal); changes++ }
        }
        return changes
      } }
    return statement
  }, batch: async (statements: Array<{ applyProposals(target: MaintenanceProposal[]): number }>) => {
    // Validate and apply every multi-row statement to a temporary transaction.
    // Commit only after the entire batch succeeds, matching D1.batch semantics.
    const staged = [...proposals]
    const results = statements.map(statement => ({ success: true, meta: { changes: statement.applyProposals(staged) } }))
    proposals.splice(0, proposals.length, ...staged)
    batchSizes.push(statements.length)
    return results
  } } } as unknown as MaintenanceEnv
  const row = { source_id: sourceId, url, allowed_hosts_json: JSON.stringify(['example.edu.cn']), category: 'university_scholarship' } as SourceRow
  const job = { job_id: 'award-test-job', source_id: sourceId, stage: 'extract', snapshot_key: snapshotKey, snapshot_sha256: rawSha256 } as JobRow
  return { env, row, job, snapshot, objects, proposals, batchSizes }
}
function model(output: (call: number) => unknown = () => ({ scholarships: [award()] })) {
  const requests: ModelRequest[] = []
  const runner: ScholarshipIdentityModelRunner = async (_env, request) => {
    requests.push(request)
    return { attemptId: `${request.pass}-${requests.length}`, output: output(requests.length), artifactKey: `models/${request.reservationKey}.json`,
      artifactSha256: hash(request.reservationKey), reused: false }
  }
  return { requests, runner }
}

describe('document-level international scholarship identity discovery', () => {
  it('makes exactly two independent source-only requests for multiple named awards', async () => {
    const f = setup(), second = award()
    second.name.en = 'Example Other Scholarship'
    const content = `${text} Example University provides Example Other Scholarship for international students.`
    const many = setup(content)
    second.fieldEvidence[0].quote = second.name.en
    const mock = model(() => ({ scholarships: [award(), second] }))
    const result = await extractScholarshipIdentities(many.env, many.job, many.row, mock.runner)
    expect(result).toEqual({ ready: 2, held: 0 })
    expect(mock.requests).toHaveLength(2)
    expect(mock.requests[0].pass).toBe('primary')
    expect(mock.requests[1].pass).toBe('independent-review')
    expect(many.proposals).toHaveLength(2)
    expect(many.batchSizes).toEqual([1])
    expect(mock.requests.every(request => request.lane === 'expansion' && request.recordIds?.length === 0)).toBe(true)
    expect(JSON.parse(mock.requests[1].payload)).not.toHaveProperty('primaryAnswer')
    expect(many.proposals.every(proposal => proposal.scope.year === null && proposal.scope.intake === null)).toBe(true)
    for (const proposal of many.proposals) {
      expect(proposal.entityType).toBe('scholarship')
      expect(Object.keys(proposal.fields).sort()).toEqual(['institutionEvidence', 'internationalAdmissionsEvidence', 'name', 'providerType', 'scholarshipUrl'])
      expect(proposal.extractionAttemptId).not.toBe(proposal.review?.reviewAttemptId)
    }
    expect(f.proposals).toEqual([])
  })

  it('holds independent identity disagreements and never silently accepts a lone model answer', async () => {
    const f = setup(), mock = model(call => ({ scholarships: call === 1 ? [award()] : [] }))
    expect(await extractScholarshipIdentities(f.env, f.job, f.row, mock.runner)).toEqual({ ready: 0, held: 1 })
    expect(f.proposals[0].status).toBe('held')
    expect(f.proposals[0].review?.decision).toBe('rejected')
  })

  it('rejects headings, missing affiliation, invented names and uncaptured URLs', () => {
    const f = setup()
    for (const kind of ['heading', 'affiliation', 'invented-name', 'uncaptured-url']) {
      const value = award()
      if (kind === 'heading') value.name.en = 'Scholarships'
      if (kind === 'affiliation') value.institutionEvidence.quote = 'for international students'
      if (kind === 'invented-name') value.name.en = 'Invented Award Scholarship'
      if (kind === 'uncaptured-url') value.scholarshipUrl = 'https://example.edu.cn/different-page'
      expect(parseScholarshipIdentities({ scholarships: [value] }, text, [school], f.row, f.snapshot)).toEqual([])
    }
  })

  it('retains a proven English award while dropping an unsupported translation or English copy in zh', () => {
    const f = setup()
    for (const zh of ['示例校长奖学金', award().name.en]) {
      const value = { ...award(), name: { ...award().name, zh },
        fieldEvidence: [...award().fieldEvidence, { fieldPath: 'name.zh', quote: award().name.en, locator: 'document' }] }
      const parsed = parseScholarshipIdentities({ scholarships: [value] }, text, [school], f.row, f.snapshot)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].name).toEqual(award().name)
      expect(parsed[0].fieldEvidence.some(field => field.fieldPath === 'name.zh')).toBe(false)
    }
  })

  it('does not repair spacing in names or relax the full institution affiliation requirement', () => {
    const f = setup()
    const value = award()
    value.name.en = 'Example President-Scholarship'
    expect(parseScholarshipIdentities({ scholarships: [value] }, text, [school], f.row, f.snapshot)).toEqual([])
    const alias = award()
    alias.institutionEvidence.quote = alias.name.en
    expect(parseScholarshipIdentities({ scholarships: [alias] }, text, [school], f.row, f.snapshot)).toEqual([])
  })

  it('appends parser-v2 candidates without overwriting a held legacy candidate or changing reservations', async () => {
    const f = setup(), mock = model()
    await extractScholarshipIdentities(f.env, f.job, f.row, mock.runner)
    const current = f.proposals[0]
    const core = { universityId: school.university_id, name: award().name, providerType: 'university', scholarshipUrl: url }
    const legacy = { ...current, id: `maintenance-scholarship-${hash(`${sourceId}:${f.snapshot.rawSha256}:${canonicalJson(core)}`)}`, status: 'held' as const }
    f.proposals.splice(0, 1, legacy)
    await extractScholarshipIdentities(f.env, f.job, f.row, mock.runner)
    expect(f.proposals).toHaveLength(2)
    expect(f.proposals[0]).toBe(legacy)
    expect(f.proposals[1].id).toBe(current.id)
    expect(f.proposals[1].id).not.toBe(legacy.id)
    expect(mock.requests[0].reservationKey).toBe(mock.requests[2].reservationKey)
    expect(mock.requests[1].reservationKey).toBe(mock.requests[3].reservationKey)
  })

  it('fails before model requests on mismatched saved bytes or overlarge unpartitioned documents', async () => {
    const f = setup(), mock = model()
    f.objects.set('text.txt', 'changed captured bytes')
    await expect(extractScholarshipIdentities(f.env, f.job, f.row, mock.runner)).rejects.toThrow('captured_text_checksum_mismatch')
    const large = setup(`${text}${' '.repeat(50001)}`)
    await expect(extractScholarshipIdentities(large.env, large.job, large.row, mock.runner)).rejects.toThrow('scholarship_source_requires_explicit_partition')
    expect(mock.requests).toHaveLength(0)
  })

  it('does not retry an unknown model outcome', async () => {
    const f = setup(), runner = vi.fn<ScholarshipIdentityModelRunner>().mockRejectedValue(Error('model_outcome_unknown'))
    await expect(extractScholarshipIdentities(f.env, f.job, f.row, runner)).rejects.toThrow('model_outcome_unknown')
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('reuses the exact reservation identity across later observations of unchanged bytes', async () => {
    const f = setup(), mock = model()
    await extractScholarshipIdentities(f.env, f.job, f.row, mock.runner)
    f.snapshot.checkedAt = '2026-10-25T00:00:00.000Z'
    f.objects.set(f.job.snapshot_key!, JSON.stringify(f.snapshot))
    await extractScholarshipIdentities(f.env, f.job, f.row, mock.runner)
    expect(mock.requests[0].reservationKey).toBe(mock.requests[2].reservationKey)
    expect(mock.requests[1].reservationKey).toBe(mock.requests[3].reservationKey)
    expect(f.proposals).toHaveLength(1)
  })
})
