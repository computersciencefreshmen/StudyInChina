import 'server-only'
import { cloudMiniMaxSchema, CLOUD_MONITOR_REFRESH_MS, type CloudMiniMaxSnapshot } from './cloud-minimax-contract'
import { remoteExecutorConfiguration } from './remote-executor'

type Cache = { url: string; token: string; until: number; good: CloudMiniMaxSnapshot | null; pending?: Promise<CloudMiniMaxSnapshot | null> }
let cache: Cache | null = null
/** Only the existing server-side telemetry credential is used. */
export async function readCloudMiniMax(): Promise<CloudMiniMaxSnapshot | null> {
  const config = remoteExecutorConfiguration()
  if (!config?.telemetryUrl || !config.token) return null
  const url = new URL('/internal/v1/admin-minimax-monitor', config.telemetryUrl).toString(), now = Date.now()
  if (!cache || cache.url !== url || cache.token !== config.token) cache = { url, token: config.token, until: 0, good: null }
  const saved = cache
  if (saved.pending) return saved.pending
  if (saved.until > now) return saved.good
  saved.pending = (async () => {
    try {
      const response = await fetch(url, { cache: 'no-store', redirect: 'error', headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(8_000) })
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 64 * 1024) throw new Error('unavailable')
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
      try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 64 * 1024) { await reader.cancel(); throw new Error('unavailable') }; chunks.push(item.value) } } finally { reader.releaseLock() }
      const data = cloudMiniMaxSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (Date.parse(data.generatedAt) > now + 30_000) throw new Error('future_observation')
      saved.good = data; saved.until = now + CLOUD_MONITOR_REFRESH_MS
      return data
    } catch {
      // Keep original observation timestamps when exposing old good data.
      if (saved.good) saved.good = { ...saved.good, quota: { ...saved.good.quota, state: saved.good.quota.observedAt ? 'stale' : 'unknown', code: 'quota_unavailable' }, ledgerState: saved.good.ledger ? 'stale' : 'unavailable', code: 'backend_unavailable' }
      saved.until = now + 15_000
      return saved.good
    } finally { saved.pending = undefined }
  })()
  return saved.pending
}
