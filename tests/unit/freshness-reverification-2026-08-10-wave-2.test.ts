import { describe, expect, it } from 'vitest'

import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import { bundleSchema } from '../../src/lib/data/schema'

const TODAY = '2026-08-10'
const data = bundleSchema.parse({ admissionCycles, cities, programs, scholarships, sources, universities })
const cycleById = new Map(data.admissionCycles.map((record) => [record.id, record]))
const scholarshipById = new Map(data.scholarships.map((record) => [record.id, record]))
const sourceById = new Map(data.sources.map((record) => [record.id, record]))

describe('2026-08-10 freshness reverification wave 2', () => {
  it('records a live check for every accepted official HTTPS source', () => {
    const sourceIds = [
      'src-wku-international-admissions-2027',
      'src-shnu-iclt-2026',
      'src-gap-scholarship-pku-depth-international-chinese-language-teachers-scholarship',
      'src-gap-scholarship-pku-depth-international-chinese-language-teachers-scholarship-support-1',
      'src-gap-scholarship-sch-sisu-iclt-2026',
      'src-gap-scholarship-sch-mew-nss-synu-iclts',
      'src-gap-scholarship-mew-scws-hainnu-iclt-scholarship-2026',
    ]

    for (const sourceId of sourceIds) {
      const source = sourceById.get(sourceId)
      expect(source, sourceId).toBeDefined()
      expect(source?.official, sourceId).toBe(true)
      expect(source?.url.startsWith('https://'), sourceId).toBe(true)
      expect(source?.accessedAt, sourceId).toBe(TODAY)
    }
  })

  it('reverifies five WKU spring-transfer cycles without widening their scope', () => {
    const cycleIds = [
      'cycle-2027-wenzhou-kean-university-finance-bs-spring-transfer',
      'cycle-2027-wenzhou-kean-university-global-business-bs-spring-transfer',
      'cycle-2027-wenzhou-kean-university-computer-science-bs-spring-transfer',
      'cycle-2027-wenzhou-kean-university-biology-cell-molecular-bs-spring-transfer',
      'cycle-2027-wenzhou-kean-university-architecture-bfa-spring-transfer',
    ]

    for (const cycleId of cycleIds) {
      expect(cycleById.get(cycleId), cycleId).toMatchObject({
        academicYear: '2026-2027',
        intake: 'spring',
        closesOn: '2026-11-01',
        tuitionCny: 68000,
        tuitionPeriod: 'academic-year',
        applicationFeeCny: 400,
        factScope: 'complete',
        verifiedAt: TODAY,
        reviewAfter: '2026-08-17',
        status: 'verified',
      })
      expect(cycleById.get(cycleId)?.notes?.en).toContain('transfer students only')
    }
  })

  it('reverifies the SHNU spring scholarship route as dates-only', () => {
    expect(cycleById.get('cycle-2027-shnu-iclt-one-semester-spring')).toMatchObject({
      academicYear: '2026-2027',
      intake: 'spring',
      closesOn: '2026-10-31',
      factScope: 'dates-only',
      verifiedAt: TODAY,
      reviewAfter: '2026-08-17',
      status: 'verified',
    })
  })

  it('reverifies four scholarship deadlines while preserving unsupported unknowns', () => {
    expect(scholarshipById.get('sch-gap-pku-depth-international-chinese-language-teachers-scholarship')).toMatchObject({
      deadline: '2026-10-31',
      coverage: { tuition: 'full', accommodation: 'full', insurance: true },
      verifiedAt: TODAY,
      reviewAfter: '2026-08-17',
      status: 'verified',
    })
    expect(scholarshipById.get('sch-gap-sch-sisu-iclt-2026')).toMatchObject({
      deadline: '2026-10-31',
      coverage: { tuition: 'full', accommodation: 'full', insurance: true },
      verifiedAt: TODAY,
      reviewAfter: '2026-08-17',
      status: 'verified',
    })
    expect(scholarshipById.get('sch-gap-sch-mew-nss-synu-iclts')).toMatchObject({
      deadline: '2026-09-15',
      coverage: { tuition: 'full', accommodation: 'full', insurance: true },
      verifiedAt: TODAY,
      reviewAfter: '2026-08-13',
      status: 'verified',
    })
    expect(scholarshipById.get('sch-gap-mew-scws-hainnu-iclt-scholarship-2026')).toMatchObject({
      deadline: '2026-10-31',
      coverage: { tuition: 'unknown', accommodation: 'unknown', insurance: 'unknown' },
      verifiedAt: TODAY,
      reviewAfter: '2026-08-17',
      status: 'verified',
    })
  })
})
