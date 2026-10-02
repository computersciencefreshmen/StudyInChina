import { describe, expect, it } from 'vitest'
import { applyModelOptions, buildClaims, buildComparisonRequest, buildRankingSources, getApiConfig, matchesModelConfiguration, modelConfiguration, parseMiniMaxResponseJson, parseModelOptions, runVerificationBatches, summarizeResults, validateComparisonOutput, validateVerdicts, verificationRunId, type ApiConfig, type RecordResult, type SourceReceipt } from '../../scripts/ingestion/verify-catalog-minimax'

const source: SourceReceipt = {
  sourceId: 'official', url: 'https://example.edu/guide', checkedAt: '2026-09-29T00:00:00Z',
  status: 'captured', text: 'Tuition for 2027 is CNY 30000. Applications close on 2026-12-15.',
}

describe('MiniMax catalog comparison evidence gate', () => {
  it.each([1, 2, 3, 4])('drains a one-record sample with %s workers despite asynchronous admission', async concurrency => {
    const processed: number[] = []
    await runVerificationBatches([[1]], concurrency, () => true, async batch => {
      await Promise.resolve()
      processed.push(...batch)
    })
    expect(processed).toEqual([1])
  })
  it('reserves each batch once across asynchronous workers and stops assigning work after a fatal admission', async () => {
    const processed: number[] = []
    await runVerificationBatches(Array.from({ length: 11 }, (_, index) => [index]), 4, () => true, async batch => {
      await Promise.resolve()
      processed.push(...batch)
    })
    expect(processed.sort((left, right) => left - right)).toEqual(Array.from({ length: 11 }, (_, index) => index))
    let stopped = false
    const admitted: number[] = []
    await runVerificationBatches([[1], [2], [3]], 2, () => !stopped, async batch => {
      stopped = true
      await Promise.resolve()
      admitted.push(...batch)
    })
    expect(admitted).toEqual([1])
  })

  it('classifies null and malformed model result identities before saving a response or losing checkpoints', () => {
    for (const text of ['{', '{"results":', '{"secret-input":garbage}']) expect(() => parseMiniMaxResponseJson(text)).toThrow('MiniMax response JSON invalid')
    expect(parseMiniMaxResponseJson('{"results":[]}')).toEqual({ results: [] })
    for (const output of [null, false, [], {}, { results: null }, { results: [null] }, { results: [[]] }, { results: [{ taskId: 42 }] }, { results: [{ taskId: '' }] }]) {
      expect(() => validateComparisonOutput(output)).toThrow('MiniMax response schema invalid')
    }
    const omittedVerdicts = { results: [{ taskId: 'programs:one' }] }
    expect(validateComparisonOutput(omittedVerdicts)).toBe(omittedVerdicts)
    const duplicates = { results: [{ taskId: 'programs:one', verdicts: [] }, { taskId: 'programs:one', verdicts: [] }] }
    expect(validateComparisonOutput(duplicates)).toBe(duplicates)
  })
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

describe('MiniMax new-run model configuration', () => {
  const anthropic: ApiConfig = { model: 'MiniMax-M3', key: 'test-only-secret', endpoint: 'https://api.minimax.cn/anthropic/v1/messages', anthropic: true, providerId: 'test-provider' }
  const openai: ApiConfig = { ...anthropic, endpoint: 'https://api.minimax.cn/v1/chat/completions', anthropic: false }
  const checkpoint: RecordResult = { taskId: 'one', checkedAt: '2026-09-30T08:30:00Z', inputSha256: 'test', model: 'MiniMax-M3', status: 'review-required', sourceIds: [], issues: [], verdicts: [] }

  it('preserves provider choice and the exact legacy request defaults with no flags', () => {
    const api = applyModelOptions(anthropic, parseModelOptions([]))
    expect(api).toMatchObject(anthropic)
    expect(modelConfiguration(api)).toMatchObject({ model: 'MiniMax-M3', effort: null, thinking: 'disabled' })
    expect(buildComparisonRequest(api, 'payload')).toMatchObject({ model: 'MiniMax-M3', max_tokens: 16384, messages: [{ role: 'user', content: 'payload' }] })
    expect(buildComparisonRequest(api, 'payload')).not.toHaveProperty('thinking')
    expect(buildComparisonRequest(api, 'payload')).not.toHaveProperty('output_config')
    expect(verificationRunId('a'.repeat(64), api, {})).toBe('a'.repeat(16))
    expect(matchesModelConfiguration(checkpoint, api, false)).toBe(true)
  })

  it('allows a new M3 adaptive run without changing the provider or credential', () => {
    const options = parseModelOptions(['--model', 'MiniMax-M3', '--thinking', 'adaptive'])
    const api = applyModelOptions(anthropic, options)
    expect(api.key).toBe(anthropic.key)
    expect(api.endpoint).toBe(anthropic.endpoint)
    expect(anthropic).not.toHaveProperty('thinking')
    expect(buildComparisonRequest(api, 'payload')).toHaveProperty('thinking', { type: 'adaptive' })
    expect(modelConfiguration(api)).toMatchObject({ effort: null, thinking: 'adaptive' })
    expect(matchesModelConfiguration(checkpoint, api, false)).toBe(false)
    expect(verificationRunId('a'.repeat(64), api, options)).toMatch(/^a{16}-[a-f0-9]{12}$/)
    expect(JSON.stringify(modelConfiguration(api))).not.toContain(anthropic.key)
  })

  it('uses protocol-specific effort fields and honors forced adaptive thinking for M3.1', () => {
    const options = parseModelOptions(['--model', 'MiniMax-M3.1-Flash-Preview', '--effort', 'high'])
    expect(buildComparisonRequest(applyModelOptions(anthropic, options), 'payload')).toHaveProperty('output_config', { effort: 'high' })
    expect(buildComparisonRequest(applyModelOptions(openai, options), 'payload')).toHaveProperty('reasoning_effort', 'high')
    const defaults = applyModelOptions(anthropic, { model: 'MiniMax-M3.1-Flash-Preview' })
    expect(modelConfiguration(defaults)).toMatchObject({ effort: 'max', thinking: 'adaptive' })
    expect(() => applyModelOptions(anthropic, { ...options, thinking: 'disabled' })).toThrow('disabled')
  })

  it('never reuses checkpoints or run directories across different effort or protocol defaults', () => {
    const high = applyModelOptions(anthropic, { model: 'MiniMax-M3.1-Flash-Preview', effort: 'high' })
    const max = applyModelOptions(anthropic, { model: 'MiniMax-M3.1-Flash-Preview', effort: 'max' })
    const highCheckpoint = { ...checkpoint, ...modelConfiguration(high) }
    expect(matchesModelConfiguration(highCheckpoint, high, false)).toBe(true)
    expect(matchesModelConfiguration(highCheckpoint, max, false)).toBe(false)
    expect(verificationRunId('a'.repeat(64), high, high.requestedModelOptions!)).not.toBe(verificationRunId('a'.repeat(64), max, max.requestedModelOptions!))
    expect(modelConfiguration(anthropic).modelConfigSha256).not.toBe(modelConfiguration(openai).modelConfigSha256)
    expect(matchesModelConfiguration({ ...checkpoint, model: null, modelConfigSha256: null }, max, true)).toBe(true)
    expect(matchesModelConfiguration(highCheckpoint, high, true)).toBe(false)
  })

  it('rejects unknown, duplicated, missing and unsupported options before calling a model', () => {
    for (const args of [['--model', 'Claude-X'], ['--effort', 'none'], ['--thinking', 'on'], ['--effort'], ['--model', '--all'], ['--model', 'MiniMax-M3', '--model', 'MiniMax-M2.7']]) {
      expect(() => parseModelOptions(args)).toThrow()
    }
    expect(() => applyModelOptions(anthropic, { effort: 'max' })).toThrow('only')
    expect(() => applyModelOptions(anthropic, { model: 'MiniMax-M2.7', thinking: 'disabled' })).toThrow()
  })
})
