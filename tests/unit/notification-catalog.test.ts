import { describe, expect, it } from 'vitest'
import { observePublishedCatalog } from '@/lib/notifications/catalog'
import { meaningfulFingerprint, nextObservationBaseline, publishedUpdates } from '@/lib/notifications/changes'
import type { DataBundle } from '@/lib/data/types'
import { bundleSchema } from '@/lib/data/schema'

const now = Date.parse('2026-09-30T04:00:00Z')
function catalog(): DataBundle {
  const audit = { sourceIds: ['official-fixture'], status: 'verified' as const, verifiedAt: '2026-09-29', reviewAfter: '2026-10-30' }
  return bundleSchema.parse({
    sources: [{ id: 'official-fixture', url: 'https://example.edu/program', title: 'Official fixture', publisher: 'School', kind: 'program', language: 'en', official: true, accessedAt: '2026-09-29' }], scholarships: [],
    cities: [{ ...audit, id: 'city', slug: 'city', name: { en: 'City' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: [{ ...audit, id: 'school', slug: 'school', name: { en: 'School' }, cityId: 'city', region: null, officialUrl: 'https://example.edu', admissionsUrl: null, summary: null, featured: false }],
    programs: [{ ...audit, id: 'program', slug: 'program', universityId: 'school', name: { en: 'Engineering' }, degreeLevel: 'master', discipline: 'engineering', teachingLanguages: ['en'], durationMonths: 24, programUrl: 'https://example.edu/program', applyUrl: null, languageRequirements: [] }],
    admissionCycles: [{ ...audit, id: 'cycle', programId: 'program', academicYear: '2027-2028', intake: 'autumn', opensOn: '2026-10-01', closesOn: '2027-05-01', dateStatus: 'published', tuitionCny: 20000, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed', evidenceBasis: 'cycle-specific', factScope: 'complete', applicationFeeCny: 500 }],
  })
}

describe('website published catalog observations', () => {
  it('uses only public verified records and links admission facts to the program', () => {
    const observations = observePublishedCatalog(catalog(), now)
    expect(Object.keys(observations)).toEqual(['university:school', 'program:program', 'cycle:cycle'])
    expect(observations['cycle:cycle']).toMatchObject({ id: 'program', kind: 'program', universityId: 'school', slug: 'program', verified: true })
    const draft = catalog()
    draft.programs[0].status = 'draft'
    expect(Object.keys(observePublishedCatalog(draft, now))).toEqual(['university:school'])
  })

  it('does not alert on audit refresh, source provenance or featured promotion', () => {
    const before = observePublishedCatalog(catalog(), now)
    const refreshed = catalog()
    refreshed.programs[0].verifiedAt = '2026-09-30'
    refreshed.sources.push({ ...refreshed.sources[0], id: 'new-evidence' })
    refreshed.programs[0].sourceIds = ['new-evidence']
    refreshed.universities[0].featured = true
    refreshed.admissionCycles[0].verifiedAt = '2026-09-30'
    refreshed.admissionCycles[0].reviewAfter = '2026-10-31'
    expect(Object.keys(observePublishedCatalog(refreshed, now))).toEqual(Object.keys(before))
    expect(publishedUpdates(before, observePublishedCatalog(refreshed, now))).toEqual([])
    expect(meaningfulFingerprint({ verifiedAt: 'old', fee: 20 })).toBe(meaningfulFingerprint({ verifiedAt: 'new', fee: 20 }))
  })

  it('detects verified tuition changes without falsely changing the program profile', () => {
    const before = observePublishedCatalog(catalog(), now)
    const changed = catalog()
    changed.admissionCycles[0].tuitionCny = 30000
    const events = publishedUpdates(before, observePublishedCatalog(changed, now))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ observationKey: 'cycle:cycle', id: 'program', change: 'updated' })
  })

  it('withholds expired facts and keeps their baseline through a later renewal', () => {
    const current = observePublishedCatalog(catalog(), now)
    const expired = catalog()
    expired.programs[0].verifiedAt = '2026-09-01'
    expired.programs[0].reviewAfter = '2026-09-15'
    const stale = observePublishedCatalog(expired, now)
    expect(stale['program:program']).toBeUndefined()
    expect(stale['cycle:cycle']).toBeUndefined()
    expect(publishedUpdates(current, stale)).toEqual([])
    const baseline = nextObservationBaseline(current, stale)
    expect(publishedUpdates(baseline, current)).toEqual([])
  })

  it('does not interpret cycle expiry as a program update', () => {
    const data = catalog()
    data.admissionCycles[0].closesOn = '2026-09-01'
    const before = observePublishedCatalog(data, now)
    const later = observePublishedCatalog(data, Date.parse('2026-10-02T04:00:00Z'))
    expect(later['cycle:cycle'].verified).toBe(false)
    expect(publishedUpdates(before, later)).toEqual([])
  })
})
