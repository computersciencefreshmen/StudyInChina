import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assessCatalogSnapshot } from '../../scripts/automation/assess-catalog-snapshot'
import { readCatalogBundle } from '../../scripts/automation/build-catalog-seeds'
import { getCatalogRecordCounts } from '../../src/lib/catalog/release'
import type { DataBundle } from '../../src/lib/data/types'

const baseline = readCatalogBundle('content/data')
const now = new Date('2026-09-16T00:00:00Z')
function snapshot(bundle = baseline, generatedAt = now.toISOString()) {
  const counts = getCatalogRecordCounts(bundle)
  const bytes = Buffer.from(JSON.stringify({ data: bundle, meta: { release: {
    id: 'pipeline-test-release', dataDate: '2026-09-16', generatedAt, recordCounts: counts,
    rawCounts: counts, publicCounts: counts, catalogBackend: 'd1',
  } } }))
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex') }
}

describe('automatic catalog snapshot publication', () => {
  it('accepts a complete fresh release', () => {
    const { bytes, hash } = snapshot()
    expect(assessCatalogSnapshot(baseline, bytes, hash, now).eligible).toBe(true)
  })
  it('rejects corrupted bytes before reading the bundle', () => {
    const { bytes } = snapshot()
    expect(() => assessCatalogSnapshot(baseline, bytes, '0'.repeat(64), now)).toThrow('checksum')
  })
  it('rejects an older complete release', () => {
    const { bytes, hash } = snapshot(baseline, '2026-07-26T00:00:00Z')
    expect(assessCatalogSnapshot(baseline, bytes, hash, now).issues).toContain('snapshot_outside_48_hour_window')
  })
  it('rejects equal-count replacement of an existing project and newer metadata with older evidence', () => {
    const next = structuredClone(baseline)
    const original = next.programs[0].id
    next.programs[0].id = 'unexpected-replacement'
    next.admissionCycles.forEach(row => { if (row.programId === original) row.programId = next.programs[0].id })
    next.scholarships.forEach(row => { row.programIds = row.programIds.map(id => id === original ? next.programs[0].id : id) })
    next.universities[0].verifiedAt = '2020-01-01'
    const { bytes, hash } = snapshot(next)
    const result = assessCatalogSnapshot(baseline, bytes, hash, now)
    expect(result.eligible).toBe(false)
    expect(result.issues).toContain(`identity_missing:programs:${original}`)
    expect(result.issues.some(issue => issue.startsWith('evidence_regression:universities:'))).toBe(true)
  })
})

// Small, explicit facts avoid depending on which real school happens to be first.
function baselineWithFacts(): DataBundle {
  const bundle = structuredClone(baseline)
  Object.assign(bundle.programs[0], {
    status: 'stale', verifiedAt: '2026-09-01', reviewAfter: '2026-09-30',
    teachingLanguages: ['English', 'Chinese'], durationMonths: 12, durationMonthsMax: 24,
    applyUrl: 'https://example.edu.cn/apply',
    languageRequirements: [{ test: 'HSK', minimum: '4' }, { test: 'IELTS', minimum: '6' }],
    details: {
      faculty: { en: 'Faculty', zh: '学院' }, overview: { en: 'Overview' }, qualification: { en: 'Certificate' },
      studyMode: 'full-time', languagePolicy: { en: 'English or Chinese' },
      curriculumHighlights: [{ en: 'Chinese', zh: '中文' }, { en: 'Culture' }],
      eligibility: [{ en: 'High school graduate' }],
      applicationMaterials: [{ en: 'Passport' }, { en: 'Diploma' }],
    },
  })
  Object.assign(bundle.admissionCycles[0], {
    status: 'stale', verifiedAt: '2026-09-01', reviewAfter: '2026-09-30',
    opensOn: '2025-01-01', closesOn: '2025-05-01', dateStatus: 'published',
    tuitionCny: 12000, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed', applicationFeeCny: 0,
  })
  Object.assign(bundle.scholarships[0], {
    status: 'stale', verifiedAt: '2026-09-01', reviewAfter: '2026-09-30',
    coverage: { tuition: 'full', accommodation: 'none', insurance: false, stipendCnyPerMonth: 0 },
  })
  bundle.universities[0].admissionsUrl = 'https://example.edu.cn/admissions'
  bundle.cities[0].coordinates = { lat: 0, lng: 0 }
  return bundle
}

const erasures: { name: string; field: string; mutate: (bundle: DataBundle) => void }[] = [
  { name: 'teaching languages', field: 'teachingLanguages', mutate: b => { b.programs[0].teachingLanguages = [] } },
  { name: 'one teaching language', field: 'teachingLanguages', mutate: b => { b.programs[0].teachingLanguages = ['English'] } },
  { name: 'language requirements', field: 'languageRequirements', mutate: b => { b.programs[0].languageRequirements = [] } },
  { name: 'one requirement minimum', field: 'languageRequirements[HSK].minimum', mutate: b => { b.programs[0].languageRequirements[0].minimum = null } },
  { name: 'blank requirement minimum', field: 'languageRequirements[HSK].minimum', mutate: b => { b.programs[0].languageRequirements[0].minimum = '  ' } },
  { name: 'duration', field: 'durationMonths', mutate: b => { b.programs[0].durationMonths = null; b.programs[0].durationMonthsMax = null } },
  { name: 'application URL', field: 'applyUrl', mutate: b => { b.programs[0].applyUrl = null } },
  { name: 'optional detail object', field: 'details', mutate: b => { delete b.programs[0].details } },
  { name: 'localized detail', field: 'details.faculty.zh', mutate: b => { delete b.programs[0].details!.faculty.zh } },
  { name: 'localized list content', field: 'details.curriculumHighlights[].zh', mutate: b => { delete b.programs[0].details!.curriculumHighlights[0].zh } },
  { name: 'historical tuition', field: 'tuitionCny', mutate: b => { b.admissionCycles[0].tuitionCny = null } },
  { name: 'zero application fee', field: 'applicationFeeCny', mutate: b => { b.admissionCycles[0].applicationFeeCny = null } },
  { name: 'tuition billing period', field: 'tuitionPeriod', mutate: b => { delete b.admissionCycles[0].tuitionPeriod } },
  { name: 'scholarship coverage', field: 'coverage.tuition', mutate: b => { b.scholarships[0].coverage.tuition = 'unknown' } },
  { name: 'false insurance fact', field: 'coverage.insurance', mutate: b => { b.scholarships[0].coverage.insurance = 'unknown' } },
  { name: 'zero stipend', field: 'coverage.stipendCnyPerMonth', mutate: b => { b.scholarships[0].coverage.stipendCnyPerMonth = null } },
  { name: 'university admissions route', field: 'admissionsUrl', mutate: b => { b.universities[0].admissionsUrl = null } },
  { name: 'zero-valued coordinates', field: 'coordinates', mutate: b => { b.cities[0].coordinates = null } },
]

describe('snapshot fact preservation', () => {
  it.each(erasures)('rejects erasure of $name despite newer verification metadata', ({ field, mutate }) => {
    const previous = baselineWithFacts()
    const next = structuredClone(previous)
    for (const key of ['programs', 'admissionCycles', 'scholarships'] as const) next[key][0].verifiedAt = '2026-09-16'
    mutate(next)
    const { bytes, hash } = snapshot(next)
    const assessment = assessCatalogSnapshot(previous, bytes, hash, now)
    expect(assessment.eligible).toBe(false)
    expect(assessment.issues.some(issue => issue.startsWith('field_erasure:') && issue.endsWith(':' + field))).toBe(true)
  })

  it('accepts populated corrections, explicit zero/false, and reordered requirements or localized lists', () => {
    const previous = baselineWithFacts()
    const next = structuredClone(previous)
    next.admissionCycles[0].tuitionCny = 0
    next.programs[0].languageRequirements[0].minimum = '5'
    next.programs[0].languageRequirements.reverse()
    next.programs[0].teachingLanguages.reverse()
    next.programs[0].details!.curriculumHighlights.reverse()
    next.programs[0].details!.overview.en = 'Updated official overview'
    const { bytes, hash } = snapshot(next)
    expect(assessCatalogSnapshot(previous, bytes, hash, now).eligible).toBe(true)
  })

  it('accepts completing a previously unknown fact', () => {
    const previous = baselineWithFacts()
    previous.programs[0].durationMonths = null
    previous.programs[0].durationMonthsMax = null
    previous.programs[0].teachingLanguages = []
    const next = structuredClone(previous)
    next.programs[0].durationMonths = 12
    next.programs[0].teachingLanguages = ['Chinese']
    const { bytes, hash } = snapshot(next)
    expect(assessCatalogSnapshot(previous, bytes, hash, now).eligible).toBe(true)
  })
})
