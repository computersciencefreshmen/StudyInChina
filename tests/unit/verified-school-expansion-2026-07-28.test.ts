import { describe, expect, it } from 'vitest'
import sources from '../../content/data/sources.json'
import cities from '../../content/data/cities.json'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import scholarships from '../../content/data/scholarships.json'
import { selectPublishedData } from '@/lib/data/publication'
import { bundleSchema } from '@/lib/data/schema'

const data = bundleSchema.parse({
  sources,
  cities,
  universities,
  programs,
  admissionCycles,
  scholarships,
})

const wkuBatchProgramIds = new Set([
  'program-wenzhou-kean-university-finance-bs',
  'program-wenzhou-kean-university-global-business-bs',
  'program-wenzhou-kean-university-computer-science-bs',
  'program-wenzhou-kean-university-biology-cell-molecular-bs',
  'program-wenzhou-kean-university-architecture-bfa',
])

describe('verified school expansion on 2026-07-28', () => {
  it('preserves the five original WKU bachelors with exact official program sources', () => {
    const university = data.universities.find(
      (item) => item.id === 'uni-wenzhou-kean-university',
    )
    expect(university?.cityId).toBe('city-wenzhou')
    expect(university?.admissionsUrl).toBe(
      'https://admission.wku.edu.cn/en/internationalstudents',
    )

    // Later degrees have their own evidence; this regression protects this batch.
    const schoolPrograms = data.programs.filter(item => wkuBatchProgramIds.has(item.id))
    expect(schoolPrograms).toHaveLength(wkuBatchProgramIds.size)
    for (const item of schoolPrograms) {
      expect(item.universityId).toBe(university?.id)
      expect(item.durationMonths).toBe(48)
      expect(item.teachingLanguages).toEqual(['English'])
      expect(item.applyUrl).toBe('https://intlapply.wku.edu.cn/')
      expect(
        data.sources.some(
          (source) => source.kind === 'program'
            && source.official
            && source.url === item.programUrl
            && item.sourceIds.includes(source.id),
        ),
      ).toBe(true)
    }
  })

  it('keeps WKU spring entry visibly restricted to transfer students', () => {
    const cycles = data.admissionCycles.filter(item => wkuBatchProgramIds.has(item.programId))
    expect(cycles).toHaveLength(5)
    for (const cycle of cycles) {
      expect(cycle.academicYear).toBe('2026-2027')
      expect(cycle.intake).toBe('spring')
      expect(cycle.closesOn).toBe('2026-11-01')
      expect(cycle.tuitionCny).toBe(68000)
      expect(cycle.applicationFeeCny).toBe(400)
      expect(cycle.notes?.en).toContain('transfer students only')
      expect(cycle.notes?.zh).toContain('仅面向转学生')
    }
  })

  it('models the WKU freshman scholarship as one two-tier fall award', () => {
    const scholarship = data.scholarships.find(
      (item) => item.id === 'scholarship-wku-freshman-2026',
    )
    expect(scholarship?.coverage.tuition).toBe('partial')
    expect(scholarship?.deadline).toBe('2026-06-30')
    expect(scholarship?.summary?.en).toContain('60%')
    expect(scholarship?.summary?.en).toContain('30%')
    expect(scholarship?.summary?.en).toContain('fall freshmen')

    expect(
      selectPublishedData(data, '2026-07-28').scholarships.some(
        (item) => item.id === scholarship?.id,
      ),
    ).toBe(false)
    expect(
      selectPublishedData(data, '2026-07-31').scholarships.some(
        (item) => item.id === scholarship?.id,
      ),
    ).toBe(false)
  })

  it('preserves the five BUPT English programs from this batch without inventing an absolute deadline', () => {
    const expectedTuition = new Map([
      ['program-bupt-computer-science-and-technology-bachelor-english', 24600],
      ['program-bupt-computer-technology-master-english', 32800],
      ['program-bupt-international-business-master-english', 32800],
      ['program-bupt-information-and-communication-engineering-doctorate-english', 41000],
      ['program-bupt-computer-science-and-technology-doctorate-english', 41000],
    ])
    // Bind this historical fee/language regression to its five original IDs.
    const schoolPrograms = data.programs.filter(item => expectedTuition.has(item.id))
    expect(schoolPrograms).toHaveLength(expectedTuition.size)

    for (const item of schoolPrograms) {
      expect(item.universityId).toBe('uni-beijing-university-of-posts-and-telecommunications')
      expect(item.teachingLanguages).toEqual(['English'])
      expect(item.languageRequirements).toEqual([
        { test: 'TOEFL', minimum: '80' },
        { test: 'IELTS', minimum: '6.0' },
      ])
      const cycle = data.admissionCycles.find((candidate) => candidate.programId === item.id)
      expect(cycle?.dateStatus).toBe('not-announced')
      expect(cycle?.opensOn).toBeNull()
      expect(cycle?.closesOn).toBeNull()
      expect(cycle?.tuitionCny).toBe(expectedTuition.get(item.id))
      expect(cycle?.applicationFeeCny).toBe(500)
      expect(cycle?.notes?.en).toContain('official system')
    }
  })

  it('does not mislabel cash grants or unknown BUPT benefits as tuition waivers', () => {
    for (const id of [
      'scholarship-gdufs-guangdong-government',
      'scholarship-shenzhen-university-guangdong-outstanding-2026',
      'scholarship-bupt-chinese-government',
    ]) {
      expect(data.scholarships.find((item) => item.id === id)?.coverage.tuition)
        .toBe('unknown')
    }
  })
})
