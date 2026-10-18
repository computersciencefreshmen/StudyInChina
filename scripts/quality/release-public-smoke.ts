import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, request, type APIRequestContext, type Page } from 'playwright'
import { parse } from 'parse5'
import { publicLocales } from '../../src/i18n/config'
import { LATEST_RELEASE_ANNOUNCEMENT_ID, RELEASE_ANNOUNCEMENT_STORAGE_KEY } from '../../src/i18n/release-announcement'
import { officialReferenceTuitionCopy } from '../../src/i18n/tuition-reference'
import { getMessages } from '../../src/i18n/messages'
import { getApplicationState, selectAdmissionCycle } from '../../src/lib/data/admission'
import { formatProgramDuration } from '../../src/lib/data/duration'
import { formatCny, localize, localizeProgramText } from '../../src/lib/data/format'
import { getTodayDate } from '../../src/lib/data/freshness'
import { languageLabel } from '../../src/lib/data/labels'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle, Program } from '../../src/lib/data/types'
import type { ApiEnvelope, AdmissionCycleRecord, InstitutionRecord, ProgramRecord, ReleaseInfo } from '../../src/lib/catalog-api/types'
import type { FullProgramBatch } from './approve-full-program-batch'

type Pin = { path: string; sha256: string; bytes?: number }
export type SmokeInput = {
  schemaVersion: 1; today: string; dataDirectory: string; sourcePlan: string; batches: string[]
  expectedPrograms: number; expectedUniversities: number; expectedChangedPrograms: number; expectedChangedUniversities: number
  staleSlugs: string[]
}
type Options = { root: string; base: string; input: string; output: string; prefix: 'candidate' | 'stable'; proxy?: string; channel?: string; bypassEnvironment: string }
type Check = { route: string; pass: boolean; [key: string]: unknown }
type HtmlNode = { tagName?: string; nodeName?: string; value?: string; attrs?: { name: string; value: string }[]; childNodes?: HtmlNode[] }
const filenames = { sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships' } as const
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
const invariant: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw Error(message) }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
function workspacePath(root: string, name: string): string {
  const result = resolve(root, name), rel = relative(root, result)
  invariant(rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'input_path_outside_workspace')
  return result
}
export function redactSmokeError(value: unknown, secret = ''): string {
  // Playwright appends full request headers/cookies to its multi-line call log.
  // Keep only the first diagnostic line; never persist that request transcript.
  let result = (value instanceof Error ? value.message : String(value)).split(/\r?\n/u)[0].trim()
  if (/\b(?:cookie|set-cookie|authorization|proxy-authorization|x-vercel-protection-bypass)\b["']?\s*[:=]/iu.test(result)) return '[sensitive request diagnostics removed]'
  for (const token of secret ? [secret, encodeURIComponent(secret)] : []) result = result.split(token).join('[REDACTED]')
  return result.slice(0, 1500)
}
function attr(node: HtmlNode, name: string) { return node.attrs?.find(item => item.name === name)?.value }
function nodes(node: HtmlNode): HtmlNode[] { return [node, ...(node.childNodes ?? []).flatMap(nodes)] }
function text(node: HtmlNode): string {
  if (['script', 'style', 'template', 'noscript'].includes(node.tagName ?? '')) return ''
  return node.value ?? (node.childNodes ?? []).map(text).join(' ')
}
function hasClass(node: HtmlNode, name: string) { return (attr(node, 'class') ?? '').split(/\s/u).includes(name) }
function counts(bundle: DataBundle) { return Object.fromEntries(Object.entries(bundle).map(([key, items]) => [key, items.length])) }
async function concurrent<T, R>(items: T[], limit: number, operation: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(items.length); let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await operation(items[index], index) }
  }))
  return result
}

/** All expected records and hashes are fixed before the first network request. */
export function loadSmokeExpectation(root: string, inputFile: string) {
  const inputPath = workspacePath(root, inputFile), inputBytes = readFileSync(inputPath)
  const input = JSON.parse(inputBytes.toString('utf8')) as SmokeInput
  invariant(input.schemaVersion === 1 && /^\d{4}-\d{2}-\d{2}$/u.test(input.today), 'smoke_input_contract_invalid')
  invariant(input.today === getTodayDate(), 'smoke_input_date_is_not_current_china_calendar')
  invariant(Array.isArray(input.batches) && input.batches.length > 0 && Array.isArray(input.staleSlugs) && input.staleSlugs.length > 0, 'smoke_input_batches_and_stale_sentinels_required')
  for (const count of [input.expectedPrograms, input.expectedUniversities, input.expectedChangedPrograms, input.expectedChangedUniversities]) invariant(Number.isSafeInteger(count) && count > 0, 'explicit_positive_expected_counts_required')
  const sourcePlanPath = workspacePath(root, input.sourcePlan), sourcePlanBytes = readFileSync(sourcePlanPath)
  const sourcePlan = JSON.parse(sourcePlanBytes.toString('utf8')) as { pins: Pin[] }
  invariant(Array.isArray(sourcePlan.pins) && sourcePlan.pins.length > 0, 'source_plan_pins_required')
  const pins = new Map(sourcePlan.pins.map(pin => [pin.path.replaceAll('\\', '/'), pin]))
  invariant(pins.size === sourcePlan.pins.length && sourcePlan.pins.every(pin => /^[a-f0-9]{64}$/u.test(pin.sha256)), 'source_plan_duplicate_or_invalid_pins')
  const dataDirectory = workspacePath(root, input.dataDirectory), files: Pin[] = []
  const raw = Object.fromEntries(Object.entries(filenames).map(([key, filename]) => {
    const path = resolve(dataDirectory, `${filename}.json`), bytes = readFileSync(path), digest = sha(bytes)
    const pin = pins.get(`content/data/${filename}.json`)
    invariant(pin?.sha256 === digest && (pin.bytes === undefined || pin.bytes === bytes.length), `expected_data_not_bound_to_source_plan:${filename}`)
    files.push({ path: relative(root, path).replaceAll('\\', '/'), sha256: digest, bytes: bytes.length })
    return [key, JSON.parse(bytes.toString('utf8'))]
  }))
  const catalog = bundleSchema.parse(raw), published = selectPublishedData(catalog, input.today)
  invariant(published.programs.length === input.expectedPrograms && published.universities.length === input.expectedUniversities, 'expected_public_counts_do_not_match_frozen_catalog')
  const changed = new Map<string, Program>(), batches = input.batches.map(name => {
    const path = workspacePath(root, name), bytes = readFileSync(path), batch = JSON.parse(bytes.toString('utf8')) as FullProgramBatch
    invariant(batch.schemaVersion === 1 && batch.entries?.length > 0, 'approved_batch_contract_invalid')
    for (const entry of batch.entries) {
      invariant(entry.reviewer === 'codex' && Number.isFinite(Date.parse(entry.reviewedAt)), `batch_not_independently_approved:${batch.batchId}`)
      invariant(!changed.has(entry.program.id), `duplicate_changed_program:${entry.program.id}`)
      const p = published.programs.find(p => p.id === entry.program.id), cycle = published.admissionCycles.find(c => c.id === entry.cycle.id)
      invariant(p && stable(p) === stable(entry.program), `approved_program_differs_from_frozen_catalog:${entry.program.id}`)
      invariant(cycle && stable(cycle) === stable(entry.cycle), `approved_cycle_differs_from_frozen_catalog:${entry.cycle.id}`)
      changed.set(p.id, p)
    }
    return { path: relative(root, path).replaceAll('\\', '/'), sha256: sha(bytes), bytes: bytes.length, batchId: batch.batchId }
  })
  invariant(changed.size === input.expectedChangedPrograms && new Set([...changed.values()].map(p => p.universityId)).size === input.expectedChangedUniversities, 'expected_changed_scope_mismatch')
  for (const slug of input.staleSlugs) invariant(/^[a-z0-9-]+$/u.test(slug) && !published.programs.some(p => p.slug === slug), `stale_sentinel_is_public_or_invalid:${slug}`)
  const supportPaths = ['src/lib/data/schema.ts', 'src/lib/data/publication.ts', 'src/lib/data/format.ts', 'src/lib/data/duration.ts', 'src/lib/data/admission.ts', 'src/lib/data/labels.ts', 'src/i18n/config.ts', 'src/i18n/messages.ts', 'src/i18n/tuition-reference.ts', 'src/i18n/release-announcement.ts', 'content/data/program-localizations.json']
  const supportPins = supportPaths.map(path => {
    const bytes = readFileSync(workspacePath(root, path)), digest = sha(bytes)
    invariant(pins.get(path)?.sha256 === digest, `expectation_support_code_differs_from_frozen_plan:${path}`)
    return { path, sha256: digest, bytes: bytes.length }
  })
  const expectedInputManifest = { inputFile: relative(root, inputPath).replaceAll('\\', '/'), inputSha256: sha(inputBytes), sourcePlanSha256: sha(sourcePlanBytes), files, batches, supportPins, normalizedCatalogSha256: sha(stable(catalog)) }
  return { input, catalog, published, changed: [...changed.values()], expectedInputManifest, expectedInputSha256: sha(stable(expectedInputManifest)), sourcePlanSha256: sha(sourcePlanBytes) }
}

async function getJson<T>(client: APIRequestContext, base: string, route: string): Promise<T> {
  const response = await client.get(base + route, { maxRedirects: 0, maxRetries: 1, timeout: 45000 })
  invariant(response.status() === 200, `http_${response.status()}:${route}`)
  return await response.json() as T
}
async function allRecords<T>(client: APIRequestContext, base: string, route: string): Promise<T[]> {
  const records: T[] = [], seen = new Set<string>(); let cursor: string | null = null
  do {
    const params = new URLSearchParams({ limit: '100' }); if (cursor) params.set('cursor', cursor)
    const page = await getJson<ApiEnvelope<T[]>>(client, base, `${route}?${params}`)
    invariant(Array.isArray(page.data), 'api_list_data_is_not_array')
    records.push(...page.data); cursor = page.meta.nextCursor ?? null
    if (cursor) { invariant(!seen.has(cursor) && seen.size < 200, 'api_cursor_cycle_or_unbounded_pagination'); seen.add(cursor) }
  } while (cursor)
  return records
}
function assertIds(actual: { id: string }[], expected: { id: string }[], name: string) {
  invariant(actual.length === expected.length && new Set(actual.map(p => p.id)).size === actual.length && stable(actual.map(p => p.id).sort()) === stable(expected.map(p => p.id).sort()), `exact_id_set_mismatch:${name}`)
}
async function loadedPage(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  invariant(response?.status() === 200, `browser_http_${response?.status() ?? 'none'}:${new URL(url).pathname}`)
  await page.locator('main#main-content').waitFor({ state: 'visible' })
  await page.locator('main#main-content h1').waitFor({ state: 'visible' })
}

export async function runReleasePublicSmoke(options: Options) {
  const baseUrl = new URL(options.base)
  invariant(!baseUrl.username && !baseUrl.password && !baseUrl.search && !baseUrl.hash && baseUrl.pathname === '/', 'base_url_must_be_plain_origin')
  invariant(baseUrl.protocol === 'https:' && (baseUrl.hostname === 'studyinchina.vercel.app' || /^studyinchina-[a-z0-9-]+\.vercel\.app$/u.test(baseUrl.hostname)) || baseUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(baseUrl.hostname), 'base_url_not_an_approved_site_origin')
  const base = baseUrl.origin, expected = loadSmokeExpectation(options.root, options.input)
  const output = workspacePath(options.root, options.output)
  invariant(!existsSync(output), 'smoke_output_must_be_new_and_immutable')
  mkdirSync(dirname(output), { recursive: true }); mkdirSync(output)
  const secret = process.env[options.bypassEnvironment] ?? '', clean = (value: unknown) => redactSmokeError(value, secret)
  const proof: Record<string, unknown> = { pass: false, checkedAt: new Date().toISOString(), base, prefix: options.prefix, today: expected.input.today, sourcePlanSha256: expected.sourcePlanSha256, smokeRunnerSha256: sha(readFileSync(fileURLToPath(import.meta.url))), expectedInputSha256: expected.expectedInputSha256, publicCounts: counts(expected.published), expectedInputManifest: expected.expectedInputManifest }
  const checks: Check[] = [], universities: Check[] = [], details: Check[] = [], errors: string[] = [], consoleErrors: string[] = []
  const cleanup: Record<string, unknown>[] = [], pendingRoutes = new Map<Page | undefined, Set<Promise<void>>>(), closingPages = new Set<Page>()
  let closingContext = false
  proof.checks = checks; proof.universities = universities; proof.details = details; proof.errors = errors; proof.consoleErrors = consoleErrors
  proof.cleanup = cleanup
  const record = async (route: string, operation: () => Promise<Record<string, unknown> | void>, sink = checks) => {
    try { const result = await operation(); sink.push({ route, pass: true, ...result }) }
    catch (error) { sink.push({ route, pass: false, error: clean(error) }); errors.push(`${route}: ${clean(error)}`) }
  }
  const headers: Record<string, string> = secret ? { 'x-vercel-protection-bypass': secret } : {}
  const proxy = options.proxy ? { server: options.proxy } : undefined
  const client = await request.newContext({ extraHTTPHeaders: headers, proxy })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    await record('/api/v1/releases/current', async () => {
      const value = await getJson<ApiEnvelope<ReleaseInfo>>(client, base, '/api/v1/releases/current')
      invariant(stable(value.data.publicCounts) === stable(counts(expected.published)), 'release_public_counts_mismatch')
      invariant(value.data.evaluatedForDate === expected.input.today, 'release_evaluated_for_wrong_day')
      return { publicCounts: value.data.publicCounts, evaluatedForDate: value.data.evaluatedForDate }
    })
    await record('/api/v1/programs', async () => {
      const records = await allRecords<ProgramRecord>(client, base, '/api/v1/programs')
      assertIds(records, expected.published.programs, 'programs')
      for (const p of expected.published.programs) {
        const actual = records.find(record => record.id === p.id)!
        for (const key of ['durationMonths', 'durationMonthsMax', 'durationText'] as const) invariant(stable(actual[key] ?? null) === stable(p[key] ?? null), `duration_roundtrip_failed:${p.id}:${key}`)
      }
      return { records: records.length, exactIds: true, exactDurationRoundtrip: true }
    })
    await record('/api/v1/institutions', async () => {
      const records = await allRecords<InstitutionRecord>(client, base, '/api/v1/institutions')
      assertIds(records, expected.published.universities, 'universities')
      for (const u of records) invariant(u.programCount === expected.published.programs.filter(p => p.universityId === u.id).length, `institution_program_count_mismatch:${u.id}`)
      return { records: records.length, exactIds: true }
    })
    await concurrent(expected.published.universities, 6, async university => {
      const route = `/en/universities/${university.slug}`
      await record(route, async () => {
        const response = await client.get(base + route, { maxRedirects: 0, maxRetries: 1, timeout: 45000 })
        invariant(response.status() === 200, `university_http_${response.status()}`)
        const document = nodes(parse(await response.text()) as HtmlNode), programs = expected.published.programs.filter(p => p.universityId === university.id)
        const statStrip = document.find(node => hasClass(node, 'stat-strip'))
        const firstCount = statStrip && nodes(statStrip).find(node => node.tagName === 'strong')
        invariant(firstCount && Number(normalize(text(firstCount))) === programs.length, 'visible_university_program_count_mismatch')
        const pending = document.some(node => attr(node, 'data-testid') === 'university-programs-pending')
        invariant(pending === (programs.length === 0), 'university_empty_state_mismatch')
        const links = new Set(document.filter(node => node.tagName === 'a').map(node => attr(node, 'href')).filter((href): href is string => Boolean(href?.startsWith('/en/programs/'))))
        invariant(links.size === Math.min(8, programs.length) && [...links].every(href => programs.some(p => href === `/en/programs/${p.slug}`)), 'visible_university_program_links_mismatch')
        return { id: university.id, currentPrograms: programs.length, pending, listedPrograms: links.size }
      }, universities)
      if (universities.length % 25 === 0) process.stdout.write(JSON.stringify({ stage: 'university-pages', checked: universities.length, total: expected.published.universities.length }) + '\n')
    })
    checks.push({ route: 'university-pages', pass: universities.every(check => check.pass), records: universities.length, pending: universities.filter(check => check.pending).length })
    for (const slug of expected.input.staleSlugs) for (const route of [`/en/programs/${slug}`, `/api/v1/programs/${slug}`]) await record(route, async () => {
      const response = await client.get(base + route, { maxRedirects: 0, maxRetries: 1, timeout: 45000 }); invariant(response.status() === 404, 'stale_detail_must_be_404'); return { status: 404 }
    })
    for (const p of expected.changed) await record(`/api/v1/programs/${p.slug}/cycles`, async () => {
      const program = await getJson<ApiEnvelope<ProgramRecord>>(client, base, `/api/v1/programs/${p.slug}`)
      invariant(program.data.id === p.id && stable(program.data.teachingLanguages) === stable(p.teachingLanguages), 'changed_program_api_identity_or_medium_mismatch')
      invariant(stable(program.data.languageRequirements) === stable(p.languageRequirements), 'changed_program_api_language_requirements_mismatch')
      const cycles = await getJson<ApiEnvelope<AdmissionCycleRecord[]>>(client, base, `/api/v1/programs/${p.slug}/cycles`)
      const expectedCycles = expected.published.admissionCycles.filter(c => c.programId === p.id)
      assertIds(cycles.data, expectedCycles, `cycles:${p.id}`)
      for (const c of expectedCycles) for (const key of ['opensOn', 'closesOn', 'tuitionCny', 'tuitionPeriod', 'tuitionStatus', 'tuitionSchedule', 'applicationFeeCny', 'notes'] as const) invariant(stable(cycles.data.find(item => item.id === c.id)?.[key] ?? null) === stable(c[key] ?? null), `changed_cycle_roundtrip_failed:${p.id}:${key}`)
      return { programId: p.id, cycles: cycles.data.length, reviewedFactsRoundtrip: true }
    })
    browser = await chromium.launch({ headless: true, channel: options.channel || (existsSync(chromium.executablePath()) ? undefined : 'chrome'), proxy })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    // Never attach a protection credential to third-party requests or URLs.
    if (secret) await context.route('**/*', route => {
      let owner: Page | undefined
      try { owner = route.request().frame().page() } catch { /* Service-worker requests have no page frame. */ }
      const task = (async () => { try {
        const outgoing = { ...route.request().headers() }
        delete outgoing['x-vercel-protection-bypass']
        if (new URL(route.request().url()).origin !== base) { await route.continue({ headers: outgoing }); return }
        outgoing['x-vercel-protection-bypass'] = secret
        // The credential is used only in this bounded fetch; it never becomes a
        // browser redirect header that could be inherited by another origin.
        // Playwright maxRetries retries ECONNRESET only, never HTTP/auth failures.
        const response = await route.fetch({ headers: outgoing, maxRedirects: 0, maxRetries: 1, timeout: 45000 })
        const location = response.headers().location
        if (location && response.status() >= 300 && response.status() < 400 && new URL(location, base).origin !== base) {
          consoleErrors.push('protected_request_cross_origin_redirect_rejected')
          await route.abort('blockedbyclient'); return
        }
        await route.fulfill({ response })
      } catch (error) {
        // Event callback rejections bypass the main awaited checks; contain and
        // redact them here so the immutable failure proof is still produced.
        const message = clean(error)
        const intentionalCancellation = (closingContext || Boolean(owner && closingPages.has(owner)))
          && /Request context disposed|Target (?:page, context or browser|page|context|browser) has been closed|Target closed/iu.test(message)
        if (intentionalCancellation) cleanup.push({ kind: 'intentional_teardown_cancellation', path: new URL(route.request().url()).pathname, message })
        else errors.push(`protected_browser_request: ${message}`)
        await route.abort('failed').catch(() => undefined)
      } })()
      const group = pendingRoutes.get(owner) ?? new Set<Promise<void>>()
      pendingRoutes.set(owner, group); group.add(task)
      return task.finally(() => group.delete(task))
    })
    context.on('page', page => {
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(clean(message.text())) })
      page.on('pageerror', error => consoleErrors.push(clean(error)))
    })
    await context.addInitScript(({ origin, key, value }) => {
      // about:blank and sandboxed/foreign documents do not have the site's
      // storage capability. A failure on the real site remains a page error.
      if (location.origin !== origin || self.origin !== origin) return
      localStorage.setItem(key, value)
    }, { origin: base, key: RELEASE_ANNOUNCEMENT_STORAGE_KEY, value: LATEST_RELEASE_ANNOUNCEMENT_ID })
    const closePageSafely = async (page: Page) => {
      // The load event is finite and concerns document resources, unlike a
      // networkidle wait. Actual failures before teardown remain failures.
      await page.waitForLoadState('load', { timeout: 15000 }).catch(error => errors.push(`document_load_before_teardown: ${clean(error)}`))
      await page.evaluate(async () => {
        if (document.fonts) await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2000))])
      }).catch(error => errors.push(`font_readiness_before_teardown: ${clean(error)}`))
      const deadline = Date.now() + 10000
      while ((pendingRoutes.get(page)?.size ?? 0) > 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
      const remaining = pendingRoutes.get(page)?.size ?? 0
      if (remaining) cleanup.push({ kind: 'bounded_page_drain_reached', pendingRequests: remaining })
      closingPages.add(page)
      await page.close()
      const settling = [...pendingRoutes.get(page) ?? []]
      if (settling.length) await Promise.race([Promise.allSettled(settling), new Promise(resolve => setTimeout(resolve, 5000))])
    }
    await concurrent(expected.changed, 3, async p => {
      const page = await context.newPage()
      try {
        for (const locale of publicLocales) {
          const route = `/${locale}/programs/${p.slug}`
          await record(route, async () => {
            await loadedPage(page, base + route)
            await page.locator('[data-program-detail]').waitFor({ state: 'visible' })
            invariant(await page.locator('html').getAttribute('lang') === locale, 'localized_shell_language_mismatch')
            const content = normalize(await page.locator('main#main-content').innerText()), details = p.details ?? p.supplementaryDetails
            invariant(details, 'changed_program_has_no_reviewed_details')
            const cycle = selectAdmissionCycle(expected.published.admissionCycles, p.id, expected.input.today)
            invariant(cycle, 'changed_program_has_no_public_cycle')
            const requireText = (value: string, field: string) => invariant(content.includes(normalize(value)), `reviewed_text_not_visible:${p.id}:${locale}:${field}`)
            requireText(localize(p.name, locale), 'name')
            for (const key of ['overview', 'faculty', 'qualification', 'languagePolicy', 'campus'] as const) if (details[key]) requireText(localize(details[key], locale), key)
            for (const key of ['curriculumHighlights', 'eligibility', 'applicationMaterials'] as const) for (const [index, value] of (details[key] ?? []).entries()) requireText(localize(value, locale), `${key}[${index}]`)
            if (cycle.notes) requireText(localize(cycle.notes, locale), 'cycle.notes')
            if (cycle.tuitionSchedule) requireText(localize(cycle.tuitionSchedule, locale), 'tuitionSchedule')
            const duration = formatProgramDuration(p, locale, getMessages(locale).common.months)
            invariant(duration, 'changed_program_duration_missing'); requireText(duration, 'duration')
            for (const medium of p.teachingLanguages) requireText(languageLabel(medium, locale), 'teachingLanguages')
            for (const requirement of p.languageRequirements.filter(item => item.test !== 'other')) if (requirement.minimum) requireText(localizeProgramText(requirement.minimum, locale), 'languageRequirements')
            if (cycle.applicationFeeCny !== null) requireText(formatCny(cycle.applicationFeeCny, locale, ''), 'applicationFeeCny')
            if (cycle.tuitionCny !== null && !cycle.tuitionSchedule) requireText(formatCny(cycle.tuitionCny, locale, ''), 'tuitionCny')
            if (cycle.tuitionStatus === 'reference') { invariant(await page.locator('[data-fact-status="reference"]').count() > 0, 'reference_tuition_marker_missing'); requireText(officialReferenceTuitionCopy(locale).label, 'referenceLabel') }
            const state = getApplicationState(cycle, expected.input.today), accepting = state === 'open' || state === 'rolling'
            const primary = await page.locator('.atlas-hero__actions a').first().getAttribute('href')
            invariant(primary === (accepting ? p.applyUrl : p.programUrl), 'primary_official_cta_mismatch')
            if (cycle.opensOn === null && cycle.dateStatus === 'published') invariant(primary === p.programUrl, 'unknown_opening_must_link_official_source')
            invariant(!(await page.content()).includes('PnullM'), 'invalid_unknown_iso_duration')
            return { programId: p.id, locale, eligibility: details.eligibility?.length ?? 0, applicationMaterials: details.applicationMaterials?.length ?? 0, completeReviewedTextVisible: true, exactDuration: duration, teachingLanguages: p.teachingLanguages, tuitionStatus: cycle.tuitionStatus, primaryHref: primary, unknownOpeningSourceCta: cycle.opensOn === null && cycle.dateStatus === 'published' }
          }, details)
          process.stdout.write(JSON.stringify({ stage: 'program-details', checked: details.length, total: expected.changed.length * publicLocales.length, locale, programId: p.id, pass: details.at(-1)?.pass }) + '\n')
        }
      } finally { await closePageSafely(page) }
    })
    const navigation = expected.changed.map(p => ({ p, u: expected.published.universities.find(u => u.id === p.universityId)! })).map(({ p, u }) => ({ p, u, city: expected.published.cities.find(c => c.id === u.cityId)! })).find(value => value.city)
    invariant(navigation, 'navigation_fixture_missing')
    const page = await context.newPage()
    await record('city-university-project-navigation', async () => {
      const { p, u, city } = navigation
      await loadedPage(page, `${base}/en/cities/${city.slug}`)
      let link = page.locator(`a[href="/en/universities/${u.slug}"]`).first()
      if (await link.count() === 0) { await page.locator(`a[href="/en/universities?city=${encodeURIComponent(city.slug)}"]`).first().click(); await page.waitForURL(url => url.pathname === '/en/universities' && url.searchParams.get('city') === city.slug); link = page.locator(`a[href="/en/universities/${u.slug}"]`).first(); await link.waitFor({ state: 'visible' }) }
      await link.click(); await page.waitForURL(`${base}/en/universities/${u.slug}`)
      await page.locator('main#main-content .stat-strip').waitFor({ state: 'visible' })
      const programLink = page.locator(`a[href="/en/programs/${p.slug}"]`).first()
      await programLink.waitFor({ state: 'visible' }); await programLink.click(); await page.waitForURL(`${base}/en/programs/${p.slug}`)
      await page.locator('[data-program-detail]').waitFor({ state: 'visible' })
      invariant(normalize(await page.locator('h1').innerText()) === normalize(localize(p.name, 'en')), 'navigation_ended_on_wrong_program')
      return { cityId: city.id, universityId: u.id, programId: p.id, actualBrowserClicks: true }
    })
    await record('mobile-project', async () => {
      await page.setViewportSize({ width: 390, height: 844 })
      const screenshotProgram = expected.changed.find(p => selectAdmissionCycle(expected.published.admissionCycles, p.id, expected.input.today)?.tuitionStatus === 'reference') ?? navigation.p
      const screenshot = resolve(output, `${options.prefix}-project-mobile.png`)
      const geometries = []
      for (const p of expected.changed) {
        await loadedPage(page, `${base}/en/programs/${p.slug}`)
        const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
        invariant(geometry.document <= geometry.viewport + 1 && geometry.body <= geometry.viewport + 1, `mobile_horizontal_overflow:${p.id}`)
        geometries.push({ programId: p.id, ...geometry })
        if (p.id === screenshotProgram.id) await page.screenshot({ path: screenshot, fullPage: true })
      }
      return { geometries, records: geometries.length, screenshot: relative(options.root, screenshot).replaceAll('\\', '/'), screenshotSha256: sha(readFileSync(screenshot)), programId: screenshotProgram.id }
    })
    await closePageSafely(page)
    closingContext = true
    await context.unrouteAll({ behavior: 'wait' })
    await context.close()
    invariant(getTodayDate() === expected.input.today, 'china_calendar_day_changed_during_smoke')
  } catch (error) { errors.push(clean(error)) }
  finally {
    closingContext = true
    await browser?.close().catch(error => errors.push(clean(error)))
    await client.dispose().catch(error => errors.push(clean(error)))
    proof.completedAt = new Date().toISOString()
    proof.pass = errors.length === 0 && consoleErrors.length === 0 && checks.every(check => check.pass) && universities.length === expected.input.expectedUniversities && details.length === expected.changed.length * publicLocales.length && details.every(check => check.pass)
    writeFileSync(resolve(output, `${options.prefix}-public-smoke.json`), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' })
  }
  return proof
}

function help() { return 'Usage: node --import tsx scripts/quality/release-public-smoke.ts --base <origin> --input <expectation.json> --output <new-directory> --prefix candidate|stable [--proxy http://127.0.0.1:7897] [--channel chrome] [--bypass-env STUDYINCHINA_PROTECTION_BYPASS]\n       node --import tsx scripts/quality/release-public-smoke.ts --validate-input <expectation.json>\nReads only; never deploys, promotes, applies data or logs protection credentials. Output directory must not exist.' }
export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) { process.stdout.write(help() + '\n'); return }
  if (args[0] === '--validate-input' && args.length === 2) { const expected = loadSmokeExpectation(process.cwd(), args[1]); process.stdout.write(JSON.stringify({ inputValidatedOnly: true, websiteSmokeRun: false, sourcePlanSha256: expected.sourcePlanSha256, expectedInputSha256: expected.expectedInputSha256, publicCounts: counts(expected.published), changedPrograms: expected.changed.length }) + '\n'); return }
  invariant(args.length % 2 === 0, help())
  const values = new Map<string, string>()
  for (let i = 0; i < args.length; i += 2) { invariant(['--base', '--input', '--output', '--prefix', '--proxy', '--channel', '--bypass-env'].includes(args[i]) && !values.has(args[i]), 'unknown_or_duplicate_cli_option'); values.set(args[i], args[i + 1]) }
  invariant(values.get('--base') && values.get('--input') && values.get('--output') && ['candidate', 'stable'].includes(values.get('--prefix') ?? ''), help())
  const bypassEnvironment = values.get('--bypass-env') || 'STUDYINCHINA_PROTECTION_BYPASS'
  invariant(/^[A-Z][A-Z0-9_]+$/u.test(bypassEnvironment), 'invalid_bypass_environment_name')
  const proof = await runReleasePublicSmoke({ root: process.cwd(), base: values.get('--base')!, input: values.get('--input')!, output: values.get('--output')!, prefix: values.get('--prefix') as Options['prefix'], proxy: values.get('--proxy'), channel: values.get('--channel'), bypassEnvironment })
  process.stdout.write(JSON.stringify({ pass: proof.pass, proof: `${values.get('--output')}/${values.get('--prefix')}-public-smoke.json`, sourcePlanSha256: proof.sourcePlanSha256, expectedInputSha256: proof.expectedInputSha256 }) + '\n')
  if (!proof.pass) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argumentIndex = process.argv.indexOf('--bypass-env')
  const environmentName = argumentIndex >= 0 ? process.argv[argumentIndex + 1] : 'STUDYINCHINA_PROTECTION_BYPASS'
  main().catch(error => { process.stderr.write(redactSmokeError(error, process.env[environmentName]) + '\n'); process.exitCode = 1 })
}
