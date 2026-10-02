import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildUsageReport, normalizeModelUsage, recordModelUsage, seedHistoricalUsage, shanghaiUsageDay, type UsageMetadata } from '../../scripts/ingestion/minimax-usage-ledger'
import type { QuotaState } from '../../scripts/ingestion/minimax-quota'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const inputSha256 = 'a'.repeat(64)
const runId = inputSha256.slice(0, 16)
const metadata: UsageMetadata = { attemptId: 'unique-attempt-1', requestedAt: '2026-10-01T15:59:59.000Z', receivedAt: '2026-10-01T16:00:01.000Z', inputSha256,
  model: 'MiniMax-M3', modelConfigSha256: 'b'.repeat(64), providerId: 'test-provider', requestSha256: 'c'.repeat(64), httpStatus: 200, apiFormat: 'anthropic' }
const usage = { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 200, cache_creation_input_tokens: 30 }
const quota: QuotaState = { state: 'available', canRun: true, reason: 'plan_quota_available', model: 'MiniMax-M3', pool: 'general', checkedAt: '2026-10-01T15:59:58.000Z', balanceFallbackAllowed: false,
  fiveHour: { startAt: '2026-10-01T12:00:00.000Z', resetAt: '2026-10-01T17:00:00.000Z', remainingPercent: 54, resetInMs: 3_600_000 },
  weekly: { startAt: null, resetAt: null, remainingPercent: 90, resetInMs: null } }
const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const directory of temporaryDirectories.splice(0)) {
    if (!resolve(directory).startsWith(resolve('.tmp') + sep)) throw new Error('Unsafe usage test cleanup path')
    await rm(directory, { recursive: true, force: true })
  }
})

async function fixture() {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Usage accounting must not fetch') }))
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(join(resolve('.tmp'), 'minimax-usage-'))
  temporaryDirectories.push(root)
  const directory = join(root, '.official-harvest/minimax-verification', runId)
  await mkdir(join(directory, 'responses'), { recursive: true })
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ inputSha256, model: 'MiniMax-M3', providerId: 'manifest-provider-must-not-be-guessed' }))
  return { root, directory }
}

describe('MiniMax truthful token usage accounting', () => {
  it('keeps Anthropic disjoint cache buckets and OpenAI cache/reasoning subsets from being counted twice', () => {
    const anthropic = normalizeModelUsage(usage, 'anthropic')
    expect(anthropic).toMatchObject({ inputTokens: 330, uncachedInputTokens: 100, cacheReadTokens: 200, cacheWriteTokens: 30, outputTokens: 40, reportedTokens: 370 })
    const openai = normalizeModelUsage({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cache_read_input_tokens: 40,
      prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 20 } }, 'openai-chat')
    expect(openai).toMatchObject({ inputTokens: 100, uncachedInputTokens: 60, cacheReadTokens: 40, outputTokens: 50, reasoningTokens: 20, reportedTokens: 150 })
    const responses = normalizeModelUsage({ input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 20 } }, 'openai-responses')
    expect(responses.reportedTokens).toBe(150)
  })

  it('does not turn malformed counters or contradictory aliases into fabricated usage', () => {
    expect(normalizeModelUsage(null, 'anthropic')).toMatchObject({ status: 'missing', reportedTokens: null })
    expect(normalizeModelUsage({ input_tokens: '100', output_tokens: 5 }, 'anthropic')).toMatchObject({ status: 'invalid', reportedTokens: null })
    expect(normalizeModelUsage({ input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 40, input_tokens_details: { cached_tokens: 41 } }, 'anthropic').reportedTokens).toBeNull()
    expect(normalizeModelUsage({ prompt_tokens: 100, completion_tokens: 5, total_tokens: 999 }, 'openai-chat').warnings).toContain('API total_tokens differs from protocol bucket sum')
  })

  it('uses Shanghai midnight correctly, retaining both request and reply days and official admission windows', async () => {
    expect(shanghaiUsageDay('2026-10-01T15:59:59.999Z')).toBe('2026-10-01')
    expect(shanghaiUsageDay('2026-10-01T16:00:00.000Z')).toBe('2026-10-02')
    const { root, directory } = await fixture()
    await recordModelUsage(directory, metadata, usage, quota)
    const report = await buildUsageReport(root, 144_000_000)
    expect(report.daily[0]).toMatchObject({ day: '2026-10-02', reportedTokens: 370, remainingToTarget: 143_999_630 })
    expect(report.windows[0]).toMatchObject({ startAt: quota.fiveHour.startAt, resetAt: quota.fiveHour.resetAt, totals: { reportedTokens: 370 } })
    expect(report.providersAndModels[0]).toMatchObject({ providerId: 'test-provider', model: 'MiniMax-M3' })
    const receipt = JSON.parse(await readFile(join(directory, 'usage-receipts', `${hash(metadata.attemptId)}.json`), 'utf8'))
    expect(receipt.requestDay).toBe('2026-10-01')
    expect(report.planQuotaDebitTokens).toBeNull()
    expect(report.serverDashboardBillingTokens).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('publishes one immutable attempt under concurrent retries and excludes private runtime fields', async () => {
    const { root, directory } = await fixture()
    const values = await Promise.all(Array.from({ length: 5 }, () => recordModelUsage(directory, { ...metadata, key: 'test-private-key', endpoint: 'private-url' } as UsageMetadata, { ...usage, api_key: 'test-private-key' }, quota)))
    expect(values.filter(value => value.created)).toHaveLength(1)
    const text = await readFile(join(directory, values[0].receiptFile), 'utf8')
    expect(text).not.toContain('test-private-key')
    expect(text).not.toContain('private-url')
    expect((await buildUsageReport(root)).totals.reportedTokens).toBe(370)
    await expect(recordModelUsage(directory, metadata, { ...usage, output_tokens: 41 }, quota)).rejects.toThrow('already exists')
  })

  it('retains usage even when no usable model JSON/final response receipt was saved and handles absent usage explicitly', async () => {
    const { root, directory } = await fixture()
    await recordModelUsage(directory, metadata, usage)
    await recordModelUsage(directory, { ...metadata, attemptId: 'missing-usage', httpStatus: 500 }, null)
    const report = await buildUsageReport(root)
    expect(report.totals).toMatchObject({ attempts: 2, instrumentedAttempts: 2, reportedTokens: 370, unknownUsageAttempts: 1 })
    expect(report.windows[0].id).toBe('unknown')
    expect(report.rejectedReceipts).toBe(0)
  })

  it('allows null HTTP status only for unmeasured model-attempt transport receipts', async () => {
    const { root, directory } = await fixture()
    await recordModelUsage(directory, { ...metadata, httpStatus: null }, null)
    expect((await buildUsageReport(root)).totals).toMatchObject({ attempts: 1, unknownUsageAttempts: 1 })
    await expect(recordModelUsage(directory, { ...metadata, attemptId: 'forged-counters', httpStatus: null }, usage)).rejects.toThrow('cannot contain measured counters')
    await expect(recordModelUsage(directory, { ...metadata, attemptId: 'forged-history', httpStatus: null, source: 'historical-response' }, null)).rejects.toThrow('Historical usage')
    await expect(recordModelUsage(directory, { ...metadata, attemptId: 'fractional-status', httpStatus: 200.5 }, null)).rejects.toThrow('metadata')
  })

  it('seeds historical surviving responses idempotently, preserves overwrites thereafter and never guesses historical provider', async () => {
    const { root, directory } = await fixture()
    const file = join(directory, 'responses', `${'d'.repeat(64)}.json`)
    const response = { checkedAt: metadata.receivedAt, model: metadata.model, modelConfigSha256: metadata.modelConfigSha256, requestSha256: metadata.requestSha256, usage }
    await writeFile(file, JSON.stringify(response))
    expect(await seedHistoricalUsage(directory)).toMatchObject({ added: 1, reused: 0 })
    expect(await seedHistoricalUsage(directory)).toMatchObject({ added: 0, reused: 1 })
    await writeFile(file, JSON.stringify({ ...response, checkedAt: '2026-10-01T17:00:01.000Z', usage: { ...usage, output_tokens: 41 } }))
    expect(await seedHistoricalUsage(directory)).toMatchObject({ added: 1 })
    const report = await buildUsageReport(root)
    expect(report.totals).toMatchObject({ attempts: 2, instrumentedAttempts: 0, historicalResponses: 2, historicalReportedTokensLowerBound: 741, reportedTokens: 741 })
    expect(report.providersAndModels[0].providerId).toBeNull()
    expect(report.methodology).toContain('lower bound')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not seed an instrumented response a second time', async () => {
    const { root, directory } = await fixture()
    await recordModelUsage(directory, metadata, usage)
    await writeFile(join(directory, 'responses', `${'d'.repeat(64)}.json`), JSON.stringify({ attemptId: metadata.attemptId, checkedAt: metadata.receivedAt, model: metadata.model, requestSha256: metadata.requestSha256, usage }))
    expect(await seedHistoricalUsage(directory)).toMatchObject({ added: 0, alreadyInstrumented: 1 })
    expect((await buildUsageReport(root)).totals.reportedTokens).toBe(370)
  })

  it('deduplicates copied receipts across runs and rejects tampered totals', async () => {
    const { root, directory } = await fixture()
    const { receiptFile } = await recordModelUsage(directory, metadata, usage, quota)
    const copiedRun = `${runId}-${'e'.repeat(12)}-r${'f'.repeat(12)}`
    const copiedDirectory = join(resolve(directory, '..'), copiedRun)
    await mkdir(join(copiedDirectory, 'usage-receipts'), { recursive: true })
    const original = await readFile(join(directory, receiptFile), 'utf8')
    await writeFile(join(copiedDirectory, receiptFile), original)
    const report = await buildUsageReport(root)
    expect(report.totals.reportedTokens).toBe(370)
    expect(report.duplicateReceiptCopies).toBe(1)
    const tampered = JSON.parse(original)
    tampered.usage.reportedTokens = 144_000_000
    await writeFile(join(copiedDirectory, receiptFile), JSON.stringify(tampered))
    const checked = await buildUsageReport(root)
    expect(checked.totals.reportedTokens).toBe(370)
    expect(checked.rejectedReceipts).toBe(1)
  })

  it('fails closed on invalid identities and does not infer a window from quota observed after admission', async () => {
    const { root, directory } = await fixture()
    await expect(recordModelUsage(directory, { ...metadata, providerId: 'unsafe\nvalue' }, usage)).rejects.toThrow('provider ID')
    await expect(recordModelUsage(directory, { ...metadata, attemptId: '../escape' }, usage)).rejects.toThrow('metadata')
    await recordModelUsage(directory, metadata, usage, { ...quota, checkedAt: metadata.receivedAt })
    expect((await buildUsageReport(root)).windows[0].id).toBe('unknown')
  })
})
