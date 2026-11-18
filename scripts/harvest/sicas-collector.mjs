import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { parseSicasProgram, sicasProgramIdentity, sourceHash } from './sicas-parser.mjs'
import { prioritizeSicasQueue } from './sicas-school-priority.mjs'
import { degreeBackfill, degreeDue, degreeHint, finishDegreeCheck, selectDegreeAndDiscovery } from './sicas-degree-backfill.mjs'

const HOST = 'www.sicas.com.cn'
const UA = 'StudyInChinaPublicResearch/1.0 (authorized public programme collection)'
const DAY = 86_400_000, MAX_BODY = 4 * 1024 * 1024, MAX_BYTES = 64 * 1024 * 1024
const iso = time => new Date(time).toISOString()
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const future = (value, now) => validTime(value) && Date.parse(value) > now
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

export function normalizeSicasState(input = {}) {
  const state = { schemaVersion: 1, provider: 'SICAS', cursor: Math.max(0, Math.floor(Number(input.cursor) || 0)), outcomes: {}, hosts: {} }
  if (validTime(input.updatedAt)) state.updatedAt = input.updatedAt
  for (const [id, row] of Object.entries(input.outcomes || {})) {
    if (!/^sicas-\d+$/.test(id) || !row || !['captured', 'unavailable', 'retry', 'invalid', 'blocked'].includes(row.status)) continue
    const safe = { status: row.status, attempts: Math.max(0, Math.floor(Number(row.attempts) || 0)) }
    for (const key of ['nextAttemptAt', 'fetchedAt']) if (validTime(row[key])) safe[key] = row[key]
    if (/^[a-z0-9_]{1,80}$/.test(row.errorCode || '')) safe.errorCode = row.errorCode
    if (Number.isInteger(row.httpStatus) && row.httpStatus >= 100 && row.httpStatus <= 599) safe.httpStatus = row.httpStatus
    if (/^[a-f0-9]{64}$/.test(row.rawSha256 || '')) safe.rawSha256 = row.rawSha256
    state.outcomes[id] = safe
  }
  const host = input.hosts?.[HOST]
  if (host && validTime(host.blockedUntil)) state.hosts[HOST] = {
    blockedUntil: host.blockedUntil, reason: /^[a-z0-9_]{1,80}$/.test(host.reason || '') ? host.reason : 'source_cooldown',
    ...(Number.isInteger(host.httpStatus) ? { httpStatus: host.httpStatus } : {}),
  }
  return state
}

export function roundRobinSicasSources(sources) {
  const byId = new Map()
  for (const source of sources || []) {
    if (source?.provider !== 'SICAS' || !/^sicas-\d+$/.test(source.id || '')) continue
    if (!byId.has(source.id)) byId.set(source.id, source)
  }
  const groups = new Map()
  for (const source of [...byId.values()].sort((a, b) => String(a.schoolId).localeCompare(String(b.schoolId), 'en', { numeric: true })
    || a.id.localeCompare(b.id, 'en', { numeric: true }))) {
    const group = groups.get(source.schoolId) || []
    group.push(source); groups.set(source.schoolId, group)
  }
  const result = []
  for (let offset = 0; result.length < byId.size; offset++) for (const group of groups.values()) if (group[offset]) result.push(group[offset])
  return result
}

export function sicasRobotsPolicy(text) {
  const groups = []; let agents = [], rules = [], crawlDelay = 0, startedRules = false
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.replace(/#.*$/, '').trim().match(/^([^:]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1].trim().toLowerCase(), value = match[2].trim()
    if (key === 'user-agent') {
      if (startedRules) { groups.push({ agents, rules, crawlDelay }); agents = []; rules = []; crawlDelay = 0; startedRules = false }
      agents.push(value.toLowerCase())
    } else if (agents.length && ['allow', 'disallow'].includes(key)) { rules.push({ allow: key === 'allow', value }); startedRules = true }
    else if (agents.length && key === 'crawl-delay' && Number.isFinite(Number(value))) { crawlDelay = Math.max(0, Number(value) * 1000); startedRules = true }
  }
  groups.push({ agents, rules, crawlDelay })
  const exact = groups.filter(group => group.agents.some(agent => agent !== '*' && 'studyinchinapublicresearch'.includes(agent)))
  const selected = exact.length ? exact : groups.filter(group => group.agents.includes('*'))
  return { delayMs: Math.max(750, ...selected.map(group => group.crawlDelay)), allows(url) {
    const path = new URL(url).pathname + new URL(url).search
    const matched = selected.flatMap(group => group.rules).filter(rule => {
      if (!rule.value) return false
      const pattern = rule.value.split('*').map(part => part.replace(/[.+?^{}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$')
      return new RegExp(`^${pattern}`).test(path)
    }).sort((a, b) => b.value.length - a.value.length || Number(b.allow) - Number(a.allow))
    return matched[0]?.allow ?? true
  } }
}

function retryDelay(attempts) { return Math.min(6 * 60 * 60_000, 15 * 60_000 * 2 ** Math.min(8, Math.max(0, attempts - 1))) }
function retryAfter(value, now) {
  const seconds = Number(value)
  const candidate = value && Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Date.parse(value || '')
  return Math.min(now + 2 * DAY, Math.max(now + 15 * 60_000, Number.isFinite(candidate) ? candidate : now + DAY))
}

/** Pure batch boundary: the caller owns durable state and canonical feed writes.
 * No model key, account, official site, or publication endpoint is touched here. */
export async function collectSicasBatch({ sources = [], state: inputState = {}, limit = 150, deadlineAt,
  environment = process.env, fetcher = globalThis.fetch, now = Date.now, sleeper = wait, archive, schoolTargets = new Map(), repairProgramId } = {}) {
  if (repairProgramId && !/^sicas-[1-9][0-9]{0,11}$/u.test(repairProgramId)) throw new Error('invalid_degree_repair_id')
  const state = normalizeSicasState(inputState), records = [], receipts = []
  const start = now(), deadline = Math.min(Number.isFinite(deadlineAt) ? deadlineAt : start + 9 * 60_000, start + 9 * 60_000)
  state.fieldBackfill = { degree: degreeBackfill(sources, inputState.fieldBackfill?.degree, start) }
  const degreeQueue = state.fieldBackfill.degree
  const parsedLimit = Number(limit)
  const maxRequests = Number.isFinite(parsedLimit) ? Math.max(0, Math.min(250, Math.floor(parsedLimit))) : 150
  const summary = { provider: 'SICAS', startedAt: iso(start), attempted: 0, captured: 0, unavailable: 0, deferred: 0,
    requests: 0, bytes: 0, modelCalls: 0, officialVerificationPerformed: false, maxInFlight: 0, stoppedHost: false }
  let nextStart = start, rateChain = Promise.resolve(), policy = null, stopped = false, inflight = 0
  const blocked = () => stopped || future(state.hosts[HOST]?.blockedUntil, now())
  const stop = (reason, status, until) => {
    stopped = true; summary.stoppedHost = true
    state.hosts[HOST] = { blockedUntil: iso(until), reason, ...(status ? { httpStatus: status } : {}) }
  }
  let rawDirectory = null
  if (environment.SICAS_RAW_DIR && environment.RUNNER_TEMP) {
    const root = resolve(environment.RUNNER_TEMP), candidate = resolve(environment.SICAS_RAW_DIR)
    if (candidate !== root && candidate.startsWith(root + sep)) rawDirectory = candidate
  }
  async function request(url, purpose) {
    if (blocked() || summary.requests >= maxRequests || summary.bytes >= MAX_BYTES || now() >= deadline) return { errorCode: 'batch_deferred' }
    // Serialize request starts, not whole responses. At most two details may be
    // in flight and every start on this host remains at least 750ms apart.
    const turn = rateChain.then(async () => {
      await sleeper(Math.max(0, nextStart - now()))
      if (blocked() || now() >= deadline || summary.requests >= maxRequests) return false
      nextStart = now() + (policy?.delayMs || 750)
      return true
    })
    rateChain = turn.then(() => undefined)
    if (!await turn) return { errorCode: 'batch_deferred' }
    const fetchedAt = iso(now())
    summary.requests++; inflight++; summary.maxInFlight = Math.max(summary.maxInFlight, inflight)
    let status, bytes = 0
    try {
      const response = await fetcher(url, { method: 'GET', redirect: 'manual',
        signal: AbortSignal.timeout(Math.max(1, Math.min(20_000, deadline - now()))),
        headers: { 'User-Agent': UA, Accept: purpose === 'robots' ? 'text/plain' : 'text/html,application/xhtml+xml' } })
      status = response.status
      const chunks = [], reader = response.body?.getReader()
      if (reader) while (true) {
        const part = await reader.read()
        if (part.done) break
        bytes += part.value.byteLength; summary.bytes += part.value.byteLength
        if (bytes > MAX_BODY || summary.bytes > MAX_BYTES) { await reader.cancel(); throw new Error('body_limit') }
        chunks.push(Buffer.from(part.value))
      }
      const body = Buffer.concat(chunks), html = body.toString('utf8'), rawSha256 = sourceHash(body)
      const receipt = { provider: 'SICAS', sourceUrl: url, finalUrl: url, method: 'GET', status, fetchedAt, bytes, rawSha256 }
      const challenge = /<title[^>]*>[^<]*(?:captcha|just a moment|access denied|security verification)/i.test(html)
        || /cf-chl-(?:opt|widget)|challenge-platform/.test(html)
      if (status === 403 || status === 429 || challenge) {
        receipt.errorCode = challenge ? 'source_challenge' : `http_${status}`
        stop(receipt.errorCode, status, status === 429 ? retryAfter(response.headers.get('retry-after'), now()) : now() + DAY)
      }
      if (rawDirectory && status === 200 && purpose === 'detail') {
        mkdirSync(rawDirectory, { recursive: true })
        const file = join(rawDirectory, `${rawSha256}.html.gz`)
        if (!existsSync(file)) writeFileSync(file, gzipSync(body), { flag: 'wx' })
      }
      receipts.push(receipt)
      return { receipt, html, body, status, location: response.headers.get('location'), contentType: response.headers.get('content-type') || '' }
    } catch (error) {
      const errorCode = error?.message === 'body_limit' ? 'body_limit' : error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'request_timeout' : 'network_error'
      receipts.push({ provider: 'SICAS', sourceUrl: url, finalUrl: url, method: 'GET', ...(status ? { status } : {}), fetchedAt, bytes, errorCode })
      return { errorCode }
    } finally { inflight-- }
  }
  const finish = () => {
    state.updatedAt = iso(now()); summary.finishedAt = state.updatedAt; summary.cursor = state.cursor
    summary.knownOutcomes = Object.keys(state.outcomes).length
    return { records, state, receipts, summary }
  }
  if (blocked() || start >= deadline || !sources.length || maxRequests === 0) { summary.stoppedHost = blocked(); return finish() }
  const robots = await request(`https://${HOST}/robots.txt`, 'robots')
  if (blocked()) return finish()
  if (robots.status === 404 || robots.status === 410) policy = sicasRobotsPolicy('')
  else if (robots.status === 200 && !/text\/html/i.test(robots.contentType) && !/<html|<!doctype/i.test(robots.html)) policy = sicasRobotsPolicy(robots.html)
  else {
    // Never follow a robots redirect to an HTML page or a different host.
    stop('robots_unavailable', robots.status, now() + 15 * 60_000)
    return finish()
  }
  const ordered = roundRobinSicasSources(sources), eligible = [], repairs = []
  if (!ordered.length) return finish()
  const initialCursor = state.cursor % ordered.length
  for (let scanned = 0; scanned < ordered.length; scanned++) {
    const index = (initialCursor + scanned) % ordered.length, source = ordered[index]
    const outcome = state.outcomes[source.id]
    const entry = { source, afterCursor: (index + 1) % ordered.length }
    if (degreeDue(degreeQueue, source.id, now()) && (outcome?.status === 'captured' || !future(outcome?.nextAttemptAt, now()))) {
      repairs.push(entry)
      continue
    }
    if (future(outcome?.nextAttemptAt, now())) continue
    if (source.status === 'extracted' && !outcome && validTime(source.fetchedAt) && /^[a-f0-9]{64}$/.test(source.evidenceHash || '')) {
      state.outcomes[source.id] = { status: 'captured', attempts: 0, fetchedAt: source.fetchedAt, rawSha256: source.evidenceHash,
        nextAttemptAt: iso(Math.max(now(), Date.parse(source.fetchedAt)) + 30 * DAY) }
      continue
    }
    eligible.push(entry)
  }
  const discovery = schoolTargets.size ? prioritizeSicasQueue(eligible, ordered, state.outcomes, schoolTargets) : eligible
  const orderedRepairs = prioritizeSicasQueue(repairs, ordered, state.outcomes, schoolTargets, row => degreeHint(row.fields?.description))
  const queue = selectDegreeAndDiscovery(discovery, orderedRepairs, Math.max(0, maxRequests - summary.requests), repairProgramId)
  let next = 0
  async function worker() {
    while (next < queue.length && !summary.archiveUnavailable && !blocked() && summary.requests < maxRequests && now() < deadline && summary.bytes < MAX_BYTES) {
      const { source, afterCursor } = queue[next++]
      state.cursor = afterCursor
      const attempts = (state.outcomes[source.id]?.attempts || 0) + 1
      const identity = sicasProgramIdentity(source.sourceUrl)
      if (!identity || source.id !== `sicas-${identity.programmeSourceId}` || (source.sourceId && String(source.sourceId) !== identity.programmeSourceId)
        || (source.schoolId && source.schoolId !== `sicas-${identity.schoolSourceId}`)) {
        state.outcomes[source.id] = { status: 'invalid', attempts: attempts - 1, nextAttemptAt: iso(now() + 30 * DAY), errorCode: 'invalid_source_identity' }
        continue
      }
      if (!policy.allows(identity.url)) {
        state.outcomes[source.id] = { status: 'blocked', attempts: attempts - 1, nextAttemptAt: iso(now() + DAY), errorCode: 'robots_disallowed' }
        continue
      }
      summary.attempted++
      const response = await request(identity.url, 'detail')
      if (response.errorCode === 'batch_deferred') { summary.deferred++; continue }
      const httpStatus = response.status, fetchedAt = response.receipt?.fetchedAt || iso(now())
      const base = { attempts, fetchedAt, ...(httpStatus ? { httpStatus } : {}), ...(response.receipt?.rawSha256 ? { rawSha256: response.receipt.rawSha256 } : {}) }
      if (blocked()) {
        state.outcomes[source.id] = { ...base, status: 'blocked', nextAttemptAt: state.hosts[HOST].blockedUntil, errorCode: state.hosts[HOST].reason }
      } else if (httpStatus === 404 || httpStatus === 410) {
        summary.unavailable++; state.outcomes[source.id] = { ...base, status: 'unavailable', nextAttemptAt: iso(now() + 7 * DAY), errorCode: `http_${httpStatus}` }
      } else if (httpStatus === 200) {
        if (archive) {
          try {
            await archive(response.body, response.receipt.rawSha256, identity.url)
            response.receipt.archiveSha256 = response.receipt.rawSha256
          } catch {
            summary.archiveUnavailable = true
            state.outcomes[source.id] = { ...base, status: 'retry', nextAttemptAt: iso(now() + retryDelay(attempts)), errorCode: 'private_archive_unavailable' }
            continue
          }
        }
        let record = null
        try { record = parseSicasProgram(response.html, { source, sourceUrl: identity.url, fetchedAt, rawSha256: response.receipt.rawSha256 }) } catch { /* Unsupported HTML stays retryable, never guessed. */ }
        if (record) {
          if (response.receipt.archiveSha256) record.archiveSha256 = response.receipt.archiveSha256
          finishDegreeCheck(degreeQueue, record, now())
          records.push(record); summary.captured++
          state.outcomes[source.id] = { ...base, status: 'captured', nextAttemptAt: iso(now() + 30 * DAY) }
        } else state.outcomes[source.id] = { ...base, status: 'retry', nextAttemptAt: iso(now() + retryDelay(attempts)), errorCode: 'unstructured_or_missing_identity' }
      } else {
        state.outcomes[source.id] = { ...base, status: 'retry', nextAttemptAt: iso(now() + retryDelay(attempts)),
          errorCode: response.errorCode || (httpStatus >= 300 && httpStatus < 400 ? 'redirect_not_followed' : `http_${httpStatus || 'unavailable'}`) }
      }
    }
  }
  await Promise.all([worker(), worker()])
  return finish()
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs, []))
  if (!flags.sources || !flags.output) throw new Error('Usage: node scripts/harvest/sicas-collector.mjs --sources <json> [--state <json>] --output <private-dir> [--limit 150] [--max-minutes 9]')
  const payload = JSON.parse(readFileSync(resolve(flags.sources), 'utf8'))
  const result = await collectSicasBatch({ sources: Array.isArray(payload) ? payload : payload.programs,
    state: flags.state && existsSync(resolve(flags.state)) ? JSON.parse(readFileSync(resolve(flags.state), 'utf8')) : {},
    limit: Number(flags.limit || 150), deadlineAt: Date.now() + Math.min(9, Math.max(0.01, Number(flags['max-minutes'] || 9))) * 60_000 })
  const output = resolve(flags.output); mkdirSync(output, { recursive: true })
  for (const key of ['records', 'state', 'receipts', 'summary']) writeFileSync(join(output, `${key}.json`), JSON.stringify(result[key]) + '\n')
  console.log(JSON.stringify(result.summary))
}
