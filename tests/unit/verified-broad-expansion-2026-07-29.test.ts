import { describe, expect, it } from 'vitest'
import sources from '../../content/data/sources.json'
import cities from '../../content/data/cities.json'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import scholarships from '../../content/data/scholarships.json'
import { bundleSchema } from '@/lib/data/schema'
import { selectPublishedData } from '@/lib/data/publication'

const data = bundleSchema.parse({
  sources,
  cities,
  universities,
  programs,
  admissionCycles,
  scholarships,
})
const published = selectPublishedData(data, '2026-07-29')

const priorityCoverage = new Map([
  ['uni-tsinghua-university', 42],
  ['uni-guangdong-university-of-technology', 5],
  ['uni-zhejiang-university-of-technology', 5],
  ['uni-jiangsu-university', 6],
  ['uni-guangzhou-university', 1],
  ['uni-shantou-university', 5],
  ['uni-southern-medical-university', 1],
  ['uni-shenzhen-university', 11],
  ['uni-jinan-university', 8],
])

describe('verified broad university expansion on 2026-07-29', () => {
  it('restores Tsinghua with official program-level evidence', () => {
    const tsinghuaPrograms = published.programs.filter(
      (program) => program.universityId === 'uni-tsinghua-university',
    )

    expect(tsinghuaPrograms).toHaveLength(42)
    expect(tsinghuaPrograms.find(
      (program) => program.id === 'program-tsinghua-university-computer-science-bachelor',
    )).toMatchObject({
      slug: 'tsinghua-university-computer-science-bachelor',
    })
    expect(tsinghuaPrograms.some(
      (program) => program.id === 'program-tsinghua-university-chinese-language-program-language',
    )).toBe(true)
    expect(tsinghuaPrograms.some(
      (program) => program.id === 'program-tsinghua-university-schwarzman-scholars-master-of-global-affairs-master',
    )).toBe(true)

    for (const program of tsinghuaPrograms) {
      expect(program.name.en).toBeTruthy()
      expect(program.name.zh).toBeTruthy()
      expect(program.name.ru).toBeTruthy()
      expect(program.teachingLanguages).not.toContain('To be confirmed')
      expect(data.sources.some(
        (source) => source.official
          && source.kind === 'program'
          && source.url === program.programUrl
          && program.sourceIds.includes(source.id),
      ), program.id).toBe(true)
    }
  })

  it('removes fabricated empty Tsinghua cycles and keeps the real open 2027 route', () => {
    expect(data.admissionCycles.some(
      (cycle) => cycle.id === 'cycle-2027-tsinghua-university-computer-science-bachelor',
    )).toBe(false)
    expect(data.admissionCycles.some(
      (cycle) => cycle.id === 'cycle-2027-tsinghua-university-chinese-language-program-language',
    )).toBe(false)

    const schwarzmanCycle = published.admissionCycles.find(
      (cycle) => cycle.id === 'cycle-2027-schwarzman-scholars-global',
    )
    expect(schwarzmanCycle).toMatchObject({
      academicYear: '2027-2028',
      opensOn: '2026-04-08',
      closesOn: '2026-09-09',
      dateStatus: 'published',
    })

    const schwarzmanScholarship = published.scholarships.find(
      (scholarship) => scholarship.id === 'scholarship-schwarzman-scholars-2027',
    )
    expect(schwarzmanScholarship).toMatchObject({
      deadline: '2026-09-09',
      coverage: {
        tuition: 'full',
        accommodation: 'full',
        insurance: true,
      },
    })
  })

  it('broadens verified coverage across Double First-Class and local strong universities', () => {
    expect(published.universities).toHaveLength(202)
    expect(published.programs.length).toBeGreaterThanOrEqual(404)

    for (const [universityId, minimum] of priorityCoverage) {
      const count = published.programs.filter(
        (program) => program.universityId === universityId,
      ).length
      expect(count, universityId).toBeGreaterThanOrEqual(minimum)
    }

    const counts = new Map(published.universities.map((university) => [
      university.id,
      published.programs.filter((program) => program.universityId === university.id).length,
    ]))
    const zeroProgramUniversities = [...counts.values()].filter((count) => count === 0).length
    const underThreeUniversities = [...counts.values()].filter((count) => count < 3).length

    expect(zeroProgramUniversities).toBeLessThanOrEqual(56)
    expect(underThreeUniversities).toBeLessThanOrEqual(146)
  })

  it('keeps every new priority record multilingual and tied to an exact official source', () => {
    const priorityIds = new Set(priorityCoverage.keys())
    const priorityPrograms = published.programs.filter(
      (program) => priorityIds.has(program.universityId),
    )

    for (const program of priorityPrograms) {
      expect(program.name.en, `${program.id}: en`).toBeTruthy()
      expect(program.name.zh, `${program.id}: zh`).toBeTruthy()
      expect(program.name.ru, `${program.id}: ru`).toBeTruthy()
      expect(program.name.en?.toLowerCase()).not.toContain('translation pending')
      expect(program.name.zh).not.toContain('翻译待补充')
      expect(data.sources.some(
        (source) => source.official
          && source.kind === 'program'
          && source.url === program.programUrl
          && program.sourceIds.includes(source.id),
      ), program.id).toBe(true)
    }
  })
})
