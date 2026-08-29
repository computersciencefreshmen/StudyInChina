#!/usr/bin/env node

'use strict'

const { createHash } = require('node:crypto')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

const ROOT = path.resolve(__dirname, '../..')
const QUALITY_DIR = path.join(ROOT, 'quality/official-depth-wave-4-2026-08-26')
const LEDGER_PATH = path.join(QUALITY_DIR, 'priority-ledger.json')
const CLOSURE_PATH = path.join(QUALITY_DIR, 'priority-source-closure.json')
const RECEIPT_PATH = path.join(QUALITY_DIR, 'priority-r2-receipt-2026-08-26.json')
const TEMP_DIR = path.join(os.tmpdir(), 'studyinchina-wave4-priority-2026-08-26')
const WRANGLER = path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js')
const WRANGLER_CONFIG = path.join(ROOT, 'workers/ingestion/wrangler.jsonc')
const PDFTOTEXT = process.env.PDFTOTEXT_PATH
  || 'pdftotext'

const BUCKET = 'studyinchina-source-snapshots'
const CHECKED_AT = '2026-08-26'
const MINIMUM_HOST_INTERVAL_MS = 5_000
const MAX_BYTES = 80 * 1024 * 1024
const MAX_REDIRECTS = 5
const USER_AGENT = 'StudyInChinaBot/1.0 (+https://studyinchina.vercel.app/en/guides/data-verification)'

const SAFE_DECISIONS = new Set([
  'promote_current_or_stable',
  'promote_historical_cycle_only',
])

const OFFICIAL_HOST_ALLOWLIST = new Set([
  'admission.blcu.edu.cn',
  'admissions.swu.edu.cn',
  'admissions.xmu.edu.cn',
  'apply.shu.edu.cn',
  'gjxy.swu.edu.cn',
  'iso.fudan.edu.cn',
  'lxs.ecnu.edu.cn',
  'oec.xmu.edu.cn',
  'osao.bfsu.edu.cn',
  'study.njust.edu.cn',
  'www-en.hnu.edu.cn',
])

// Each inner array is an OR group; every group must match the normalized source text.
// These anchors are deliberately narrower than page identity: together they assert the
// exact rows, amounts, dates, or route requirements used by the safe ledger facts.
const SOURCE_EXPECTATIONS = {
  'swu-education-live': [['Education'], ['4 years'], ['18000'], ['Chinese']],
  'swu-engineering-live': [['Environmental Science and Engineering'], ['3 years'], ['24000'], ['28000']],
  'swu-chinese-training-live': [['One-year Program'], ['One-Semester Chinese Program'], ['15000'], ['8000'], ['valid foreign passport', 'passport']],
  'swu-icl-master-plan-2024': [['国际中文教育', '汉语国际教育'], ['学制一般为3年'], ['最长不超过5年']],
  'swu-icl-scholarship-2026': [['国际中文教师奖学金'], ['2026'], ['5月15', '5月 15'], ['HSK'], ['HSKK']],
  'ecnu-undergraduate-live': [['General Information'], ['Duration: 4 years', 'Duration 4 years'], ['June 15'], ['Application procedures']],
  'ecnu-graduate-program-table-live': [['International Chinese Language Education'], ['25800'], ['2 years'], ['Putuo']],
  'blcu-undergraduate-live-2026': [['Chinese Language'], ['Finance'], ['25800'], ['39000'], ['June 30, 2026', 'JUNE 30, 2026']],
  'blcu-graduate-live': [['International Chinese Education'], ['30000'], ['Application Procedures']],
  'blcu-icl-scholarship-2026': [['International Chinese Language Teachers Scholarship'], ['2026'], ["Master's Degree", 'Master’s Degree'], ['One-Semester'], ['October 31', '31 October', 'Oct 31'], ['HSK']],
  'njust-undergraduate-catalogue-2026': [['2026'], ['International Economics and Trade', 'International Trade'], ['Mechanical Engineering'], ['Nanomaterials and Nanotechnology'], ['Software Engineering'], ['Teaching Language']],
  'njust-official-application': [['Nanjing University of Science and Technology', '南京理工大学'], ['International', '留学生']],
  'bfsu-undergraduate-2026': [['2026'], ['International Business'], ['Finance'], ['International Economics and Trade', 'International Trade'], ['39900'], ['Application Procedures', 'Application Opening Periods', 'Application Period']],
  'bfsu-scll-live': [['Chinese Training Programs for International Students'], ['18 weeks'], ['12000'], ['December 15'], ['entrance examination']],
  'bfsu-icl-scholarship-2026': [['International Chinese Language Teachers Scholarship'], ['2026'], ['One-Semester'], ['December 30'], ['HSK']],
  'hnu-csc-postgraduate-2026': [['2026'], ['Chinese Government Scholarship'], ['March 1'], ['Bachelor', 'Master'], ['IELTS'], ['TOEFL']],
  'hnu-self-financed-2025': [['2025'], ['19000'], ['21000'], ['3000'], ['Tuition']],
  'xmu-costs-live': [['Tuition Fee in RMB per academic year'], ['Digital Media Art'], ['Environmental Design'], ['Visual Communication Design'], ['90000'], ['International Chinese Language Education'], ['30000'], ['400']],
  'xmu-chinese-program-live': [['Long-term Chinese Language Program'], ['Spring 2027', 'February 2027 to June 2027', 'February to June 2027'], ['13000'], ['December 30, 2026'], ['18-55', 'between 18 and 55', 'aged 18 to 55']],
  'xmu-icl-scholarship-2026': [['International Chinese Language Education'], ['2026'], ['May 15', '15 May'], ['HSK 5', 'HSK Level 5', 'HSK Test (Level 5)'], ['HSKK']],
  'shu-business-chinese-2026': [['商务汉语'], ['18周', '18 周'], ['9900'], ['6月30', 'June 30'], ['HSK 4']],
  'shu-one-year-chinese-2026': [['长期汉语进修'], ['18周', '18 周'], ['19800'], ['1月15', 'January 15']],
  'shu-icl-scholarship-2026': [['国际中文教师奖学金'], ['2026'], ['10月31', 'October 31'], ['5月15', 'May 15'], ['HSK'], ['HSKK']],
  'fudan-cebp-2026': [['Chinese Economy and Business Program', 'Chinese Economy & Business Program'], ['12500'], ['25000'], ['June 12'], ['HSK 5', 'HSK Level 5', 'HSK Test (Level 5)']],
  'fudan-icl-language-2026': [['International Chinese Language Teachers Scholarship'], ['One-Semester'], ['October 31', '31 October'], ['HSK 3', 'HSK Level 3', 'HSK Test (Level 3)'], ['HSKK']],
  'fudan-icl-master-2026': [['International Chinese Language Education', 'Chinese Language Education'], ['three years', '3 years'], ['two years', '2 years'], ['May 15', '15 May'], ['HSK 6', 'HSK Level 6', 'HSK Test (Level 6)'], ['HSKK']],
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeText(value) {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function assertOfficialUrl(rawUrl) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('unsafe_official_url')
  }
  if (!OFFICIAL_HOST_ALLOWLIST.has(url.hostname.toLowerCase())) {
    throw new Error('host_not_allowlisted')
  }
  return url
}

function selectEvidenceRefs(programId, factName, fact) {
  const refs = Array.isArray(fact.evidenceRefs) ? fact.evidenceRefs : []
  // The immutable SHU scholarship PDF contains both coverage and route details;
  // the live scholarship index is therefore not part of the *minimum* closure.
  if (programId === 'program-shu-iclt-one-semester-spring-2027' && factName === 'tuition') {
    return refs.filter((ref) => ref !== 'shu-scholarship-live')
  }
  return refs
}

function buildClosure(ledger) {
  const sourceById = new Map()
  for (const university of ledger.universities) {
    for (const source of university.sources) {
      if (sourceById.has(source.id)) throw new Error(`duplicate_source_id:${source.id}`)
      sourceById.set(source.id, { ...source, universityId: university.universityId })
    }
  }

  const packages = []
  const requiredSourceIds = new Set()
  for (const university of ledger.universities) {
    for (const program of university.programs) {
      if (!SAFE_DECISIONS.has(program.decision)) continue
      const sourceIds = new Set()
      const factDependencies = []
      for (const [factName, fact] of Object.entries(program.facts)) {
        const refs = selectEvidenceRefs(program.programId, factName, fact)
        for (const ref of refs) {
          if (!sourceById.has(ref)) throw new Error(`unregistered_source:${program.programId}:${ref}`)
          sourceIds.add(ref)
          requiredSourceIds.add(ref)
        }
        if (refs.length) factDependencies.push({ factName, sourceIds: [...refs].sort() })
      }
      packages.push({
        programId: program.programId,
        universityId: university.universityId,
        decision: program.decision,
        disposition: program.decision === 'promote_historical_cycle_only'
          ? 'historical_stale_reference'
          : 'current_or_stable',
        sourceIds: [...sourceIds].sort(),
        factDependencies,
      })
    }
  }

  const sources = [...requiredSourceIds].sort().map((sourceId) => {
    const source = sourceById.get(sourceId)
    assertOfficialUrl(source.url)
    if (!SOURCE_EXPECTATIONS[sourceId]) throw new Error(`missing_content_expectation:${sourceId}`)
    return {
      sourceId,
      officialUrl: source.url,
      universityId: source.universityId,
      temporalClass: source.temporalClass,
      locator: source.locator,
      expectationGroupCount: SOURCE_EXPECTATIONS[sourceId].length,
      dependentProgramIds: packages
        .filter((item) => item.sourceIds.includes(sourceId))
        .map((item) => item.programId)
        .sort(),
    }
  })

  const hosts = [...new Set(sources.map((source) => new URL(source.officialUrl).hostname))].sort()
  if (packages.length !== 38) throw new Error(`safe_package_count_mismatch:${packages.length}`)
  if (sources.length !== 26) throw new Error(`minimal_source_count_mismatch:${sources.length}`)

  return {
    schemaVersion: 'studyinchina.wave4-priority-source-closure.v1',
    checkedAt: CHECKED_AT,
    policy: {
      officialHttpsOnly: true,
      explicitHostAllowlist: hosts,
      perHostConcurrency: 1,
      minimumAdjacentRequestIntervalMs: MINIMUM_HOST_INTERVAL_MS,
      contentAddressedR2: true,
      fullReadbackRequired: true,
      failClosedPerPackage: true,
      formalCatalogWriteAllowed: false,
    },
    summary: {
      safePackages: packages.length,
      historicalStaleReferencePackages: packages.filter((item) => item.disposition === 'historical_stale_reference').length,
      currentOrStablePackages: packages.filter((item) => item.disposition === 'current_or_stable').length,
      minimumSources: sources.length,
      hosts: hosts.length,
      redundantSourcesExcluded: ['shu-scholarship-live'],
    },
    sources,
    packages: packages.sort((a, b) => a.programId.localeCompare(b.programId)),
  }
}

function isPdf(source, contentType, bytes) {
  return source.officialUrl.toLowerCase().includes('.pdf')
    || String(contentType).toLowerCase().includes('application/pdf')
    || bytes.subarray(0, 5).toString('ascii') === '%PDF-'
}

function rejectChallenge(text) {
  const normalized = normalizeText(text)
  const signals = ['captcha', 'accessdenied', 'cloudflareattentionrequired', '请输入验证码', '安全验证']
  return signals.find((signal) => normalized.includes(normalizeText(signal))) || null
}

async function extractEvidenceText(source, bytes, contentType, localPath) {
  if (!isPdf(source, contentType, bytes)) return bytes.toString('utf8')
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('invalid_pdf_magic')
  const textPath = `${localPath}.txt`
  await execFileAsync(PDFTOTEXT, ['-layout', localPath, textPath], { timeout: 60_000, windowsHide: true })
  const text = await fsp.readFile(textPath, 'utf8')
  await fsp.rm(textPath, { force: true })
  if (!text.trim()) throw new Error('pdf_text_unavailable')
  return text
}

function verifyExpectations(sourceId, evidenceText) {
  const challenge = rejectChallenge(evidenceText)
  if (challenge) throw new Error(`challenge_page:${challenge}`)
  const haystack = normalizeText(evidenceText)
  const groups = SOURCE_EXPECTATIONS[sourceId]
  const missing = []
  for (let index = 0; index < groups.length; index += 1) {
    if (!groups[index].some((anchor) => haystack.includes(normalizeText(anchor)))) missing.push(index + 1)
  }
  if (missing.length) throw new Error(`evidence_mismatch:groups_${missing.join('_')}`)
  return { matchedGroups: groups.length }
}

class HostGate {
  constructor(intervalMs = MINIMUM_HOST_INTERVAL_MS) {
    this.intervalMs = intervalMs
    this.tails = new Map()
    this.lastStartedAt = new Map()
    this.starts = []
  }

  run(host, operation) {
    const previous = this.tails.get(host) || Promise.resolve()
    const current = previous.catch(() => undefined).then(async () => {
      const elapsed = Date.now() - (this.lastStartedAt.get(host) || 0)
      if (elapsed < this.intervalMs) await new Promise((resolve) => setTimeout(resolve, this.intervalMs - elapsed))
      this.lastStartedAt.set(host, Date.now())
      this.starts.push({ host, startedAt: new Date().toISOString() })
      return operation()
    })
    this.tails.set(host, current)
    return current
  }
}

const robotsCache = new Map()

function robotsAllows(robotsText, pathname) {
  let applies = false
  const rules = []
  for (const rawLine of String(robotsText).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (key === 'user-agent') {
      applies = value === '*'
      continue
    }
    if (applies && (key === 'allow' || key === 'disallow') && value) {
      rules.push({ allow: key === 'allow', path: value })
    }
  }
  const matching = rules.filter((rule) => pathname.startsWith(rule.path)).sort((a, b) => b.path.length - a.path.length)
  return matching.length === 0 || matching[0].allow
}

async function assertRobotsAllowed(url, gate) {
  const origin = url.origin
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, gate.run(url.hostname, async () => {
      const response = await fetch(`${origin}/robots.txt`, {
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        headers: { 'User-Agent': USER_AGENT },
      })
      if (response.status === 404 || response.status === 410) return ''
      if (response.status !== 200) throw new Error(`robots_http_${response.status}`)
      return response.text()
    }))
  }
  const robotsText = await robotsCache.get(origin)
  if (!robotsAllows(robotsText, url.pathname)) throw new Error('robots_disallowed')
}

async function fetchOfficial(source, gate) {
  let current = assertOfficialUrl(source.officialUrl)
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertRobotsAllowed(current, gate)
    const response = await gate.run(current.hostname, async () => fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(35_000),
      headers: { Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.1', 'User-Agent': USER_AGENT },
    }))
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new Error('redirect_without_location')
      current = assertOfficialUrl(new URL(location, current).href)
      continue
    }
    if (response.status !== 200) throw new Error(`http_${response.status}`)
    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (declaredLength > MAX_BYTES) throw new Error('source_too_large')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('invalid_source_size')
    return {
      bytes,
      finalUrl: current.href,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
    }
  }
  throw new Error('too_many_redirects')
}

function extensionFor(source, contentType, bytes) {
  if (isPdf(source, contentType, bytes)) return 'pdf'
  return 'html'
}

function r2KeyFor(sourceId, artifactSha, extension) {
  return `source-artifacts/${sha256(sourceId).slice(0, 24)}/${artifactSha}.${extension}`
}

async function runWrangler(args) {
  try {
    return await execFileAsync(process.execPath, [WRANGLER, ...args], {
      cwd: ROOT,
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`
    error.sanitizedOutput = output
    throw error
  }
}

async function getR2Object(object, targetPath) {
  await fsp.rm(targetPath, { force: true })
  return runWrangler(['r2', 'object', 'get', object, '--file', targetPath, '--config', WRANGLER_CONFIG, '--remote'])
}

function isMissingR2Object(error) {
  return /specified key does not exist|object not found|NoSuchKey/i.test(error.sanitizedOutput || '')
}

async function persistAndReadBack(sourceId, artifact, localPath) {
  const extension = extensionFor(artifact.source, artifact.contentType, artifact.bytes)
  const artifactSha256 = sha256(artifact.bytes)
  const r2Key = r2KeyFor(sourceId, artifactSha256, extension)
  const object = `${BUCKET}/${r2Key}`
  const readbackPath = path.join(TEMP_DIR, `readback-${artifactSha256}.${extension}`)
  let uploaded = false
  try {
    await getR2Object(object, readbackPath)
  } catch (error) {
    if (!isMissingR2Object(error)) throw new Error('r2_get_failed')
    await runWrangler([
      'r2', 'object', 'put', object,
      '--file', localPath,
      '--content-type', artifact.contentType,
      '--config', WRANGLER_CONFIG,
      '--remote',
    ])
    uploaded = true
    let lastError
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      try {
        if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, attempt * 2_000)))
        await getR2Object(object, readbackPath)
        lastError = null
        break
      } catch (error) {
        lastError = error
      }
    }
    if (lastError) throw new Error('r2_readback_unavailable')
  }
  const readback = await fsp.readFile(readbackPath)
  if (readback.length !== artifact.bytes.length || sha256(readback) !== artifactSha256) {
    throw new Error('r2_readback_hash_or_size_mismatch')
  }
  await fsp.rm(readbackPath, { force: true })
  return { uploaded, artifactSha256, byteLength: artifact.bytes.length, r2Key, r2Uri: `r2://${BUCKET}/${r2Key}` }
}

function safeFailure(error) {
  const message = String(error && error.message ? error.message : error)
  const allowed = [
    /^http_\d{3}$/,
    /^evidence_mismatch:groups_[\d_]+$/,
    /^challenge_page:/,
    /^(fetch failed|The operation was aborted due to timeout|unsafe_official_url|host_not_allowlisted|redirect_without_location|too_many_redirects|source_too_large|invalid_source_size|invalid_pdf_magic|pdf_text_unavailable|robots_disallowed|robots_http_\d{3}|r2_get_failed|r2_readback_unavailable|r2_readback_hash_or_size_mismatch)$/,
  ]
  return allowed.some((pattern) => pattern.test(message)) ? message : 'capture_or_archive_failed'
}

async function captureSource(source, gate) {
  const url = assertOfficialUrl(source.officialUrl)
  const extensionHint = url.pathname.toLowerCase().endsWith('.pdf') ? 'pdf' : 'html'
  const localPath = path.join(TEMP_DIR, `${source.sourceId}.${extensionHint}`)
  try {
    const fetched = await fetchOfficial(source, gate)
    await fsp.writeFile(localPath, fetched.bytes)
    const evidenceText = await extractEvidenceText(source, fetched.bytes, fetched.contentType, localPath)
    const verification = verifyExpectations(source.sourceId, evidenceText)
    const archived = await persistAndReadBack(source.sourceId, { ...fetched, source }, localPath)
    return {
      sourceId: source.sourceId,
      status: 'confirmed',
      officialUrl: source.officialUrl,
      finalOfficialUrl: fetched.finalUrl,
      checkedAt: CHECKED_AT,
      contentType: fetched.contentType,
      matchedExpectationGroups: verification.matchedGroups,
      artifactSha256: archived.artifactSha256,
      byteLength: archived.byteLength,
      r2Key: archived.r2Key,
      r2Uri: archived.r2Uri,
      r2Action: archived.uploaded ? 'uploaded_and_readback_verified' : 'existing_object_readback_verified',
      fullReadbackVerified: true,
    }
  } catch (error) {
    return {
      sourceId: source.sourceId,
      status: 'quarantine',
      officialUrl: source.officialUrl,
      checkedAt: CHECKED_AT,
      reason: safeFailure(error),
      fullReadbackVerified: false,
    }
  } finally {
    await fsp.rm(localPath, { force: true }).catch(() => undefined)
  }
}

function buildReceipt(closure, sourceResults, requestStarts = []) {
  const sourceStatus = new Map(sourceResults.map((source) => [source.sourceId, source]))
  const packages = closure.packages.map((item) => {
    const blockingSourceIds = item.sourceIds.filter((sourceId) => sourceStatus.get(sourceId)?.status !== 'confirmed')
    return {
      programId: item.programId,
      decision: item.decision,
      disposition: item.disposition,
      sourceIds: item.sourceIds,
      status: blockingSourceIds.length ? 'blocked' : 'ready_for_staged_import',
      blockingSourceIds,
    }
  })
  return {
    schemaVersion: 'studyinchina.wave4-priority-r2-receipt.v1',
    checkedAt: CHECKED_AT,
    bucket: BUCKET,
    sanitized: true,
    policy: closure.policy,
    requestAudit: {
      starts: requestStarts,
      adjacentHostIntervalsCompliant: requestStarts.every((entry, index) => {
        const previous = requestStarts.slice(0, index).reverse().find((candidate) => candidate.host === entry.host)
        return !previous || Date.parse(entry.startedAt) - Date.parse(previous.startedAt) >= MINIMUM_HOST_INTERVAL_MS
      }),
    },
    summary: {
      sources: sourceResults.length,
      confirmedSources: sourceResults.filter((source) => source.status === 'confirmed').length,
      quarantinedSources: sourceResults.filter((source) => source.status !== 'confirmed').length,
      packages: packages.length,
      readyPackages: packages.filter((item) => item.status === 'ready_for_staged_import').length,
      blockedPackages: packages.filter((item) => item.status === 'blocked').length,
      historicalStaleReferencePackages: packages.filter((item) => item.disposition === 'historical_stale_reference').length,
    },
    sources: [...sourceResults].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    packages,
  }
}

async function writeJson(targetPath, value) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true })
  await fsp.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function main() {
  const ledger = JSON.parse(await fsp.readFile(LEDGER_PATH, 'utf8'))
  const closure = buildClosure(ledger)
  await writeJson(CLOSURE_PATH, closure)
  if (process.argv.includes('--closure-only')) {
    console.log(JSON.stringify(closure.summary))
    return
  }
  await fsp.rm(TEMP_DIR, { recursive: true, force: true })
  await fsp.mkdir(TEMP_DIR, { recursive: true })
  const gate = new HostGate()
  const sourceResults = await Promise.all(closure.sources.map((source) => captureSource(source, gate)))
  const receipt = buildReceipt(closure, sourceResults, gate.starts)
  await writeJson(RECEIPT_PATH, receipt)
  console.log(JSON.stringify(receipt.summary))
  if (receipt.summary.quarantinedSources) process.exitCode = 2
}

module.exports = {
  CHECKED_AT,
  MINIMUM_HOST_INTERVAL_MS,
  OFFICIAL_HOST_ALLOWLIST,
  SAFE_DECISIONS,
  SOURCE_EXPECTATIONS,
  HostGate,
  assertOfficialUrl,
  buildClosure,
  buildReceipt,
  normalizeText,
  robotsAllows,
  r2KeyFor,
  selectEvidenceRefs,
  sha256,
  verifyExpectations,
}

if (require.main === module) {
  main().catch((error) => {
    console.error(safeFailure(error))
    process.exitCode = 1
  })
}
