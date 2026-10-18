import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DataBundle } from '@/lib/data/types'
import { buildUniversityMaintenancePlan, emptyUniversityMaintenanceState, recordUniversityMaintenanceAttempts, universityMaintenanceResultsSchema } from '@/lib/maintenance/university-coverage'
import { approvedCaptureUrl, captureUniversityMaintenanceSources, createPublicCaptureLookup, decodeMaintenanceHtml, extractMaintenanceLinkCandidates, isPublicCaptureAddress, parseUniversityCaptureArguments, validateCapturePlan } from '../../scripts/automation/capture-university-maintenance-sources'

const roots: string[] = [], TODAY = '2026-10-17'
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const audit = { sourceIds: ['official'], status: 'verified' as const, verifiedAt: '2026-10-15', reviewAfter: '2026-11-13' }
function fixture(): DataBundle { return {
  sources: [{ id: 'official', url: 'https://university.test/catalog', title: 'Official catalogue', publisher: 'University', kind: 'admissions', language: 'en', official: true, accessedAt: '2026-10-15' }],
  cities: [{ ...audit, id: 'city', slug: 'city', name: { en: 'City' }, province: null, region: 'south', coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
  universities: [{ ...audit, id: 'uni-test', slug: 'uni-test', name: { en: 'University' }, cityId: 'city', region: 'south', officialUrl: 'https://university.test/', admissionsUrl: 'https://university.test/admissions', summary: null, featured: false }],
  programs: [], admissionCycles: [], scholarships: [],
} }
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'university-capture-')); roots.push(root)
  const data = fixture(), directory = join(root, 'content/data'); await mkdir(directory, { recursive: true }); await mkdir(join(root, '.tmp'), { recursive: true })
  for (const [key, file] of Object.entries({ sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships' })) await writeFile(join(directory, `${file}.json`), JSON.stringify(data[key as keyof DataBundle]))
  const plan = buildUniversityMaintenancePlan(data, { today: TODAY, limit: 1 }), planFile = join(root, '.tmp/plan.json'); await writeFile(planFile, JSON.stringify(plan))
  const options = parseUniversityCaptureArguments(['--plan', '.tmp/plan.json', '--today', TODAY], root)
  let time = Date.parse('2026-10-17T00:00:00Z')
  const calls: { url: string; at: number; init?: RequestInit }[] = []
  const dependencies = { now: () => new Date(time), sleep: async (ms: number) => { time += ms }, resolveAddresses: async () => ['93.184.216.34'],
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => { const url = String(input); calls.push({ url, at: time, init }); return new Response(url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : '<a href="/programs/new">New programmes</a><a href="https://evil.test/programs">external</a>', { headers: { 'content-type': 'text/html' } }) }) as typeof fetch }
  return { root, data, plan, options, dependencies, calls }
}
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('bounded university source acquisition', () => {
  it('preserves raw evidence and discovers allowlisted links without changing catalogue facts', async () => {
    const run = await setup(), before = await readFile(join(run.options.dataDirectory, 'universities.json'), 'utf8')
    const result = await captureUniversityMaintenanceSources(run.options, run.dependencies)
    const report = result.report as { results: { processingStatus: string; sources: { rawFile: string; rawSha256: string; candidates: { url: string }[] }[] }[] }
    expect(run.calls).toHaveLength(3)
    expect(run.calls.every(call => call.init?.redirect === 'manual' && call.init.credentials === 'omit')).toBe(true)
    expect(run.calls.every(call => !new Headers(call.init?.headers).has('Authorization'))).toBe(true)
    expect(run.calls[1].at - run.calls[0].at).toBeGreaterThanOrEqual(5000)
    expect(run.calls[2].at - run.calls[1].at).toBeGreaterThanOrEqual(5000)
    expect(report.results[0].processingStatus).toBe('captured_pending_review')
    for (const source of report.results[0].sources) {
      expect(sha(await readFile(join(result.runDirectory, source.rawFile)))).toBe(source.rawSha256)
      expect(source.candidates.map(row => row.url)).toEqual(['https://university.test/programs/new'])
    }
    expect(await readFile(join(run.options.dataDirectory, 'universities.json'), 'utf8')).toBe(before)
    expect(result.receipt).toMatchObject({ results: [{ universityId: 'uni-test', outcome: 'captured' }] })
    expect(result.report).toMatchObject({ policy: { paidCalls: 0, canonicalWrites: 0, factsVerified: 0, publicationPerformed: false } })
  })
  it('holds robots disallow and never requests the blocked page', async () => {
    const run = await setup(); let requests = 0
    const result = await captureUniversityMaintenanceSources(run.options, { ...run.dependencies, fetch: (async () => { requests++; return new Response('User-agent: *\nDisallow: /') }) as typeof fetch })
    expect(requests).toBe(1)
    expect(result.receipt).toMatchObject({ results: [{ outcome: 'blocked', errorCode: 'robots_disallow' }] })
  })
  it('retains actual source HTTP 403 bytes and status without bypass', async () => {
    const run = await setup()
    const result = await captureUniversityMaintenanceSources(run.options, { ...run.dependencies, fetch: (async input => String(input).endsWith('/robots.txt') ? new Response('', { status: 404 }) : new Response('Access denied', { status: 403 })) as typeof fetch })
    expect(result.receipt).toMatchObject({ results: [{ outcome: 'blocked', errorCode: 'source_http_403' }] })
    expect(result.report).toMatchObject({ results: [{ sources: [{ httpStatus: 403, rawSha256: sha('Access denied'), completeBody: true }, { httpStatus: 403 }] }] })
  })
  it('rejects an off-allowlist redirect before contacting its target', async () => {
    const run = await setup(), urls: string[] = []
    const result = await captureUniversityMaintenanceSources(run.options, { ...run.dependencies, fetch: (async input => {
      const url = String(input); urls.push(url)
      return url.endsWith('/robots.txt') ? new Response('', { status: 404 }) : new Response(null, { status: 302, headers: { location: 'https://evil.test/catalog' } })
    }) as typeof fetch })
    expect(urls.some(url => url.includes('evil.test'))).toBe(false)
    expect(result.report).toMatchObject({ results: [{ sources: expect.arrayContaining([expect.objectContaining({ outcome: 'blocked', errorCode: 'unsafe_source_or_redirect', httpStatus: 302 })]) }] })
  })
  it('fails closed on oversized bodies and on private DNS results', async () => {
    const run = await setup()
    const oversized = await captureUniversityMaintenanceSources(run.options, { ...run.dependencies, fetch: (async input => String(input).endsWith('/robots.txt') ? new Response('', { status: 404 }) : new Response('small', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } })) as typeof fetch })
    expect(oversized.report).toMatchObject({ results: [{ sources: expect.arrayContaining([expect.objectContaining({ outcome: 'failed', errorCode: 'body_too_large', rawSha256: null, httpStatus: 200 })]) }] })
    const other = await setup(); let fetched = 0
    await captureUniversityMaintenanceSources(other.options, { ...other.dependencies, resolveAddresses: async () => ['127.0.0.1'], fetch: (async () => { fetched++; return new Response('') }) as typeof fetch })
    expect(fetched).toBe(0)
  })
  it('reuses a completed exact checkpoint without repeating source requests and detects altered bytes', async () => {
    const run = await setup(), first = await captureUniversityMaintenanceSources(run.options, run.dependencies), before = run.calls.length
    const second = await captureUniversityMaintenanceSources(run.options, run.dependencies)
    expect(second.reusedCompletion).toBe(true); expect(run.calls).toHaveLength(before)
    const report = first.report as { results: { sources: { rawFile: string }[] }[] }
    await writeFile(join(first.runDirectory, report.results[0].sources[0].rawFile), 'tampered')
    await expect(captureUniversityMaintenanceSources(run.options, run.dependencies)).rejects.toThrow('checkpoint bytes differ')
    expect(run.calls).toHaveLength(before)
  })
  it('recognizes unchanged bytes in a later plan without extending any record review date', async () => {
    const run = await setup()
    await captureUniversityMaintenanceSources(run.options, run.dependencies)
    const later = buildUniversityMaintenancePlan(run.data, { today: TODAY, limit: 2 })
    await writeFile(run.options.planFile, JSON.stringify(later))
    const result = await captureUniversityMaintenanceSources(run.options, run.dependencies)
    expect(result.receipt).toMatchObject({ results: [{ outcome: 'unchanged' }] })
    expect(result.report).toMatchObject({ results: [{ processingStatus: 'captured_pending_review', sources: [{ outcome: 'unchanged' }, { outcome: 'unchanged' }] }] })
    expect(run.data.universities[0].reviewAfter).toBe('2026-11-13')
  })
  it('processes at most two schools concurrently', async () => {
    const run = await setup(), other = { ...run.data.universities[0], id: 'uni-two', slug: 'uni-two', sourceIds: ['official-two'], officialUrl: 'https://second.test/', admissionsUrl: 'https://second.test/admissions' }
    run.data.universities.push(other)
    run.data.sources.push({ ...run.data.sources[0], id: 'official-two', url: 'https://second.test/catalog' })
    await writeFile(join(run.options.dataDirectory, 'universities.json'), JSON.stringify(run.data.universities))
    await writeFile(join(run.options.dataDirectory, 'sources.json'), JSON.stringify(run.data.sources))
    await writeFile(run.options.planFile, JSON.stringify(buildUniversityMaintenancePlan(run.data, { today: TODAY, limit: 2 })))
    let active = 0, maximum = 0
    await captureUniversityMaintenanceSources(run.options, { ...run.dependencies, fetch: (async input => {
      active++; maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return new Response(String(input).endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : '<p>Source</p>', { headers: { 'content-type': 'text/html' } })
    }) as typeof fetch })
    expect(maximum).toBe(2)
  })
  it('rejects changed inputs/date before any source request and preserves another capture lock', async () => {
    const run = await setup()
    await expect(captureUniversityMaintenanceSources({ ...run.options, today: '2026-10-16' }, run.dependencies)).rejects.toThrow('today')
    expect(() => validateCapturePlan({ ...run.data, programs: [] }, emptyUniversityMaintenanceState(), { ...run.plan, inputSha256: '0'.repeat(64) }, TODAY)).toThrow('exact catalogue')
    const base = join(run.root, '.official-harvest/university-maintenance'); await mkdir(base, { recursive: true }); await writeFile(join(base, 'capture.lock'), 'owned elsewhere')
    await expect(captureUniversityMaintenanceSources(run.options, run.dependencies)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(join(base, 'capture.lock'), 'utf8')).toBe('owned elsewhere')
    expect(run.calls).toHaveLength(0)
  })
  it('never replays a source whose started marker lacks a terminal checkpoint', async () => {
    const run = await setup(), directory = join(run.options.outputDirectory, run.plan.planSha256, 'sources')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, `${sha('https://university.test/admissions|university.test')}.json.started`), 'interrupted')
    const result = await captureUniversityMaintenanceSources(run.options, run.dependencies)
    expect(run.calls.some(call => call.url === 'https://university.test/admissions')).toBe(false)
    expect(result.report).toMatchObject({ results: [{ sources: expect.arrayContaining([expect.objectContaining({ errorCode: 'interrupted_capture_requires_reconciliation' })]) }] })
  })
  it('passes a private validating dispatcher to native fetch without changing global dispatchers', async () => {
    const run = await setup(), spy = vi.spyOn(globalThis, 'fetch').mockImplementation(run.dependencies.fetch)
    const { fetch: injected, ...dependencies } = run.dependencies
    expect(injected).toBeDefined()
    await captureUniversityMaintenanceSources(run.options, dependencies)
    expect(spy).toHaveBeenCalled()
    for (const [, init] of spy.mock.calls) expect(init).toHaveProperty('dispatcher')
  })
  it('finishes an admitted finite batch across China midnight with a registerable original-day receipt', async () => {
    const run = await setup(); let time = Date.parse('2026-10-17T15:59:58Z')
    const result = await captureUniversityMaintenanceSources(run.options, { ...run.dependencies, now: () => new Date(time), sleep: async ms => { time += ms } })
    const received = universityMaintenanceResultsSchema.parse(result.receipt)
    expect(received.results[0].attemptedAt).toBe('2026-10-17T15:59:58.000Z')
    expect(received.results[0].completedAt).toMatch(/^2026-10-17T16:/)
    expect(recordUniversityMaintenanceAttempts(run.plan, emptyUniversityMaintenanceState(), result.receipt).revision).toBe(1)
  })
  it('accepts a fully cooled-down no-op without requests or state advancement', async () => {
    const run = await setup(), state = emptyUniversityMaintenanceState()
    state.attempts['uni-test'] = { lastAttemptAt: '2026-10-17T00:00:00Z', nextAttemptAt: '2026-10-17T16:00:00Z', consecutiveFailures: 0, lastOutcome: 'captured', sourceOffset: 0 }
    const plan = buildUniversityMaintenancePlan(run.data, { today: TODAY, state, limit: 1 })
    await mkdir(join(run.root, '.tmp/university-maintenance'), { recursive: true })
    await writeFile(run.options.stateFile, JSON.stringify(state))
    await writeFile(run.options.planFile, JSON.stringify(plan))
    const result = await captureUniversityMaintenanceSources(run.options, run.dependencies)
    expect(run.calls).toHaveLength(0)
    expect(universityMaintenanceResultsSchema.parse(result.receipt).results).toEqual([])
    expect(recordUniversityMaintenanceAttempts(plan, state, result.receipt)).toEqual(state)
  })
  it('preserves GBK source bytes while finding Chinese-only programme anchor labels', async () => {
    const run = await setup()
    const bytes = Buffer.concat([Buffer.from('<a href="/x">'), Buffer.from([0xd5, 0xd0, 0xc9, 0xfa, 0xd7, 0xa8, 0xd2, 0xb5]), Buffer.from('</a>')])
    const result = await captureUniversityMaintenanceSources(run.options, { ...run.dependencies, fetch: (async input => String(input).endsWith('/robots.txt') ? new Response('', { status: 404 }) : new Response(bytes, { headers: { 'content-type': 'text/html; charset=gbk' } })) as typeof fetch })
    expect(result.report).toMatchObject({ results: [{ sources: expect.arrayContaining([expect.objectContaining({ rawSha256: sha(bytes), candidates: [{ anchorText: '招生专业', url: 'https://university.test/x', status: 'candidate_pending_review' }] })]) }] })
  })
})

describe('source capture input policy', () => {
  it('pins every socket lookup to validated addresses and rejects rebinding/mixed private answers', async () => {
    let calls = 0
    const lookup = createPublicCaptureLookup(async () => ++calls === 1 ? ['93.184.216.34'] : ['93.184.216.34', '127.0.0.1'])
    const resolve = () => new Promise((resolve, reject) => lookup('university.test', { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses)))
    await expect(resolve()).resolves.toEqual([{ address: '93.184.216.34', family: 4 }])
    await expect(resolve()).rejects.toThrow('private_or_unresolved_host')
    expect(calls).toBe(2)
  })
  it.each(['gbk', 'gb2312', 'gb18030'])('decodes declared %s and HTML meta charset without changing raw evidence', charset => {
    const bytes = Buffer.concat([Buffer.from(`<meta charset="${charset}"><a href="/x">`), Buffer.from([0xd5, 0xd0, 0xc9, 0xfa]), Buffer.from('</a>')])
    expect(decodeMaintenanceHtml(bytes)).toContain('招生')
    expect(decodeMaintenanceHtml(bytes, `text/html;charset=${charset}`)).toContain('招生')
    expect(decodeMaintenanceHtml(new TextEncoder().encode('招生'), 'text/html;charset=utf-8')).toBe('招生')
  })
  it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.2', '169.254.1.2', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1'])('rejects non-public resolved address %s', value => expect(isPublicCaptureAddress(value)).toBe(false))
  it.each(['http://university.test/', 'https://user:pass@university.test/', 'https://university.test:8443/', 'https://127.0.0.1/', 'https://localhost/', 'https://evil.test/'])('rejects unsafe source URL %s', url => expect(() => approvedCaptureUrl(url, ['university.test'])).toThrow())
  it('keeps only same-allowlist admissions or programme link candidates', () => {
    expect(extractMaintenanceLinkCandidates('<a href="/catalog">Catalog</a><a href="/news">News</a><a href="javascript:evil()">Programs</a><a href="https://evil.test/programs">Programs</a>', 'https://university.test/', ['university.test']).map(row => row.url)).toEqual(['https://university.test/catalog'])
  })
  it.each([[], ['--plan'], ['--plan', '.tmp/x.json', '--plan', '.tmp/y.json'], ['--unknown', 'x'], ['--plan', '../escape.json']])('rejects ambiguous capture arguments %j', (...args) => expect(() => parseUniversityCaptureArguments(args)).toThrow())
})
