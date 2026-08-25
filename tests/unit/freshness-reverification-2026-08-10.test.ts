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
const programById = new Map(data.programs.map((record) => [record.id, record]))
const cycleById = new Map(data.admissionCycles.map((record) => [record.id, record]))
const scholarshipById = new Map(data.scholarships.map((record) => [record.id, record]))
const sourceById = new Map(data.sources.map((record) => [record.id, record]))

describe('2026-08-10 freshness evidence after safe expiry rollover', () => {
  it('records a live check for every accepted official source', () => {
    const sourceIds = [
      'src-gov-clec',
      'src-program-review-88495cf206e1',
      'src-thu-graduate-programs-in-english-current',
      'src-schwarzman-program-current',
      'src-schwarzman-application-2027',
      'src-gap-program-mve-jzh-suda-long-chinese-year',
      'src-gap-program-mve-jzh-suda-long-chinese-semester',
      'src-gap-program-mve-jzh-zust-iclt-semester',
      'src-gap-program-mve-jzh-zust-iclt-master',
      'src-gap-scholarship-mve-jzh-suda-iclt-scholarship',
      'src-gap-scholarship-mew-csw-scau-guangdong-government-scholarship-2026',
      'src-gap-scholarship-mve-jzh-zust-iclt-scholarship',
    ]

    for (const sourceId of sourceIds) {
      const source = sourceById.get(sourceId)
      expect(source, sourceId).toBeDefined()
      expect(source?.official, sourceId).toBe(true)
      expect(source?.url.startsWith('https://'), sourceId).toBe(true)
      expect(source?.accessedAt, sourceId).toBe(TODAY)
    }
  })

  it('keeps Schwarzman dates and requirements exact without making the video mandatory', () => {
    const program = programById.get('program-tsinghua-university-schwarzman-scholars-master-of-global-affairs-master')
    const cycle = cycleById.get('cycle-2027-schwarzman-scholars-global')
    const scholarship = scholarshipById.get('scholarship-schwarzman-scholars-2027')

    expect(cycle).toMatchObject({
      opensOn: '2026-04-08',
      closesOn: '2026-09-09',
      verifiedAt: TODAY,
      reviewAfter: '2026-08-13',
      status: 'stale',
    })
    expect(scholarship).toMatchObject({
      deadline: '2026-09-09',
      verifiedAt: TODAY,
      reviewAfter: '2026-08-13',
      status: 'stale',
    })
    expect(program?.languageRequirements[0]?.minimum).toContain('IELTS 7')
    expect(program?.details?.applicationMaterials[1]?.en).toContain('not required')
    expect(program?.details?.applicationMaterials[1]?.en).not.toContain('required video')
  })

  it('retains Soochow facts while safely downgrading evidence after review expiry', () => {
    for (const id of [
      'cycle-gap-mve-jzh-suda-long-chinese-year-2026-2027-autumn',
      'cycle-gap-mve-jzh-suda-long-chinese-semester-2026-2027-autumn',
    ]) {
      expect(cycleById.get(id)).toMatchObject({
        applicationFeeCny: 500,
        factScope: 'complete',
        verifiedAt: TODAY,
        reviewAfter: '2026-08-17',
        status: 'stale',
      })
    }

    expect(cycleById.get('cycle-2026-a6e5661b86ff')).toMatchObject({
      closesOn: '2026-10-31',
      status: 'stale',
      verifiedAt: TODAY,
      reviewAfter: '2026-08-17',
    })

    const scholarship = scholarshipById.get('sch-gap-mve-jzh-suda-iclt-scholarship')
    expect(scholarship).toMatchObject({
      deadline: '2026-10-31',
      verifiedAt: TODAY,
      reviewAfter: '2026-08-17',
      status: 'stale',
    })
    expect(scholarship?.programIds).toContain('program-soochow-university-international-chinese-language-teachers-scholarship-o')
    expect(scholarship?.sourceIds).toContain('src-gov-clec')
    expect(scholarship?.coverage).toMatchObject({ tuition: 'full', accommodation: 'full', insurance: true })
  })

  it('retains directly supported SCAU and ZUST facts with expired evidence marked stale', () => {
    const scau = scholarshipById.get('sch-gap-mew-csw-scau-guangdong-government-scholarship-2026')
    expect(scau).toMatchObject({
      deadline: '2026-09-01',
      verifiedAt: TODAY,
      reviewAfter: '2026-08-13',
      status: 'stale',
    })
    expect(scau?.summary?.en).toContain('CNY 30,000')

    const zustScholarship = scholarshipById.get('sch-gap-mve-jzh-zust-iclt-scholarship')
    expect(zustScholarship).toMatchObject({
      deadline: '2026-10-31',
      verifiedAt: TODAY,
      reviewAfter: '2026-08-17',
      status: 'stale',
    })
    expect(zustScholarship?.coverage).toMatchObject({ tuition: 'full', accommodation: 'full', insurance: true })
    expect(programById.get('prog-gap-mve-jzh-zust-iclt-master')?.languageRequirements[0]?.minimum).toContain('HSKK Intermediate: 60')
    expect(programById.get('prog-gap-mve-jzh-zust-iclt-semester')?.languageRequirements[0]?.minimum).toContain('HSK Level 3: 180')
  })
})
