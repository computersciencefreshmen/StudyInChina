import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare'
import { cloudQuotaSchema } from '../../../src/lib/admin/cloud-minimax-contract'

const callerToken = 'rpc-monitor-test-caller-not-a-real-token'
const subscriptionKey = 'rpc-monitor-test-subscription-not-a-real-key'
const maintenanceToken = 'rpc-monitor-test-maintenance-not-a-real-token'
const quotaUrl = 'https://api.minimax.cn/v1/token_plan/remains'
const privateProviderMarker = 'provider-private-account-not-for-the-dashboard'

type ProviderMode = 'unlimited' | 'limited' | 'http-error' | 'malformed' | 'redirect'
type NativeWorker = { fetch(input: string): Promise<{ status: number }> }

async function fixture(mode: ProviderMode, configured = true) {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../src/entry.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    write: false, external: ['cloudflare:workers'],
  })
  const calls: Array<{ url: string; method: string }> = []
  const mf = new Miniflare(convertV4MiniflareOptions({
    host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false },
    workers: [{
      name: 'catalog-monitor-caller', modules: true,
      compatibilityDate: '2026-09-18',
      // The caller has only a read-only service capability. No provider or
      // maintenance admin credential is present in this Worker's bindings.
      bindings: { CALLER_TOKEN: callerToken },
      serviceBindings: { MAINTENANCE_MONITOR: { name: 'maintenance-monitor-target', entrypoint: 'MaintenanceMonitor' } },
      script: `export default { async fetch(request, env) {
        if (request.headers.get('authorization') !== 'Bearer ' + env.CALLER_TOKEN)
          return new Response(null, {status:403});
        if (request.method !== 'GET' || new URL(request.url).pathname !== '/monitor')
          return new Response(null, {status:404});
        return Response.json(await env.MAINTENANCE_MONITOR.readQuota(), {
          headers: {'Cache-Control':'private, no-store'}
        });
      } }`,
      outboundService: async () => { throw new Error('caller_external_network_forbidden') },
    }, {
      name: 'maintenance-monitor-target', modules: true,
      // The lockfile's workerd supports dates through 2026-09-18. This verifies
      // real RPC/global-fetch behavior, not production-date feature parity.
      compatibilityDate: '2026-09-18', script: bundled.outputFiles[0].text,
      bindings: {
        MAINTENANCE_ADMIN_TOKEN: maintenanceToken,
        MINIMAX_SUBSCRIPTION_KEY: configured ? subscriptionKey : '',
        MINIMAX_MODEL: 'MiniMax-M3',
        MINIMAX_ANTHROPIC_BASE: 'https://api.minimaxi.com/anthropic',
        MINIMAX_CREDIT_FALLBACK_DISABLED: 'false',
      },
      // No D1, R2, queue, or model DO is bound: touching one would fail. All
      // outgoing requests are intercepted; this test never reaches a provider.
      outboundService: async request => {
        calls.push({ url: request.url, method: request.method })
        assert.equal(request.url, quotaUrl)
        assert.equal(request.method, 'GET')
        assert.equal(request.headers.get('authorization'), `Bearer ${subscriptionKey}`)
        if (mode === 'http-error') return WorkerResponse.json({ error: subscriptionKey }, { status: 503 })
        if (mode === 'malformed') return new WorkerResponse(`not-json-${privateProviderMarker}`)
        if (mode === 'redirect') return new WorkerResponse(null, { status: 302, headers: { location: 'https://never-follow.invalid/credential-recipient' } })
        // Concurrent RPC calls overlap this GET, exercising the production
        // pending Promise rather than merely hitting an already warm cache.
        await new Promise(resolve => setTimeout(resolve, 25))
        const now = Date.now(), hour = 3_600_000
        return WorkerResponse.json({
          base_resp: { status_code: 0, status_msg: subscriptionKey },
          account_id: privateProviderMarker, api_key: subscriptionKey,
          model_remains: [{ model_name: 'general',
            current_interval_status: 1, current_interval_remaining_percent: 82.5,
            start_time: now - hour, end_time: now + 4 * hour,
            ...(mode === 'unlimited' ? { current_weekly_status: 3 } : {
              current_weekly_status: 1, current_weekly_remaining_percent: 61,
              weekly_start_time: now - 24 * hour, weekly_end_time: now + 6 * 24 * hour,
            }),
          }],
        })
      },
    }],
  }))
  try {
    await mf.ready
    return { mf, calls, read: () => mf.dispatchFetch('http://caller/monitor', { headers: { authorization: `Bearer ${callerToken}` } }) }
  } catch (error) { await mf.dispose(); throw error }
}

for (const mode of ['unlimited', 'limited'] as const) test(`real named RPC reads ${mode} quota with no provider secrets in the caller`, { timeout: 120_000 }, async () => {
  const f = await fixture(mode)
  try {
    assert.equal((await f.mf.dispatchFetch('http://caller/monitor')).status, 403)
    assert.equal(f.calls.length, 0)
    // Miniflare's generic ReplaceWorkersTypes currently infers this native
    // Fetcher as Request; narrow only the supported method used in this test.
    const maintenance = await f.mf.getWorker('maintenance-monitor-target') as unknown as NativeWorker
    assert.equal((await maintenance.fetch('https://maintenance.internal/health')).status, 200)
    assert.equal((await maintenance.fetch('https://maintenance.internal/quota')).status, 401)
    assert.equal(f.calls.length, 0)

    const responses = await Promise.all(Array.from({ length: 6 }, () => f.read()))
    const snapshots = await Promise.all(responses.map(async response => {
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      const text = await response.text()
      for (const secret of [subscriptionKey, maintenanceToken, callerToken, privateProviderMarker, 'providerTransport', 'providerObservation', 'model_remains']) assert.equal(text.includes(secret), false)
      return cloudQuotaSchema.parse(JSON.parse(text))
    }))
    const first = snapshots[0]
    assert.equal(first.state, 'fresh'); assert.equal(first.code, 'observed')
    assert.equal(first.fiveHour?.remainingPercent, 82.5)
    assert.equal(first.weekly?.unlimited, mode === 'unlimited')
    assert.equal(first.weekly?.remainingPercent, mode === 'unlimited' ? null : 61)
    assert.equal(first.modelCallsPerformed, false)
    if (mode === 'unlimited') assert.deepEqual(first.weekly, { unlimited: true, remainingPercent: null, startAt: null, resetAt: null })
    for (const snapshot of snapshots) assert.deepEqual(snapshot, first)
    assert.deepEqual(f.calls, [{ url: quotaUrl, method: 'GET' }])
    assert.deepEqual(cloudQuotaSchema.parse(await (await f.read()).json()), first)
    assert.equal(f.calls.length, 1)
  } finally { await f.mf.dispose() }
})

for (const mode of ['http-error', 'malformed', 'redirect', 'missing-key'] as const) test(`real named RPC reports ${mode} as unknown without model or alternate-host calls`, { timeout: 120_000 }, async () => {
  const f = await fixture(mode === 'missing-key' ? 'unlimited' : mode, mode !== 'missing-key')
  try {
    const response = await f.read()
    assert.equal(response.status, 200)
    const text = await response.text(), snapshot = cloudQuotaSchema.parse(JSON.parse(text))
    assert.equal(snapshot.state, 'unknown'); assert.equal(snapshot.code, 'quota_unavailable')
    assert.equal(snapshot.observedAt, null); assert.equal(snapshot.fiveHour, null); assert.equal(snapshot.weekly, null)
    assert.equal(snapshot.modelCallsPerformed, false)
    for (const secret of [subscriptionKey, maintenanceToken, privateProviderMarker, 'never-follow.invalid']) assert.equal(text.includes(secret), false)
    assert.deepEqual(f.calls, mode === 'missing-key' ? [] : [{ url: quotaUrl, method: 'GET' }])
    assert.deepEqual(cloudQuotaSchema.parse(await (await f.read()).json()), snapshot)
    assert.equal(f.calls.length, mode === 'missing-key' ? 0 : 1)
  } finally { await f.mf.dispose() }
})
