import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getTodayDate } from '../../src/lib/data/freshness'
import { loadSmokeExpectation, redactSmokeError, type SmokeInput } from '../../scripts/quality/release-public-smoke'

const root = process.cwd(), directories: string[] = []
function fixture() { mkdirSync(join(root, '.tmp'), { recursive: true }); const path = mkdtempSync(join(root, '.tmp', 'release-smoke-test-')); directories.push(path); return path }
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')

function frozenFixture() {
  const directory = fixture(), today = getTodayDate()
  const audit = { sourceIds: ['official'], verifiedAt: today, reviewAfter: today, status: 'verified' }
  const source = { id: 'official', url: 'https://fixture.edu/program', title: 'Synthetic official fixture', publisher: 'Fixture University', kind: 'program', language: 'en', official: true, accessedAt: today }
  const program = { ...audit, id: 'program', slug: 'program', universityId: 'university', name: { en: 'Chinese language' }, degreeLevel: 'language', discipline: 'chinese-education', teachingLanguages: ['Chinese'], durationMonths: null, durationText: { en: 'One semester' }, programUrl: source.url, applyUrl: 'https://fixture.edu/apply', languageRequirements: [{ test: 'other', minimum: 'Beginners accepted.' }], verificationScope: 'facts' }
  const cycle = { ...audit, id: 'cycle', programId: program.id, academicYear: '2026-2027', intake: 'spring', opensOn: null, closesOn: today, dateStatus: 'published', tuitionCny: 7000, tuitionPeriod: 'semester', tuitionStatus: 'confirmed', evidenceBasis: 'cycle-specific', factScope: 'complete', applicationFeeCny: 400 }
  const scholarship = { ...audit, id: 'award', slug: 'award', name: { en: 'Synthetic award' }, providerType: 'university', universityIds: ['university'], programIds: [program.id], coverage: { tuition: 'full', accommodation: 'partial', insurance: false, stipendCnyPerMonth: null }, deadline: today, applicationUrl: 'https://fixture.edu/award', summary: { en: 'Competitive funding.' }, eligibility: [{ en: 'New applicants only.' }] }
  const catalog = {
    sources: [source],
    cities: [{ ...audit, id: 'city', slug: 'city', name: { en: 'Fixture City' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: [{ ...audit, id: 'university', slug: 'university', name: { en: 'Fixture University' }, cityId: 'city', region: null, officialUrl: 'https://fixture.edu', admissionsUrl: null, summary: null, featured: false }],
    programs: [program], 'admission-cycles': [cycle], scholarships: [scholarship],
  }
  const pins: { path: string; sha256: string; bytes: number }[] = []
  for (const [name, value] of Object.entries(catalog)) {
    const path = `content/data/${name}.json`, bytes = JSON.stringify(value)
    mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), bytes)
    pins.push({ path, sha256: sha(bytes), bytes: Buffer.byteLength(bytes) })
  }
  for (const path of ['src/lib/data/schema.ts', 'src/lib/data/publication.ts', 'src/lib/data/format.ts', 'src/lib/data/duration.ts', 'src/lib/data/admission.ts', 'src/lib/data/labels.ts', 'src/lib/data/scholarship.ts', 'src/i18n/config.ts', 'src/i18n/messages.ts', 'src/i18n/tuition-reference.ts', 'src/i18n/release-announcement.ts', 'content/data/program-localizations.json']) {
    const bytes = readFileSync(join(root, path)); mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), bytes)
    pins.push({ path, sha256: sha(bytes), bytes: bytes.length })
  }
  writeFileSync(join(directory, 'plan.json'), JSON.stringify({ pins }))
  const approval = { reviewer: 'codex', reviewedAt: new Date().toISOString() }
  writeFileSync(join(directory, 'program-batch.json'), JSON.stringify({ schemaVersion: 1, batchId: 'synthetic-program', entries: [{ ...approval, program, cycle }] }))
  const scholarshipBatch = { schemaVersion: 1, batchId: 'synthetic-award', entries: [{ ...approval, scholarship }] }
  writeFileSync(join(directory, 'scholarship-batch.json'), JSON.stringify(scholarshipBatch))
  const input: SmokeInput = { schemaVersion: 1, today, dataDirectory: 'content/data', sourcePlan: 'plan.json', batches: ['program-batch.json'], expectedPrograms: 1, expectedUniversities: 1, expectedChangedPrograms: 1, expectedChangedUniversities: 1, staleSlugs: ['not-public'] }
  const load = () => { writeFileSync(join(directory, 'input.json'), JSON.stringify(input)); return loadSmokeExpectation(directory, 'input.json') }
  return { directory, input, scholarshipBatch, load }
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('release smoke evidence safety', () => {
  it('preserves programme-only expectations and their manifest shape', () => {
    const f = frozenFixture(), expected = f.load()
    expect(expected.changed).toHaveLength(1)
    expect(expected.changedScholarships).toEqual([])
    expect(expected.expectedInputManifest).not.toHaveProperty('scholarshipBatches')
  })

  it('binds approved scholarship facts and their batch bytes into the frozen expectation', () => {
    const f = frozenFixture()
    Object.assign(f.input, { scholarshipBatches: ['scholarship-batch.json'], expectedChangedScholarships: 1, expectedScholarships: 1 })
    const expected = f.load()
    expect(expected.changedScholarships).toEqual([f.scholarshipBatch.entries[0].scholarship])
    expect(expected.expectedInputManifest.scholarshipBatches).toEqual([expect.objectContaining({ path: 'scholarship-batch.json', sha256: sha(readFileSync(join(f.directory, 'scholarship-batch.json'))) })])
    expect(expected.expectedInputManifest.supportPins.some(pin => pin.path === 'src/lib/data/scholarship.ts')).toBe(true)
    f.scholarshipBatch.entries[0].scholarship.coverage.tuition = 'none'
    writeFileSync(join(f.directory, 'scholarship-batch.json'), JSON.stringify(f.scholarshipBatch))
    expect(() => f.load()).toThrow('approved_scholarship_differs_from_frozen_catalog')
  })

  it.each([
    { expectedScholarships: 1 },
    { expectedChangedScholarships: 1 },
    { scholarshipBatches: ['scholarship-batch.json'] },
    { scholarshipBatches: [], expectedChangedScholarships: -1, expectedScholarships: 1 },
  ])('rejects partial or invalid scholarship expectations instead of silently omitting checks: %j', options => {
    const f = frozenFixture(); Object.assign(f.input, options)
    expect(() => f.load()).toThrow('scholarship_expectation_contract_invalid')
  })

  it('rejects a scholarship total that differs from the frozen public catalogue', () => {
    const f = frozenFixture()
    Object.assign(f.input, { scholarshipBatches: [], expectedChangedScholarships: 0, expectedScholarships: 0 })
    expect(() => f.load()).toThrow('expected_scholarship_scope_mismatch')
  })

  it('redacts literal and URL-encoded protection credentials from errors', () => {
    const secret = 'private/token+value', result = redactSmokeError(new Error(`request failed ${secret} ${encodeURIComponent(secret)}`), secret)
    expect(result).not.toContain(secret)
    expect(result).not.toContain(encodeURIComponent(secret))
    expect(result.match(/\[REDACTED\]/gu)).toHaveLength(2)
  })

  it('redacts protection-header values and bounds arbitrary exception output', () => {
    expect(redactSmokeError('x-vercel-protection-bypass: a-secret-value, response=401')).not.toContain('a-secret-value')
    expect(redactSmokeError('a'.repeat(10000))).toHaveLength(1500)
  })

  it('drops the entire Playwright call log including Cookie and Authorization', () => {
    const result = redactSmokeError(new Error('apiRequestContext.get: socket disconnected\nCall log:\n  - GET https://studyinchina.vercel.app/en\n  - Cookie: sso_nonce=private-cookie\n  - Authorization: Bearer private-auth\n  - x-vercel-protection-bypass: private-bypass'))
    expect(result).toBe('apiRequestContext.get: socket disconnected')
    for (const secret of ['private-cookie', 'private-auth', 'private-bypass', 'Call log', 'Cookie', 'Authorization']) expect(result).not.toContain(secret)
  })

  it('drops single-line sensitive header diagnostics even without a known bypass key', () => {
    for (const message of ['Cookie: sso_nonce=private-cookie', 'request failed; Authorization: Bearer private-auth', 'headers={"cookie":"private-cookie"}', 'Set-Cookie: private-session; Secure']) {
      expect(redactSmokeError(message)).toBe('[sensitive request diagnostics removed]')
    }
  })

  it('rejects evidence paths outside the workspace before reading files', () => {
    expect(() => loadSmokeExpectation(root, '../outside-smoke.json')).toThrow('input_path_outside_workspace')
  })

  it('rejects a stale date instead of silently checking a different publication day', () => {
    const directory = fixture(), input = join(directory, 'input.json')
    writeFileSync(input, JSON.stringify({ schemaVersion: 1, today: '2000-01-01' }))
    expect(() => loadSmokeExpectation(root, relative(root, input))).toThrow('smoke_input_date_is_not_current_china_calendar')
  })

  it('rejects a modified catalogue whose bytes are not pinned in the source plan', () => {
    const directory = fixture(), plan = join(directory, 'source-plan.json'), input = join(directory, 'input.json')
    writeFileSync(plan, JSON.stringify({ pins: [{ path: 'content/data/sources.json', sha256: '0'.repeat(64) }] }))
    writeFileSync(input, JSON.stringify({ schemaVersion: 1, today: getTodayDate(), dataDirectory: 'content/data', sourcePlan: relative(root, plan), batches: ['not-read.json'], staleSlugs: ['unpublished-sentinel'], expectedPrograms: 1, expectedUniversities: 1, expectedChangedPrograms: 1, expectedChangedUniversities: 1 }))
    expect(() => loadSmokeExpectation(root, relative(root, input))).toThrow('expected_data_not_bound_to_source_plan:sources')
  })

  it('rejects ambiguous duplicate pins in a source plan', () => {
    const directory = fixture(), plan = join(directory, 'source-plan.json'), input = join(directory, 'input.json')
    const pin = { path: 'content/data/sources.json', sha256: '0'.repeat(64) }
    writeFileSync(plan, JSON.stringify({ pins: [pin, pin] }))
    writeFileSync(input, JSON.stringify({ schemaVersion: 1, today: getTodayDate(), dataDirectory: 'content/data', sourcePlan: relative(root, plan), batches: ['not-read.json'], staleSlugs: ['unpublished-sentinel'], expectedPrograms: 1, expectedUniversities: 1, expectedChangedPrograms: 1, expectedChangedUniversities: 1 }))
    expect(() => loadSmokeExpectation(root, relative(root, input))).toThrow('source_plan_duplicate_or_invalid_pins')
  })
})
