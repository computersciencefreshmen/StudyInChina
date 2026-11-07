import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const script = resolve(process.cwd(), 'scripts/operations/probe-vercel-cpu-usage.mjs')
const now = new Date('2026-11-07T09:40:00.000Z')
const token = 'synthetic-test-token-never-a-real-secret'
const environment = { VERCEL_TOKEN: token, VERCEL_API_URL: 'https://example.invalid/steal' }
type Result = { state: string; httpStatus: number | null; errorCode: string | null; reasonCode?: string; usage?: unknown }
type Transport = (url: string, init: RequestInit) => Promise<Response>
type Options = { now?: Date; timeoutMs?: number }
let probe: (env?: Record<string, string>, transport?: Transport, options?: Options) => Promise<Result>
let run: (args: string[], env?: Record<string, string>, transport?: Transport, options?: Options) => Promise<Result>
let maxBytes: number
beforeAll(async () => {
  ({ probeVercelCpuUsage: probe, runUsageProbe: run, MAX_USAGE_BYTES: maxBytes } = await import(script))
})

function payload() {
  return {
    from: '2026-11-06T09:40:00.000Z', to: now.toISOString(), queriedAt: now.toISOString(),
    metrics: [
      { slug: 'gross_cost', title: 'Cost', unit: { kind: 'currency', name: 'USD' } },
      { slug: 'example_cpu_quantity', title: 'Provider CPU quantity', unit: { kind: 'duration', singular: 'hour', plural: 'hours' } },
      { slug: 'example_transfer_quantity', title: 'Transfer', unit: { kind: 'data', name: 'byte' } },
    ],
    results: {
      granularity: { unit: 'hour', step: 1 }, times: ['2026-11-07T08:00:00.000Z', '2026-11-07T09:00:00.000Z'],
      dimensionsMeta: {
        product: { values: { cpu: { title: 'Fluid CPU', category: 'compute' }, transfer: { title: 'Transfer' } } },
        region: { values: { sin1: { title: 'Singapore' } } },
        project: { values: { study: { title: 'StudyInChina' }, other: { title: 'Other project' } } },
      },
      views: {
        byProductRegionProject: { groupBy: ['product', 'region', 'project'], results: [
          { dimensionValues: { product: 'cpu', region: 'sin1', project: 'study' },
            metrics: ['gross_cost', 'example_cpu_quantity'], values: [[991.25, 0.1], [992.25, 0.2]], totalValue: [999.25, 0.3] },
          { dimensionValues: { product: 'transfer', region: 'sin1', project: 'other' },
            metrics: ['example_transfer_quantity', 'gross_cost'], values: [[32, 993.25], [96, 994.25]], totalValue: [128, 998.25], flatRate: false },
        ] },
        byProduct: { groupBy: ['product'], results: [
          { dimensionValues: { product: 'cpu' }, metrics: ['gross_cost', 'example_cpu_quantity'],
            values: [[995.25, 4000], [996.25, 5000]], totalValue: [997.25, 9000] },
        ] },
      },
    },
  }
}
const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
const successful = () => probe(environment, async () => jsonResponse(payload()), { now })

describe('one-shot Vercel quantity preflight (no live requests)', () => {
  it('uses only the fixed API and official 24h UTC request, with redirects disabled', async () => {
    const transport = vi.fn<Transport>(async () => jsonResponse(payload()))
    const result = await probe(environment, transport, { now })
    expect(result).toMatchObject({ state: 'not_yet_verified', httpStatus: 200, errorCode: null,
      meteringVerified: false, monitoringEnabled: false, reasonCode: 'quantity_response_requires_review' })
    expect(transport).toHaveBeenCalledOnce()
    const [url, init] = transport.mock.calls[0]
    expect(url).toBe('https://api.vercel.com/v2/billing/costs?teamId=team_o5qghzfTOk24QwoYANzJ8hNH')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(String(init.body))).toEqual({ from: '2026-11-06T09:40:00.000Z', to: now.toISOString(),
      metrics: ['gross_cost', 'quantity'], format: 'timeseries', userAgent: 'vercel-cli.usage',
      views: { byProductRegionProject: { groupBy: ['product', 'region', 'project'] }, byProduct: { groupBy: ['product'] } } })
  })

  it('maps each quantity column to its actual unit regardless of column order; emits only the detail view', async () => {
    const result = await successful()
    expect(result.usage).toMatchObject({ from: payload().from, to: now.toISOString(), queriedAt: now.toISOString(),
      granularity: { unit: 'hour', step: 1 }, times: payload().results.times,
      view: { name: 'byProductRegionProject', groupBy: ['product', 'region', 'project'], rows: [
        { metricSlug: 'example_cpu_quantity', quantity: 0.3, values: [0.1, 0.2], unit: { kind: 'duration', singular: 'hour', plural: 'hours' } },
        { metricSlug: 'example_transfer_quantity', quantity: 128, values: [32, 96], unit: { kind: 'data', name: 'byte' } },
      ] } })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('gross_cost')
    expect(serialized).not.toContain('999.25')
    expect(serialized).not.toContain('byProduct"')
    expect(serialized).not.toContain('9000')
    expect(serialized).not.toContain('cpuSeconds')
  })

  it('strips unknown fields (including provider debug secrets) before persisting the result', async () => {
    const data = payload()
    Object.assign(data, { debug: token, headers: { Authorization: token } })
    Object.assign(data.metrics[1].unit, { providerSecret: token })
    Object.assign(data.results.views.byProductRegionProject.results[0], { rawResponse: token, gross_cost: 999.25 })
    Object.assign(data.results.dimensionsMeta.project.values.study, { internal: token })
    const directory = await mkdtemp(resolve(process.cwd(), '.tmp/vercel-cpu-probe-'))
    try {
      const output = resolve(directory, 'usage.json')
      const result = await run(['--output', output], environment, async () => jsonResponse(data), { now })
      expect(result.state).toBe('not_yet_verified')
      const saved = await readFile(output, 'utf8')
      expect(saved).not.toContain(token)
      expect(saved).not.toContain('gross_cost')
      expect(saved).not.toContain('rawResponse')
      expect(JSON.parse(saved)).toEqual(result)
      await run(['--output', output], environment, async () => new Response(`provider echoed ${token}`, { status: 401 }), { now })
      const failure = await readFile(output, 'utf8')
      expect(failure).not.toContain(token)
      expect(JSON.parse(failure)).toMatchObject({ state: 'unavailable', errorCode: 'authentication_failed' })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('rejects a credential echoed in an otherwise allowed metadata field', async () => {
    const data = payload(); data.metrics[1].title = token
    expect(await probe(environment, async () => jsonResponse(data), { now })).toMatchObject({
      state: 'unavailable', httpStatus: 200, errorCode: 'sensitive_content_rejected' })
  })

  it.each([[401, 'authentication_failed'], [403, 'access_forbidden'], [402, 'billing_unavailable'],
    [404, 'usage_endpoint_unavailable'], [429, 'rate_limited'], [500, 'http_error'], [302, 'redirect_rejected']])(
    'reports HTTP %i as unavailable without echoing the provider body', async (status, errorCode) => {
      const result = await probe(environment, async () => new Response(token, { status: Number(status) }), { now })
      expect(result).toMatchObject({ state: 'unavailable', httpStatus: status, errorCode })
      expect(JSON.stringify(result)).not.toContain(token)
      expect(result.usage).toBeUndefined()
    })

  it('does not expose native redirect or network exception messages', async () => {
    const result = await probe(environment, async () => { throw new TypeError(`fetch redirect failed ${token}`) }, { now })
    expect(result).toMatchObject({ state: 'unavailable', httpStatus: null, errorCode: 'transport_failed' })
    expect(JSON.stringify(result)).not.toContain(token)
  })

  it('rejects malformed JSON and incomplete or contradictory quantity schemas', async () => {
    expect(await probe(environment, async () => new Response(`not JSON ${token}`), { now })).toMatchObject({ errorCode: 'response_malformed' })
    const fixtures: unknown[] = [{}, { ...payload(), metrics: null }]
    const absentUnit = payload(); Object.assign(absentUnit.metrics[1], { unit: undefined }); fixtures.push(absentUnit)
    const missingColumn = payload(); missingColumn.results.views.byProductRegionProject.results[0].values[0] = [0.1]; fixtures.push(missingColumn)
    const missingBucket = payload(); missingBucket.results.views.byProductRegionProject.results[0].values.pop(); fixtures.push(missingBucket)
    const unknownMetric = payload(); unknownMetric.results.views.byProductRegionProject.results[0].metrics[1] = 'unmapped'; fixtures.push(unknownMetric)
    const invalidDate = payload(); invalidDate.from = '2026-02-30T00:00:00Z'; fixtures.push(invalidDate)
    for (const value of fixtures) {
      expect(await probe(environment, async () => jsonResponse(value), { now })).toMatchObject({
        state: 'unavailable', httpStatus: 200, errorCode: 'response_schema_invalid' })
    }
  })

  it('keeps empty data and null units unverified rather than recording zero CPU', async () => {
    const empty = payload(); empty.results.times = []; empty.results.views.byProduct.results = []; empty.results.views.byProductRegionProject.results = []
    const result = await probe(environment, async () => jsonResponse(empty), { now })
    expect(result).toMatchObject({ state: 'not_yet_verified', reasonCode: 'quantity_data_absent', meteringVerified: false })
    expect(JSON.stringify(result)).not.toContain('cpuSeconds')
    const missingUnit = payload(); Object.assign(missingUnit.metrics[1], { unit: null })
    expect(await probe(environment, async () => jsonResponse(missingUnit), { now })).toMatchObject({
      state: 'not_yet_verified', reasonCode: 'quantity_units_missing', meteringVerified: false })
  })

  it('bounds both announced and streamed body sizes to one MiB', async () => {
    const announced = new Response('{}', { headers: { 'Content-Length': String(maxBytes + 1) } })
    expect(await probe(environment, async () => announced, { now })).toMatchObject({ errorCode: 'response_too_large' })
    const cancel = vi.fn()
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(maxBytes)); controller.enqueue(new Uint8Array(1)) }, cancel })
    expect(await probe(environment, async () => new Response(body), { now })).toMatchObject({ errorCode: 'response_too_large' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('enforces a deadline even when the transport or body never resolves', async () => {
    const transport: Transport = vi.fn(() => new Promise<Response>(() => {}))
    expect(await probe(environment, transport, { now, timeoutMs: 10 })).toMatchObject({ errorCode: 'request_timeout' })
    const cancel = vi.fn()
    const body = new ReadableStream({ cancel })
    expect(await probe(environment, async () => new Response(body), { now, timeoutMs: 10 })).toMatchObject({
      state: 'unavailable', httpStatus: 200, errorCode: 'request_timeout' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('requires credentials and explicit output before making any request; CLI failure remains safe JSON', async () => {
    const transport = vi.fn<Transport>()
    expect(await probe({}, transport, { now })).toMatchObject({ errorCode: 'credentials_missing_or_invalid' })
    expect(await run([], environment, transport, { now })).toMatchObject({ errorCode: 'output_argument_required' })
    expect(transport).not.toHaveBeenCalled()
    const directory = await mkdtemp(resolve(process.cwd(), '.tmp/vercel-cpu-probe-'))
    try {
      const output = resolve(directory, 'failure.json')
      const env = { ...process.env }; delete env.VERCEL_TOKEN
      const cli = spawnSync(process.execPath, [script, '--output', output], { env, encoding: 'utf8', timeout: 10000 })
      expect(cli.status).toBe(1)
      expect(JSON.parse(cli.stdout)).toMatchObject({ state: 'unavailable', errorCode: 'credentials_missing_or_invalid' })
      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(JSON.parse(cli.stdout))
      expect(cli.stderr).toBe('')
      expect(cli.stdout).not.toContain(token)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
