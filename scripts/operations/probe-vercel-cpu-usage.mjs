import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const USAGE_URL = 'https://api.vercel.com/v2/billing/costs?teamId=team_o5qghzfTOk24QwoYANzJ8hNH'
export const MAX_USAGE_BYTES = 1024 * 1024
const DEADLINE_MS = 25000
const DETAIL_VIEW = 'byProductRegionProject'
const DIMENSIONS = ['product', 'region', 'project']
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 1000
const utc = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
const requireSchema = condition => { if (!condition) throw new Error('response_schema_invalid') }

export function buildUsageRequest(now = new Date()) {
  return {
    from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString(),
    metrics: ['gross_cost', 'quantity'], format: 'timeseries',
    views: { byProductRegionProject: { groupBy: DIMENSIONS }, byProduct: { groupBy: ['product'] } },
    userAgent: 'vercel-cli.usage',
  }
}

/** Keep quantity columns and their actual units; never infer CPU seconds or sum overlapping views. */
export function sanitizeUsageResponse(payload) {
  requireSchema(object(payload) && Array.isArray(payload.metrics) && utc(payload.from) && utc(payload.to)
    && Date.parse(payload.from) < Date.parse(payload.to) && utc(payload.queriedAt) && object(payload.results))
  const metrics = new Map()
  for (const metric of payload.metrics) {
    requireSchema(object(metric) && text(metric.slug) && text(metric.title) && !metrics.has(metric.slug))
    let unit = null
    if (metric.unit !== null) {
      requireSchema(object(metric.unit) && text(metric.unit.kind))
      unit = { kind: metric.unit.kind }
      for (const key of ['name', 'singular', 'plural']) {
        if (metric.unit[key] !== undefined) { requireSchema(text(metric.unit[key])); unit[key] = metric.unit[key] }
      }
    }
    metrics.set(metric.slug, { slug: metric.slug, title: metric.title, unit })
  }
  const { granularity, times, views, dimensionsMeta } = payload.results
  requireSchema(object(granularity) && ['hour', 'day', 'week', 'month'].includes(granularity.unit)
    && Number.isSafeInteger(granularity.step) && granularity.step > 0 && Array.isArray(times)
    && times.every((time, index) => utc(time) && (index === 0 || Date.parse(time) > Date.parse(times[index - 1])))
    && object(views) && object(dimensionsMeta))
  const rows = []
  for (const [name, expectedDimensions] of [[DETAIL_VIEW, DIMENSIONS], ['byProduct', ['product']]]) {
    const view = views[name]
    requireSchema(object(view) && Array.isArray(view.groupBy) && view.groupBy.length === expectedDimensions.length
      && view.groupBy.every((key, index) => key === expectedDimensions[index]) && Array.isArray(view.results))
    for (const row of view.results) {
      requireSchema(object(row) && object(row.dimensionValues) && Array.isArray(row.metrics)
        && row.metrics.every(slug => text(slug) && metrics.has(slug)) && new Set(row.metrics).size === row.metrics.length
        && Array.isArray(row.totalValue) && row.totalValue.length === row.metrics.length
        && row.totalValue.every(Number.isFinite) && Array.isArray(row.values) && row.values.length === times.length
        && row.values.every(sample => Array.isArray(sample) && sample.length === row.metrics.length && sample.every(Number.isFinite))
        && (row.flatRate === undefined || typeof row.flatRate === 'boolean'))
      for (const key of expectedDimensions) requireSchema(row.dimensionValues[key] === null || text(row.dimensionValues[key]))
      const quantityColumns = row.metrics.map((slug, index) => ({ slug, index })).filter(column => column.slug !== 'gross_cost')
      requireSchema(quantityColumns.length <= 1)
      if (name !== DETAIL_VIEW || quantityColumns.length === 0) continue
      const { slug, index } = quantityColumns[0]
      requireSchema(row.totalValue[index] >= 0 && row.values.every(sample => sample[index] >= 0))
      rows.push({ dimensionValues: Object.fromEntries(DIMENSIONS.map(key => [key, row.dimensionValues[key]])),
        metricSlug: slug, quantity: row.totalValue[index], values: row.values.map(sample => sample[index]),
        unit: metrics.get(slug).unit, ...(row.flatRate === undefined ? {} : { flatRate: row.flatRate }) })
    }
  }
  const metadata = {}
  for (const dimension of DIMENSIONS) {
    const source = dimensionsMeta[dimension]
    if (source === undefined) continue
    requireSchema(object(source) && (source.values === undefined || object(source.values)))
    const ids = new Set(rows.map(row => row.dimensionValues[dimension]).filter(id => id !== null))
    metadata[dimension] = { values: Object.fromEntries([...ids].filter(id => source.values?.[id] !== undefined).map(id => {
      const entry = source.values[id]
      requireSchema(object(entry))
      const result = {}
      for (const key of ['title', 'category']) {
        if (entry[key] !== undefined) { requireSchema(text(entry[key])); result[key] = entry[key] }
      }
      return [id, result]
    })) }
  }
  const usedMetrics = new Set(rows.map(row => row.metricSlug))
  return { from: payload.from, to: payload.to, queriedAt: payload.queriedAt,
    granularity: { unit: granularity.unit, step: granularity.step }, times: [...times],
    metrics: [...metrics.values()].filter(metric => usedMetrics.has(metric.slug)), dimensionsMeta: metadata,
    view: { name: DETAIL_VIEW, groupBy: [...DIMENSIONS], rows } }
}

function containsSecret(value, token) {
  if (typeof value === 'string') return value.includes(token) || value.includes(encodeURIComponent(token))
  if (Array.isArray(value)) return value.some(item => containsSecret(item, token))
  return object(value) && Object.entries(value).some(([key, item]) => containsSecret(key, token) || containsSecret(item, token))
}

async function readBounded(response, signal) {
  if (Number(response.headers.get('content-length')) > MAX_USAGE_BYTES) {
    void response.body?.cancel().catch(() => {})
    throw new Error('response_too_large')
  }
  if (!response.body) throw new Error('response_malformed')
  const reader = response.body.getReader(), chunks = []
  let bytes = 0
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      bytes += item.value.byteLength
      if (bytes > MAX_USAGE_BYTES) { cancel(); throw new Error('response_too_large') }
      chunks.push(item.value)
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
    catch { throw new Error('response_malformed') }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock() }
}

/** One billing API read only. Injected transport/clock/deadline make failure behavior testable offline. */
export async function probeVercelCpuUsage(environment = process.env, transport = fetch, options = {}) {
  let request
  try { request = buildUsageRequest(options.now ?? new Date()) }
  catch { return { state: 'unavailable', httpStatus: null, errorCode: 'invalid_clock' } }
  const base = { schemaVersion: 1, observedAt: request.to, requestedWindow: { from: request.from, to: request.to },
    timeZone: 'Asia/Shanghai', monitoringEnabled: false, meteringVerified: false }
  let httpStatus = null
  const unavailable = errorCode => ({ ...base, state: 'unavailable', httpStatus, errorCode })
  const token = environment.VERCEL_TOKEN
  if (typeof token !== 'string' || token.length < 20 || token.length > 4000 || /\s/u.test(token)) return unavailable('credentials_missing_or_invalid')
  const controller = new AbortController()
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('request_timeout')) }, options.timeoutMs ?? DEADLINE_MS)
  })
  try {
    const operation = (async () => {
      const response = await transport(USAGE_URL, { method: 'POST', redirect: 'error', cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request), signal: controller.signal })
      httpStatus = response.status
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {})
        const codes = { 401: 'authentication_failed', 403: 'access_forbidden', 402: 'billing_unavailable',
          404: 'usage_endpoint_unavailable', 429: 'rate_limited' }
        throw new Error(response.status >= 300 && response.status < 400 ? 'redirect_rejected' : codes[response.status] ?? 'http_error')
      }
      const usage = sanitizeUsageResponse(await readBounded(response, controller.signal))
      if (containsSecret(usage, token)) throw new Error('sensitive_content_rejected')
      return { ...base, state: 'not_yet_verified', httpStatus, errorCode: null,
        reasonCode: usage.view.rows.length === 0 ? 'quantity_data_absent'
          : usage.view.rows.some(row => row.unit === null) ? 'quantity_units_missing' : 'quantity_response_requires_review',
        usage }
    })()
    return await Promise.race([operation, deadline])
  } catch (error) {
    const codes = new Set(['request_timeout', 'response_too_large', 'response_malformed', 'response_schema_invalid',
      'sensitive_content_rejected', 'authentication_failed', 'access_forbidden', 'billing_unavailable',
      'usage_endpoint_unavailable', 'rate_limited', 'redirect_rejected', 'http_error'])
    return unavailable(controller.signal.aborted ? 'request_timeout' : codes.has(error?.message) ? error.message : 'transport_failed')
  } finally { clearTimeout(timer) }
}

export async function runUsageProbe(args, environment = process.env, transport = fetch, options = {}) {
  if (args.length !== 2 || args[0] !== '--output' || typeof args[1] !== 'string' || !args[1].trim()) {
    return { state: 'unavailable', httpStatus: null, errorCode: 'output_argument_required' }
  }
  const result = await probeVercelCpuUsage(environment, transport, options)
  try {
    const output = resolve(args[1])
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    return result
  } catch { return { state: 'unavailable', httpStatus: result.httpStatus, errorCode: 'output_write_failed' } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runUsageProbe(process.argv.slice(2)).then(result => {
    console.log(JSON.stringify(result))
    if (result.state === 'unavailable') process.exitCode = 1
  }).catch(() => {
    console.log(JSON.stringify({ state: 'unavailable', httpStatus: null, errorCode: 'probe_failed' }))
    process.exitCode = 1
  })
}
