import { describe, expect, it } from 'vitest'

import { classifyProgramField } from '../../src/lib/data/fields'
import type { Program } from '../../src/lib/data/types'

function program(name: string, discipline: Program['discipline'] = 'other'): Program {
  return {
    id: `test-${name}`,
    slug: `test-${name}`,
    universityId: 'test-university',
    name: { en: name },
    degreeLevel: 'master',
    discipline,
    teachingLanguages: ['English'],
    durationMonths: null,
    durationStatus: 'not-announced',
    programUrl: 'https://example.edu.cn/program',
    applyUrl: null,
    languageRequirements: [],
    verificationScope: 'identity',
    sourceIds: ['test-source'],
    verifiedAt: '2026-08-03',
    reviewAfter: '2026-09-02',
    status: 'verified',
  } as Program
}

describe('applicant-facing program field refinement', () => {
  it.each([
    ['Chinese-English Bilingual Computer Science', 'engineering', 'computing-data'],
    ['Clinical Veterinary Medicine', 'medicine', 'agriculture-veterinary'],
    ['Food Science and Engineering', 'science', 'agriculture-veterinary'],
    ['Environmental Science and Engineering', 'science', 'environment-earth'],
    ['International Chinese Language Education', 'humanities', 'chinese-language'],
  ] as const)('classifies %s from legacy %s as %s', (name, discipline, expected) => {
    expect(classifyProgramField(program(name, discipline))).toBe(expected)
  })

  it('retains a clear clinical medicine identity in medicine and health', () => {
    expect(classifyProgramField(program('Clinical Medicine', 'medicine'))).toBe('medicine-health')
  })
})
