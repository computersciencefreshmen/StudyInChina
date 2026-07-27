import { describe, expect, test } from 'vitest'

import {
  admissionCycleSchema,
  programSchema,
} from '@/lib/data/schema'

describe('identity-scoped catalog facts', () => {
  test('accepts an officially verified program identity without guessing details', () => {
    const result = programSchema.parse({
      id: 'program-example-computer-science',
      slug: 'example-computer-science',
      universityId: 'uni-example',
      name: {
        en: 'Computer Science and Technology',
        zh: '计算机科学与技术',
        ru: 'Информатика и технологии',
      },
      degreeLevel: 'bachelor',
      discipline: 'engineering',
      teachingLanguages: ['English'],
      durationMonths: null,
      programUrl: 'https://international.example.edu.cn/programs/cs',
      applyUrl: null,
      languageRequirements: [],
      verificationScope: 'identity',
      sourceIds: ['src-example-cs'],
      verifiedAt: '2026-07-27',
      reviewAfter: '2026-08-26',
      status: 'verified',
    })

    expect(result.verificationScope).toBe('identity')
    expect(result.durationMonths).toBeNull()
    expect(result.details).toBeUndefined()
  })

  test('accepts official application dates while leaving unannounced fees null', () => {
    const result = admissionCycleSchema.parse({
      id: 'cycle-example-cs-2027',
      programId: 'program-example-computer-science',
      academicYear: '2026-2027',
      intake: 'spring',
      opensOn: '2026-10-15',
      closesOn: '2026-11-15',
      dateStatus: 'published',
      tuitionCny: null,
      tuitionPeriod: null,
      tuitionStatus: null,
      evidenceBasis: 'cycle-specific',
      factScope: 'dates-only',
      applicationFeeCny: null,
      sourceIds: ['src-example-cs'],
      verifiedAt: '2026-07-27',
      reviewAfter: '2026-08-03',
      status: 'verified',
    })

    expect(result.factScope).toBe('dates-only')
    expect(result.closesOn).toBe('2026-11-15')
    expect(result.tuitionCny).toBeNull()
  })
})
