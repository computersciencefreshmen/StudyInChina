import { describe, expect, it } from 'vitest'
import { buildClaims, buildRankingSources, getApiConfig, summarizeResults, validateVerdicts, type RecordResult, type SourceReceipt } from '../../scripts/ingestion/verify-catalog-minimax'

const source: SourceReceipt = {
  sourceId: 'official', url: 'https://example.edu/guide', checkedAt: '2026-09-29T00:00:00Z',
  status: 'captured', text: 'Tuition for 2027 is CNY 30000. Applications close on 2026-12-15.',
}

describe('MiniMax catalog comparison evidence gate', () => {
  it('inventories nested public fields without sending audit metadata as claims', () => {
    expect(buildClaims({ id: 'one', status: 'verified', sourceIds: ['official'], coverage: { insurance: true, stipend: null }, name: { en: 'School' } })).toEqual([
      { path: 'coverage.insurance', value: true }, { path: 'coverage.stipend', value: null }, { path: 'name.en', value: 'School' },
    ])
  })
  it('never accepts a model verification claim without exact source text', () => {
    const result = validateVerdicts([{ path: 'tuitionCny', value: 30000 }], [{ path: 'tuitionCny', status: 'supported', sourceId: 'official', quote: 'Tuition is 30000 (verified)' }], [source])
    expect(result[0].status).toBe('unconfirmed')
  })
  it('accepts grounded numeric differences only as review candidates', () => {
    const result = validateVerdicts([{ path: 'tuitionCny', value: 20000 }], [{ path: 'tuitionCny', status: 'contradicted', proposedValue: 30000, sourceId: 'official', quote: 'Tuition for 2027 is CNY 30000.' }], [source])
    expect(result[0]).toMatchObject({ status: 'contradicted', storedValue: 20000, proposedValue: 30000 })
  })
  it('rejects a correct quote that does not support the proposed numeric value', () => {
    const result = validateVerdicts([{ path: 'tuitionCny', value: 20000 }], [{ path: 'tuitionCny', status: 'contradicted', proposedValue: 35000, sourceId: 'official', quote: source.text }], [source])
    expect(result[0].status).toBe('unconfirmed')
  })
  it('fails closed for inaccessible sources, omitted and duplicate verdicts, and unknown values', () => {
    const verdict = { path: 'fee', status: 'supported', sourceId: 'official', quote: source.text }
    expect(validateVerdicts([{ path: 'fee', value: 30000 }], [verdict], [{ ...source, status: 'unconfirmed' }])[0].status).toBe('unconfirmed')
    expect(validateVerdicts([{ path: 'fee', value: 30000 }], [verdict, verdict], [source])[0].status).toBe('unconfirmed')
    expect(validateVerdicts([{ path: 'fee', value: 30000 }], [], [source])[0].status).toBe('unconfirmed')
    expect(validateVerdicts([{ path: 'fee', value: null }], [verdict], [source])[0].status).toBe('unconfirmed')
  })
  it('cannot reuse another records official source', () => {
    const result = validateVerdicts([{ path: 'fee', value: 30000 }], [{ path: 'fee', status: 'supported', sourceId: 'another-university', quote: source.text }], [source])
    expect(result[0].status).toBe('unconfirmed')
  })
  it('does not forward a local proxy auth token to the official MiniMax service', () => {
    expect(getApiConfig({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:1234', ANTHROPIC_AUTH_TOKEN: 'test-only' })).toBeNull()
  })
  it('accepts officially configured domestic Anthropic and OpenAI endpoints', () => {
    expect(getApiConfig({ ANTHROPIC_BASE_URL: 'https://api.minimax.cn/anthropic', ANTHROPIC_AUTH_TOKEN: 'test-only' })).toMatchObject({ endpoint: 'https://api.minimax.cn/anthropic/v1/messages', anthropic: true })
    expect(getApiConfig({ MINIMAX_API_URL: 'https://api.minimaxi.com/v1/chat/completions', MINIMAX_API_KEY: 'test-only' })).toMatchObject({ anthropic: false })
  })
  it('preserves the explicit current MiniMax provider model', () => {
    expect(getApiConfig({ ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic', ANTHROPIC_AUTH_TOKEN: 'test-only', ANTHROPIC_MODEL: 'MiniMax-M3' })).toMatchObject({ model: 'MiniMax-M3' })
  })
  it('rejects credentials in URLs, unsafe ports and unapproved API hosts', () => {
    for (const url of ['https://other.test/v1/chat/completions', 'https://name:password@api.minimax.io/v1/chat/completions', 'https://api.minimax.io:444/v1/chat/completions']) {
      expect(() => getApiConfig({ MINIMAX_API_URL: url, MINIMAX_API_KEY: 'test-only' })).toThrow()
    }
  })
  it('cannot turn absence of a statement into a contradictory replacement', () => {
    expect(validateVerdicts([{ path: 'summary.en', value: 'Engineering and computing' }], [{ path: 'summary.en', status: 'contradicted', proposedValue: 'Computing was not visible in the snapshot', sourceId: 'official', quote: source.text }], [source])[0].status).toBe('unconfirmed')
  })
  it('registers ranking evidence only after the production university provenance schema accepts its host', () => {
    const university = {
      id: 'school', slug: 'school', name: { en: 'School' }, cityId: 'city', region: 'north',
      sourceIds: ['official'], verifiedAt: '2026-09-29', reviewAfter: '2027-01-01', status: 'verified',
      officialUrl: 'https://school.edu.cn/', admissionsUrl: null, summary: null, featured: false,
      rankings: [{ system: 'qs', year: 2027, rankMin: 20, rankMax: 20, rankLabel: '20', sourceUrl: 'https://www.topuniversities.com/universities/school', checkedAt: '2026-09-29' }],
    }
    expect(buildRankingSources(university)).toHaveLength(1)
    expect(buildRankingSources({ ...university, rankings: [{ ...university.rankings[0], sourceUrl: 'https://unrelated.edu.cn/rankings' }] })).toHaveLength(0)
  })
  it('rejects ranking quotes drawn from an unrelated official admissions source', () => {
    expect(validateVerdicts([{ path: 'rankings.0.rankMin', value: 30000 }], [{ path: 'rankings.0.rankMin', status: 'supported', sourceId: 'official', quote: source.text }], [source], { 'rankings.0.rankMin': 'https://www.topuniversities.com/rankings' })[0].status).toBe('unconfirmed')
  })
  it('reports partial progress and review candidates without claiming publication approval', () => {
    const base: RecordResult = { taskId: 'one', checkedAt: '2026-09-30T08:30:00Z', inputSha256: 'test', model: 'MiniMax-M3', status: 'review-required', sourceIds: ['official'], issues: [], verdicts: [] }
    expect(summarizeResults([
      { ...base, verdicts: [{ path: 'tuition', storedValue: 30000, status: 'supported', reason: 'candidate' }] },
      { ...base, taskId: 'two', verdicts: [{ path: 'tuition', storedValue: 20000, proposedValue: 30000, status: 'contradicted', reason: 'candidate' }, { path: 'deadline', storedValue: null, status: 'unconfirmed', reason: 'unknown' }] },
      { ...base, taskId: 'three', issues: ['MiniMax HTTP 429'], verdicts: [{ path: 'fee', storedValue: null, status: 'unconfirmed', reason: 'unknown' }] },
    ], 100, 100)).toMatchObject({ totalRecords: 100, selectedRecords: 100, completedRecords: 3, supportedCandidateFields: 1, contradictedCandidateFields: 1, unconfirmedFields: 2, recordsRequiringReview: 2, modelErrorRecords: 1, publicationApprovedRecords: 0, fatal: null })
  })
})
