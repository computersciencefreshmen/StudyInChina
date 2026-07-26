import { describe, expect, test } from 'vitest'

import {
  publicationTier,
  selectBroadBatch,
} from '../../scripts/ingestion/build-international-program-review'

function candidate(
  institutionNumber: number,
  programNumber: number,
): Parameters<typeof selectBroadBatch>[0][number] {
  return {
    institutionId: `uni-${institutionNumber}`,
    institutionZh: `学校${institutionNumber}`,
    institutionEn: `University ${institutionNumber}`,
    province: 'Test',
    targetOrdinal: institutionNumber,
    programNameOriginal: `Program ${programNumber}`,
    programNameEn: `Program ${programNumber}`,
    programType: 'degree',
    degreeLevel: 'master',
    teachingLanguage: 'English',
    intake: '2027 Fall',
    applicationOpen: null,
    applicationOpenStatus: 'officially_not_announced',
    deadline: '2027-05-31',
    deadlineStatus: 'known',
    cycleStatus: 'future',
    publicationTier: 'cycle_ready',
    internationalEligibilityEvidence: 'International applicants are eligible.',
    individualApplicationEvidence: 'Applicants submit through the official portal.',
    officialUrl: `https://university-${institutionNumber}.edu/program-${programNumber}`,
    catalogUrl: `https://university-${institutionNumber}.edu/catalog`,
    checkedAt: '2026-07-26',
    evidenceStatus: 'verified',
    sourceFile: 'fixture.json',
  }
}

describe('international program review batch', () => {
  test('selects one record per institution before taking a second record', () => {
    const candidates = [1, 2, 3, 4].flatMap((institution) => (
      [1, 2, 3].map((program) => candidate(institution, program))
    ))
    const result = selectBroadBatch(candidates, 5, 3)

    expect(result.selected).toHaveLength(5)
    expect(new Set(result.selected.slice(0, 4).map(
      (record) => record.institutionId,
    )).size).toBe(4)
    expect(result.selected[4]?.institutionId).toBe('uni-1')
  })

  test('deduplicates records and enforces the per-institution cap', () => {
    const duplicate = candidate(1, 1)
    const result = selectBroadBatch([
      duplicate,
      { ...duplicate },
      candidate(1, 2),
      candidate(1, 3),
    ], 100, 2)

    expect(result.selected).toHaveLength(2)
    expect(result.exclusions.map((item) => item.reason)).toContain(
      'duplicate_program_candidate',
    )
    expect(result.exclusions.map((item) => item.reason)).toContain(
      'per_institution_cap_2',
    )
  })

  test('separates active cycles from program-identity-only records', () => {
    expect(publicationTier('future', null)).toBe('cycle_ready')
    expect(publicationTier('closed', '2026-06-01')).toBe(
      'program_identity_only',
    )
    expect(publicationTier('closed', '2027-06-01')).toBe(
      'program_identity_only',
    )
  })
})
