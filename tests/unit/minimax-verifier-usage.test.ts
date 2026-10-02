import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildUsageReport, type UsageReceipt } from '../../scripts/ingestion/minimax-usage-ledger'
import * as usageLedger from '../../scripts/ingestion/minimax-usage-ledger'
import { compareBatch, createMiniMaxQuotaCoordinator, type ApiConfig, type Task } from '../../scripts/ingestion/verify-catalog-minimax'
import type { QuotaState } from '../../scripts/ingestion/minimax-quota'

const temporaryDirectories: string[] = []
const inputSha256 = 'a'.repeat(64)
const api: ApiConfig = { endpoint: 'https://api.minimaxi.com/anthropic/v1/messages', key: 'test-secret-must-not-be-saved', model: 'MiniMax-M3', anthropic: true, providerId: 'test-provider' }
const task: Task = { taskId: 'programs:test', collection: 'programs', record: { id: 'test' }, claims: [], sourceIds: [] }
const usage = { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 20 }
const output = JSON.stringify({ results: [{ taskId: task.taskId, verdicts: [] }] })

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const directory of temporaryDirectories.splice(0)) {
    if (!resolve(directory).startsWith(resolve('.tmp') + sep)) throw new Error('Unsafe verifier usage cleanup path')
    await rm(directory, { recursive: true, force: true })
  }
})

async function fixture() {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(join(resolve('.tmp'), 'minimax-verifier-usage-'))
  temporaryDirectories.push(root)
  const directory = join(root, '.official-harvest/minimax-verification', inputSha256.slice(0, 16))
  await mkdir(directory, { recursive: true })
  return { root, directory }
}

function freshQuota(): QuotaState {
  const now = Date.now()
  return { state: 'available', canRun: true, reason: 'plan_quota_available', model: api.model, pool: 'general', checkedAt: new Date(now).toISOString(), balanceFallbackAllowed: false,
    fiveHour: { startAt: new Date(now - 3_600_000).toISOString(), resetAt: new Date(now + 4 * 3_600_000).toISOString(), remainingPercent: 50, resetInMs: 4 * 3_600_000 },
    weekly: { startAt: new Date(now - 2 * 24 * 3_600_000).toISOString(), resetAt: new Date(now + 5 * 24 * 3_600_000).toISOString(), remainingPercent: 100, resetInMs: 5 * 24 * 3_600_000 } }
}

async function receipts(directory: string) {
  return Promise.all((await readdir(join(directory, 'usage-receipts'))).map(async file => JSON.parse(await readFile(join(directory, 'usage-receipts', file), 'utf8')) as UsageReceipt))
}

describe('MiniMax verifier immutable HTTP-attempt usage', () => {
  it('records successful attempts before the reusable response and retains quota/provider identity without credentials', async () => {
    const { root, directory } = await fixture()
    const quota = freshQuota()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: output }], usage }))))
    await expect(compareBatch([task], [], api, directory, inputSha256, createMiniMaxQuotaCoordinator(async () => quota, 2), 1)).resolves.toEqual([{ taskId: task.taskId, verdicts: [] }])
    const saved = await receipts(directory)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ inputSha256, providerId: api.providerId, model: api.model, httpStatus: 200, source: 'model-attempt', usage: { reportedTokens: 160 }, quotaWindow: { startAt: quota.fiveHour.startAt } })
    expect(saved[0].attemptId).toMatch(/^[a-f0-9-]{36}$/)
    expect(saved[0].requestSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(saved)).not.toContain(api.key)
    const responseFile = (await readdir(join(directory, 'responses')))[0]
    const response = JSON.parse(await readFile(join(directory, 'responses', responseFile), 'utf8'))
    expect(response.attemptId).toBe(saved[0].attemptId)
    expect((await buildUsageReport(root)).totals).toMatchObject({ attempts: 1, reportedTokens: 160, unknownUsageAttempts: 0 })
  })

  it.each(['null', '{broken', JSON.stringify({ results: [null] })])('preserves charged usage even when generated JSON is unusable (%s)', async raw => {
    const { root, directory } = await fixture()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: raw }], usage }))))
    await expect(compareBatch([task], [], api, directory, inputSha256, null, 1)).rejects.toThrow('MiniMax response')
    expect((await buildUsageReport(root)).totals).toMatchObject({ attempts: 1, reportedTokens: 160 })
    expect((await receipts(directory))[0].httpStatus).toBe(200)
  })

  it('records unknown usage for an invalid API envelope instead of silently losing the HTTP attempt', async () => {
    const { root, directory } = await fixture()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('malformed API envelope')))
    await expect(compareBatch([task], [], api, directory, inputSha256, null, 1)).rejects.toThrow('MiniMax response JSON invalid')
    expect((await buildUsageReport(root)).totals).toMatchObject({ attempts: 1, unknownUsageAttempts: 1, reportedTokens: 0 })
    expect((await receipts(directory))[0].usage.reportedTokens).toBeNull()
  })

  it('records HTTP error usage and never retries billing 402', async () => {
    const { root, directory } = await fixture()
    const send = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'private billing detail' }, usage }), { status: 402 }))
    vi.stubGlobal('fetch', send)
    await expect(compareBatch([task], [], api, directory, inputSha256, null, 3)).rejects.toThrow('MiniMax HTTP 402')
    expect(send).toHaveBeenCalledTimes(1)
    expect((await receipts(directory))[0]).toMatchObject({ httpStatus: 402, usage: { reportedTokens: 160 } })
    expect(JSON.stringify(await receipts(directory))).not.toContain('private billing detail')
    expect((await buildUsageReport(root)).totals.attempts).toBe(1)
  })

  it('preserves each retry with a distinct attempt ID and refreshed preflight instead of overwriting its usage', async () => {
    const { root, directory } = await fixture()
    const send = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ usage }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: 'text', text: output }], usage })))
    vi.stubGlobal('fetch', send)
    const query = vi.fn(async () => freshQuota())
    await compareBatch([task], [], api, directory, inputSha256, createMiniMaxQuotaCoordinator(query, 2), 2)
    const saved = await receipts(directory)
    expect(saved).toHaveLength(2)
    expect(new Set(saved.map(receipt => receipt.attemptId)).size).toBe(2)
    expect(new Set(saved.map(receipt => receipt.requestSha256)).size).toBe(1)
    expect(saved.map(receipt => receipt.httpStatus).sort()).toEqual([200, 500])
    expect(query).toHaveBeenCalledTimes(2)
    expect((await buildUsageReport(root)).totals).toMatchObject({ attempts: 2, reportedTokens: 320 })
  })

  it('stops retries and queued requests when the immutable receipt cannot be persisted', async () => {
    const { directory } = await fixture()
    const quota = freshQuota()
    quota.fiveHour.remainingPercent = 2
    const query = vi.fn(async () => quota)
    const guard = createMiniMaxQuotaCoordinator(query, 4)
    let finishFirst!: (reply: Response) => void
    const firstReply = new Promise<Response>(done => { finishFirst = done })
    const send = vi.fn(async () => firstReply)
    vi.stubGlobal('fetch', send)
    vi.spyOn(usageLedger, 'recordModelUsage').mockRejectedValueOnce(new Error('private filesystem failure'))
    const observed = Promise.allSettled([
      compareBatch([task], [], api, directory, inputSha256, guard, 3),
      compareBatch([task], [], api, directory, inputSha256, guard, 3),
    ])
    await vi.waitFor(() => { expect(send).toHaveBeenCalledTimes(1); expect(query).toHaveBeenCalledTimes(2) })
    finishFirst(new Response(JSON.stringify({ content: [{ type: 'text', text: output }], usage })))
    const results = await observed
    expect(results.every(result => result.status === 'rejected' && result.reason.message === 'MiniMax usage receipt unavailable')).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('records transport failure as an unknown attempt without leaking the transport message', async () => {
    const { root, directory } = await fixture()
    const send = vi.fn(async () => { throw new Error(`private request ${api.key}`) })
    vi.stubGlobal('fetch', send)
    await expect(compareBatch([task], [], api, directory, inputSha256, null, 1)).rejects.toThrow('MiniMax transport failed')
    const saved = await receipts(directory)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ httpStatus: null, usage: { status: 'missing', reportedTokens: null } })
    expect(JSON.stringify(saved)).not.toContain('private request')
    expect(JSON.stringify(saved)).not.toContain(api.key)
    expect((await buildUsageReport(root)).totals).toMatchObject({ attempts: 1, unknownUsageAttempts: 1 })
    expect((await buildUsageReport(root)).serverDashboardBillingTokens).toBeNull()
  })

  it('retains an unknown transport attempt across a bounded successful retry', async () => {
    const { root, directory } = await fixture()
    const send = vi.fn().mockRejectedValueOnce(new Error('private timeout'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: 'text', text: output }], usage })))
    vi.stubGlobal('fetch', send)
    const query = vi.fn(async () => freshQuota())
    await compareBatch([task], [], api, directory, inputSha256, createMiniMaxQuotaCoordinator(query, 2), 2)
    expect(send).toHaveBeenCalledTimes(2)
    expect(query).toHaveBeenCalledTimes(2)
    const saved = await receipts(directory)
    expect(saved).toHaveLength(2)
    expect(saved.find(receipt => receipt.httpStatus === null)?.usage.reportedTokens).toBeNull()
    expect((await buildUsageReport(root)).totals).toMatchObject({ attempts: 2, unknownUsageAttempts: 1, reportedTokens: 160 })
  })
})
