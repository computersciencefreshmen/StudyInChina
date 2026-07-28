import { describe, expect, it } from 'vitest'

import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import { buildCurrentProgramReview } from '../../scripts/ingestion/build-current-program-review'
import { bundleSchema } from '@/lib/data/schema'

const bundle = bundleSchema.parse({
  sources,
  cities,
  universities,
  programs,
  admissionCycles,
  scholarships,
})

describe('current program review builder', () => {
  it('registers every current verified or stale program for automatic refresh', () => {
    const review = buildCurrentProgramReview(bundle, '2026-07-28T00:00:00.000Z')
    const expectedPrograms = bundle.programs.filter(
      (program) => program.status === 'verified' || program.status === 'stale',
    )

    expect(review.source).toBe('current-catalog')
    expect(review.records).toHaveLength(expectedPrograms.length)
    expect(review.summary.programs).toBe(expectedPrograms.length)
    expect(review.summary.officialUrls).toBe(
      new Set(expectedPrograms.map((program) => program.programUrl)).size,
    )
    expect(review.summary.institutions).toBe(
      new Set(expectedPrograms.map((program) => program.universityId)).size,
    )
  })

  it('carries the latest known cycle dates without inventing missing values', () => {
    const review = buildCurrentProgramReview(bundle, '2026-07-28T00:00:00.000Z')
    const xmu = review.records.find(
      (record) => record.programNameEn
        === 'Long-Term Chinese Language Program — Spring 2027',
    )
    expect(xmu).toMatchObject({
      institutionId: 'uni-xiamen-university',
      intake: 'spring',
      applicationOpen: null,
      deadline: '2026-12-30',
      officialUrl: 'https://oec.xmu.edu.cn/en/Program1/Chinese_Language_Programs.htm',
    })

    const identityOnly = review.records.find(
      (record) => record.institutionId === 'uni-anhui-university'
        && record.programNameEn === 'Computer Science and Technology',
    )
    expect(identityOnly?.applicationOpen).toBeNull()
    expect(identityOnly?.deadline).toBeNull()
  })
})
