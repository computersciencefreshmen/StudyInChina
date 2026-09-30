import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildVerificationArguments, getVerificationCapabilities, parseVerificationRequest } from '../../src/lib/admin/verification'
import { catalogSnapshot, normalizeTokenUsage } from '../../src/lib/admin/snapshot'
import type { DataBundle } from '../../src/lib/data/types'

afterEach(() => vi.unstubAllEnvs())

describe('administrator verification scope and measurements', () => {
  it('allows typed choices while rejecting shell fragments, paths and unsupported effort', () => {
    expect(() => parseVerificationRequest({ collection: 'universities;cmd', mode: 'full' })).toThrow()
    expect(() => parseVerificationRequest({ collection: 'all', mode: 'sample', command: 'arbitrary' })).toThrow()
    expect(() => parseVerificationRequest({ collection: 'all', mode: 'sample', limit: 201 })).toThrow()
    expect(() => parseVerificationRequest({ collection: 'all', mode: 'sample', model: 'MiniMax-M3', effort: 'max' })).toThrow()
    expect(buildVerificationArguments(parseVerificationRequest({ collection: 'programs', mode: 'sample', model: 'MiniMax-M3.1-Flash-Preview', effort: 'max' }), true)).toEqual(['--use-ccswitch', '--collection', 'programs', '--limit', '20', '--concurrency', '2', '--batch-size', '2', '--model', 'MiniMax-M3.1-Flash-Preview', '--thinking', 'adaptive', '--effort', 'max'])
  })

  it('requires local opt-in and disables subprocesses in managed cloud runtimes', () => {
    expect(getVerificationCapabilities({ MINIMAX_API_KEY: 'synthetic-test-key' }).localMonitoring).toBe(false)
    expect(getVerificationCapabilities({ ADMIN_LOCAL_VERIFICATION_ENABLED: 'true', MINIMAX_API_KEY: 'synthetic-test-key' }).startVerification).toBe(true)
    expect(getVerificationCapabilities({ ADMIN_LOCAL_VERIFICATION_ENABLED: 'true', MINIMAX_API_KEY: 'synthetic-test-key', VERCEL: '1' }).startVerification).toBe(false)
    expect(getVerificationCapabilities({ ADMIN_LOCAL_VERIFICATION_ENABLED: 'true', MINIMAX_API_KEY: 'synthetic-test-key', CF_PAGES: '1' }).localMonitoring).toBe(false)
  })

  it('normalizes both API formats without double-counting cached OpenAI input', () => {
    const date = '2026-09-30T10:00:00Z'
    expect(normalizeTokenUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40 } }, date)).toMatchObject({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 40, requests: 1 })
    expect(normalizeTokenUsage({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 }, date)).toMatchObject({ inputTokens: 150, outputTokens: 20, totalTokens: 170, cacheReadTokens: 40, cacheWriteTokens: 10 })
    expect(normalizeTokenUsage({ input_tokens: -10, output_tokens: 'secret' }, date)).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 })
  })

  it('separates overdue review work from the stored verification state', () => {
    const records = [{ status: 'verified', reviewAfter: '2026-09-01' }, { status: 'verified', reviewAfter: '2026-11-01' }, { status: 'draft', reviewAfter: '2026-11-01' }, { status: 'stale', reviewAfter: '2026-11-01' }]
    const data = { universities: records, programs: [], admissionCycles: [], scholarships: [], cities: [], sources: [{ official: true }, { official: false }] } as unknown as DataBundle
    expect(catalogSnapshot(data, '2026-09-30')).toMatchObject({ totalRecords: 6, overdueRecords: 1, officialSources: 1, statuses: { verified: 2, needsReview: 3, draft: 1, stale: 1 } })
  })
})
