import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AdmissionCycle, DataBundle, Program, University } from '@/lib/data/types'
import { buildUniversityMaintenancePlan, emptyUniversityMaintenanceState, recordUniversityMaintenanceAttempts, selectUniversityMaintenanceSources, universityMaintenanceStateSchema } from '@/lib/maintenance/university-coverage'
import { parseUniversityMaintenanceArguments, runUniversityMaintenancePlan } from '../../scripts/automation/build-university-maintenance-plan'

const TODAY = '2026-10-17'
const audit = { sourceIds: ['official'], status: 'verified' as const, verifiedAt: '2026-10-15', reviewAfter: '2026-11-13' }
const university = (id: string): University => ({ ...audit, id, slug: id, name: { en: id }, cityId: 'city', region: 'south', officialUrl: 'https://university.test/', admissionsUrl: 'https://university.test/admissions', summary: null, featured: false })
const program = (id: string, universityId: string): Program => ({ ...audit, id, slug: id, universityId, name: { en: id }, degreeLevel: 'master', discipline: 'engineering', teachingLanguages: ['English'], durationMonths: 24, programUrl: 'https://university.test/program', applyUrl: 'https://university.test/apply', languageRequirements: [{ test: 'IELTS', minimum: '6.5' }], verificationScope: 'facts' })
const cycle = (id: string, programId: string): AdmissionCycle => ({ ...audit, id, programId, academicYear: '2027-2028', intake: 'autumn', opensOn: '2026-10-01', closesOn: '2027-01-01', dateStatus: 'published', tuitionCny: null, tuitionPeriod: null, tuitionStatus: null, applicationFeeCny: null, evidenceBasis: 'cycle-specific', factScope: 'dates-only' })
function fixture(): DataBundle {
  const expiring = program('program-b', 'uni-b'); expiring.reviewAfter = '2026-10-18'
  return {
    sources: [{ id: 'official', url: 'https://university.test/program', title: 'Official programme', publisher: 'University', kind: 'program', language: 'en', official: true, accessedAt: '2026-10-15' }],
    cities: [{ ...audit, id: 'city', slug: 'city', name: { en: 'City' }, province: null, region: 'south', coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: [university('uni-c'), university('uni-a'), university('uni-b')],
    programs: [program('program-c', 'uni-c'), expiring],
    admissionCycles: [cycle('cycle-c', 'program-c'), cycle('cycle-b', 'program-b')], scholarships: [],
  }
}
const receipt = (plan: ReturnType<typeof buildUniversityMaintenancePlan>, id: string, outcome: 'captured' | 'failed' | 'blocked' | 'no_sources' = 'captured') => ({
  format: 'studyinchina.university-maintenance-results', version: 1, planSha256: plan.planSha256,
  results: [{ universityId: id, outcome, attemptedAt: `${TODAY}T08:00:00Z` }],
})

describe('all-map university maintenance planning', () => {
  it('covers every published university rather than schools already having programmes', () => {
    const data = fixture()
    for (let index = 0; index < 12; index++) data.universities.push(university(`uni-extra-${index}`))
    const before = JSON.stringify(data), plan = buildUniversityMaintenancePlan(data, { today: TODAY, limit: 100 })
    expect(plan.summary.mapUniversities).toBe(15)
    expect(plan.summary.neverDiscovered).toBe(13)
    expect(plan.universities.map(row => row.universityId)).toContain('uni-a')
    expect(plan.selectedUniversityIds).toHaveLength(15)
    expect(JSON.stringify(data)).toBe(before)
    expect(plan.policy.publicationPerformed).toBe(false)
  })
  it('reports expired university and unpublished city identities separately', () => {
    const data = fixture(), hidden = university('uni-hidden'), missingCity = university('uni-other-city')
    hidden.reviewAfter = '2026-10-16'; missingCity.cityId = 'missing'
    data.universities.push(hidden, missingCity)
    const plan = buildUniversityMaintenancePlan(data, { today: TODAY, limit: 100 })
    expect(plan.universities).toHaveLength(3)
    expect(plan.hiddenUniversities.map(row => row.reason)).toEqual(['identity-review-expired', 'city-not-published'])
    expect(plan.selectedUniversityIds).not.toContain('uni-hidden')
  })
  it('prioritizes zero-current, then expiring, then routine when equally unattempted', () => {
    const plan = buildUniversityMaintenancePlan(fixture(), { today: TODAY })
    expect(plan.selectedUniversityIds).toEqual(['uni-a', 'uni-b', 'uni-c'])
    expect(plan.universities.find(row => row.universityId === 'uni-b')?.reasons).toContain('expiring-within-seven-days')
  })
  it('keeps programme review expiry, identity-only status and expired cycles independent', () => {
    const data = fixture(), stale = program('old', 'uni-a'), identity = program('identity', 'uni-a'), draft = program('draft', 'uni-a')
    stale.status = 'stale'; stale.reviewAfter = '2026-10-16'; identity.verificationScope = 'identity'; draft.status = 'draft'
    data.programs.push(stale, identity, draft)
    data.admissionCycles.push({ ...cycle('closed', 'program-c'), closesOn: '2026-10-16' })
    const plan = buildUniversityMaintenancePlan(data, { today: TODAY })
    const row = plan.universities.find(row => row.universityId === 'uni-a')!
    expect(row.programs).toMatchObject({ raw: 3, current: 0, expiredReview: 1, identityOnly: 1, draft: 1 })
    expect(row.identity.status).toBe('verified')
    expect(plan.universities.find(row => row.universityId === 'uni-c')?.cycles).toMatchObject({ raw: 2, current: 1, deadlinePassed: 1, expiredReview: 0 })
  })
  it('is deterministic for the same data, state and date and never renews data', () => {
    const data = fixture(), state = emptyUniversityMaintenanceState(), before = JSON.stringify({ data, state })
    expect(buildUniversityMaintenancePlan(data, { today: TODAY, state })).toEqual(buildUniversityMaintenancePlan(data, { today: TODAY, state }))
    expect(JSON.stringify({ data, state })).toBe(before)
    expect(buildUniversityMaintenancePlan(data, { today: '2026-10-18' }).planSha256).not.toBe(buildUniversityMaintenancePlan(data, { today: TODAY }).planSha256)
  })
  it('rotates to untouched schools and schedules successful capture without approving facts', () => {
    const data = fixture(), initial = emptyUniversityMaintenanceState()
    const first = buildUniversityMaintenancePlan(data, { today: TODAY, state: initial, limit: 1 })
    const state = recordUniversityMaintenanceAttempts(first, initial, receipt(first, 'uni-a'))
    expect(state.attempts['uni-a'].nextAttemptAt).toBe('2026-10-17T16:00:00.000Z')
    const next = buildUniversityMaintenancePlan(data, { today: TODAY, state, limit: 1 })
    expect(next.selectedUniversityIds).toEqual(['uni-b'])
    expect(buildUniversityMaintenancePlan(data, { today: '2026-10-18', state, limit: 3 }).selectedUniversityIds).toEqual(['uni-b', 'uni-c', 'uni-a'])
    expect(data.universities[1].verifiedAt).toBe('2026-10-15')
  })
  it('backs off failures exponentially and blocked sources for fourteen days', () => {
    const data = fixture(), initial = emptyUniversityMaintenanceState(), first = buildUniversityMaintenancePlan(data, { today: TODAY, limit: 1 })
    const state = recordUniversityMaintenanceAttempts(first, initial, receipt(first, 'uni-a', 'failed'))
    expect(buildUniversityMaintenancePlan(data, { today: TODAY, state }).selectedUniversityIds).not.toContain('uni-a')
    // Advance to its next eligible day and use a full batch, preserving exact receipt scope.
    const second = buildUniversityMaintenancePlan(data, { today: '2026-10-18', state, limit: 3 })
    const again = recordUniversityMaintenanceAttempts(second, state, { ...receipt(second, 'uni-a', 'failed'), results: [{ universityId: 'uni-a', outcome: 'failed', attemptedAt: '2026-10-18T08:00:00Z' }] })
    expect(again.attempts['uni-a'].nextAttemptAt).toBe('2026-10-19T16:00:00.000Z')
    const blocked = recordUniversityMaintenanceAttempts(first, initial, receipt(first, 'uni-a', 'blocked'))
    expect(buildUniversityMaintenancePlan(data, { today: '2026-10-20', state: blocked }).universities.find(row => row.universityId === 'uni-a')?.scheduling.eligible).toBe(false)
    expect(blocked.attempts['uni-a'].nextAttemptAt).toBe('2026-10-30T16:00:00.000Z')
  })
  it('rejects stale-plan receipts, unselected IDs, duplicate results and wrong China dates', () => {
    const initial = emptyUniversityMaintenanceState(), plan = buildUniversityMaintenancePlan(fixture(), { today: TODAY, limit: 1 }), valid = receipt(plan, 'uni-a')
    expect(() => recordUniversityMaintenanceAttempts(plan, initial, { ...valid, planSha256: '0'.repeat(64) })).toThrow('exact current plan')
    expect(() => recordUniversityMaintenanceAttempts(plan, initial, receipt(plan, 'uni-c'))).toThrow('selected university')
    expect(() => recordUniversityMaintenanceAttempts(plan, initial, { ...valid, results: [...valid.results, ...valid.results] })).toThrow('exactly once')
    expect(() => recordUniversityMaintenanceAttempts(plan, initial, { ...valid, results: [{ ...valid.results[0], attemptedAt: '2026-10-16T08:00:00Z' }] })).toThrow('China calendar')
    const changed = fixture(); changed.universities.push(university('uni-new'))
    expect(() => recordUniversityMaintenanceAttempts(buildUniversityMaintenancePlan(changed, { today: TODAY, limit: 1 }), initial, valid)).toThrow('exact current plan')
  })
  it('rotates beyond the first two approved sources and rejects an invented cursor', () => {
    const data = fixture()
    data.sources.push({ ...data.sources[0], id: 'third', url: 'https://university.test/doctoral-catalog' })
    data.universities.find(row => row.id === 'uni-a')!.sourceIds = ['official', 'third']
    const initial = emptyUniversityMaintenanceState(), first = buildUniversityMaintenancePlan(data, { today: TODAY, limit: 1 })
    const school = first.universities.find(row => row.universityId === 'uni-a')!
    expect(selectUniversityMaintenanceSources(school).selectedUrls).toEqual(['https://university.test/admissions', 'https://university.test/program'])
    const input = receipt(first, 'uni-a')
    const outcome = { ...input, results: [{ ...input.results[0], sourceOffset: 2 }] }
    expect(() => recordUniversityMaintenanceAttempts(first, initial, { ...outcome, results: [{ ...outcome.results[0], sourceOffset: 1 }] })).toThrow('bounded source rotation')
    const state = recordUniversityMaintenanceAttempts(first, initial, outcome)
    const later = buildUniversityMaintenancePlan(data, { today: '2026-10-18', state, limit: 3 })
    expect(selectUniversityMaintenanceSources(later.universities.find(row => row.universityId === 'uni-a')!).selectedUrls).toEqual(['https://university.test/doctoral-catalog', 'https://university.test/admissions'])
  })
  it('defaults legacy attempt cursors to zero and keeps no-work receipts revision-neutral', () => {
    const data = fixture(), state = emptyUniversityMaintenanceState()
    for (const university of data.universities) state.attempts[university.id] = { lastAttemptAt: `${TODAY}T00:00:00Z`, nextAttemptAt: `${TODAY}T16:00:00Z`, consecutiveFailures: 0, lastOutcome: 'captured', sourceOffset: 0 }
    const legacy = structuredClone(state)
    delete (legacy.attempts['uni-a'] as { sourceOffset?: number }).sourceOffset
    expect(universityMaintenanceStateSchema.parse(legacy).attempts['uni-a'].sourceOffset).toBe(0)
    const plan = buildUniversityMaintenancePlan(data, { today: TODAY, state })
    const noWork = { format: 'studyinchina.university-maintenance-results', version: 1, planSha256: plan.planSha256, results: [] }
    expect(plan.selectedUniversityIds).toEqual([])
    expect(recordUniversityMaintenanceAttempts(plan, state, noWork)).toEqual(state)
    const nonempty = buildUniversityMaintenancePlan(data, { today: TODAY })
    expect(() => recordUniversityMaintenanceAttempts(nonempty, emptyUniversityMaintenanceState(), { ...noWork, planSha256: nonempty.planSha256 })).toThrow('only valid for an empty plan')
  })
})

describe('maintenance planner CLI boundary', () => {
  it('accepts read-only bounded-capture receipts while keeping output paths outside private evidence', () => {
    expect(parseUniversityMaintenanceArguments(['--record-attempts', '.official-harvest/university-maintenance/run/results.json']).recordAttempts).toContain('results.json')
    expect(() => parseUniversityMaintenanceArguments(['--output', '.official-harvest/university-maintenance/run/results.json'])).toThrow()
  })
  it.each([['--limit', '0'], ['--limit', '1.5'], ['--limit', '1001'], ['--today', '2026-02-30'], ['--unknown', 'x'], ['--limit'], ['--limit', '1', '--limit', '2'], ['--output', '../escape.json'], ['--output', 'content/data/programs.json'], ['--data-dir', '../outside'], ['--output', '.tmp/x.json', '--state-file', '.tmp/x.json']])('rejects unsafe or ambiguous arguments %j', (...args) => {
    expect(() => parseUniversityMaintenanceArguments(args)).toThrow()
  })
  it('writes a plan without creating state, and refuses a concurrent state writer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'university-plan-'))
    try {
      const dataDir = join(root, 'content/data'); await mkdir(dataDir, { recursive: true })
      const files = { sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships' }
      for (const [key, file] of Object.entries(files)) await writeFile(join(dataDir, `${file}.json`), JSON.stringify(fixture()[key as keyof DataBundle]))
      const options = parseUniversityMaintenanceArguments(['--today', TODAY, '--limit', '1'], root)
      const plan = await runUniversityMaintenancePlan(options)
      await expect(readFile(options.stateFile)).rejects.toMatchObject({ code: 'ENOENT' })
      const resultPath = join(root, '.tmp/result.json'); await writeFile(resultPath, JSON.stringify(receipt(plan, 'uni-a')))
      await writeFile(`${options.stateFile}.lock`, 'another writer')
      await expect(runUniversityMaintenancePlan({ ...options, recordAttempts: resultPath })).rejects.toMatchObject({ code: 'EEXIST' })
      expect(await readFile(`${options.stateFile}.lock`, 'utf8')).toBe('another writer')
      await rm(`${options.stateFile}.lock`)
      const next = await runUniversityMaintenancePlan({ ...options, recordAttempts: resultPath })
      expect(next.selectedUniversityIds).toEqual(['uni-b'])
      expect(JSON.parse(await readFile(options.stateFile, 'utf8')).revision).toBe(1)
      expect(JSON.parse(await readFile(join(dataDir, 'universities.json'), 'utf8'))[1].verifiedAt).toBe('2026-10-15')
      await expect(runUniversityMaintenancePlan({ ...options, recordAttempts: resultPath })).rejects.toThrow('exact current plan')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
