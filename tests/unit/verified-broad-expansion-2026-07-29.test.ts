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
const published = selectPublishedData(data, '2026-10-19')
const auditedPrograms = data.programs.filter(
  (program) => program.status === 'verified' || program.status === 'stale',
)

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
    const tsinghuaPrograms = auditedPrograms.filter(
      (program) => program.universityId === 'uni-tsinghua-university',
    )

    expect(tsinghuaPrograms.length).toBeGreaterThanOrEqual(42)
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
      if (program.name.ru !== undefined) expect(program.name.ru.trim()).not.toBe('')
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

    const schwarzmanCycle = data.admissionCycles.find(
      (cycle) => cycle.id === 'cycle-2027-schwarzman-scholars-global',
    )
    expect(schwarzmanCycle).toMatchObject({
      academicYear: '2027-2028',
      opensOn: '2026-04-08',
      closesOn: '2026-09-09',
      dateStatus: 'published',
      status: 'stale',
    })
    expect(published.admissionCycles.some(
      (cycle) => cycle.id === 'cycle-2027-schwarzman-scholars-global',
    )).toBe(false)

    const schwarzmanScholarship = data.scholarships.find(
      (scholarship) => scholarship.id === 'scholarship-schwarzman-scholars-2027',
    )
    expect(schwarzmanScholarship).toMatchObject({
      deadline: '2026-09-09',
      status: 'stale',
      coverage: {
        tuition: 'full',
        accommodation: 'full',
        insurance: true,
      },
    })
  })

  it('retains broad historical inventory while quarantining the stale scholarship', () => {
    const sourceScholarship = data.scholarships.find(
      (scholarship) => scholarship.id === 'scholarship-schwarzman-scholars-2027',
    )
    const publishedScholarship = published.scholarships.find(
      (scholarship) => scholarship.id === 'scholarship-schwarzman-scholars-2027',
    )
    expect(sourceScholarship).toBeDefined()
    expect(sourceScholarship?.status).toBe('stale')
    expect(publishedScholarship).toBeUndefined()
    expect(published.universities.length).toBeGreaterThanOrEqual(200)
    expect(published.programs.length).toBeGreaterThanOrEqual(400)

    for (const [universityId, minimum] of priorityCoverage) {
      const count = auditedPrograms.filter(
        (program) => program.universityId === universityId,
      ).length
      expect(count, universityId).toBeGreaterThanOrEqual(minimum)
    }

    const counts = new Map(published.universities.map((university) => [
      university.id,
      auditedPrograms.filter((program) => program.universityId === university.id).length,
    ]))
    const zeroProgramUniversities = [...counts.values()].filter((count) => count === 0).length
    const underThreeUniversities = [...counts.values()].filter((count) => count < 3).length

    expect(zeroProgramUniversities).toBe(0)
    expect(underThreeUniversities).toBeLessThanOrEqual(146)
  })

  it('keeps historical priority fact records multilingual and tied to an exact official source', () => {
    const priorityIds = new Set(priorityCoverage.keys())
    const priorityPrograms = auditedPrograms.filter(
      // Later directory identities retain only names actually supplied by the
      // official source; this historical bilingual fact batch has a different
      // contract and must not force invented translations into new identities.
      (program) => priorityIds.has(program.universityId) && program.verificationScope !== 'identity',
    )

    for (const program of priorityPrograms) {
      expect(program.name.en, `${program.id}: en`).toBeTruthy()
      expect(program.name.zh, `${program.id}: zh`).toBeTruthy()
      if (program.name.ru !== undefined) expect(program.name.ru.trim(), `${program.id}: ru`).not.toBe('')
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

  it('allows source-language-only directory identities with exact official entry points', () => {
    const identities = data.programs.filter((program) => program.verificationScope === 'identity')
    expect(identities.length).toBeGreaterThan(0)
    for (const program of identities) {
      expect(Object.values(program.name).some((name) => Boolean(name?.trim())), program.id).toBe(true)
      expect(Object.values(program.name).join(' '), program.id).not.toMatch(/translation pending|翻译待补充/iu)
      expect(data.sources.some((source) => source.official && source.url === program.programUrl
        && program.sourceIds.includes(source.id)), program.id).toBe(true)
    }
  })
})
