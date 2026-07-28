import { describe, expect, it } from 'vitest'

import {
  validateMiniMaxExpansion,
} from '../../scripts/ingestion/validate-minimax-expansion'

const task = {
  id: 'minimax-v2-programs-test',
  kind: 'programs' as const,
  schools: [{ institutionRef: 'uni-example' }],
  outputJsonPath: 'quality/minimax-expansion/inbox/minimax-v2-programs-test.json',
}

function evidence(value: unknown, quote: string) {
  return {
    status: 'known',
    value,
    officialUrl: 'https://international.example.edu.cn/admissions/programs/example',
    sourceTitle: '2027 International Student Admission Guide',
    checkedAt: '2026-07-28',
    quote,
    locator: 'Program table, row 1',
  }
}

function validProgram(key = 'computer-science') {
  return {
    institutionId: 'uni-example',
    programKey: `uni-example:program:${key}`,
    programUrl: `https://international.example.edu.cn/admissions/programs/${key}`,
    internationalEligibility: evidence(
      true,
      'Applicants must be non-Chinese citizens holding a valid foreign passport.',
    ),
    individualApplication: evidence(
      true,
      'Applicants shall submit an online application through the university portal.',
    ),
    durationMonths: evidence(48, 'The standard duration of study is four years.'),
    cycles: [{
      academicYear: '2027-2028',
      intake: 'autumn',
      publicationEligibility: 'open',
      tuitionCny: evidence(30000, 'Tuition fee: RMB 30,000 per academic year.'),
      closesOn: evidence('2027-06-30', 'Application deadline: June 30, 2027.'),
    }],
  }
}

function validHarvest() {
  return {
    format: 'studyinchina.minimax-official-harvest',
    formatVersion: 1,
    batchId: task.id,
    checkedAt: '2026-07-28',
    scope: { schoolIds: ['uni-example'] },
    programs: [validProgram()],
    scholarships: [],
    reconciliation: [{ institutionId: 'uni-example', categories: {} }],
    sourceFailures: [],
  }
}

describe('MiniMax v2 expansion validator', () => {
  it('accepts a batch that meets all core coverage gates', () => {
    const result = validateMiniMaxExpansion(task, validHarvest())
    expect(result.publishablePrograms).toBe(1)
    expect(result.durationCoverageRate).toBe(1)
    expect(result.tuitionCoverageRate).toBe(1)
    expect(result.futureDeadlineCoverageRate).toBe(1)
  })

  it('rejects a batch below the 60% duration coverage gate', () => {
    const harvest = validHarvest()
    const second = validProgram('data-science')
    second.durationMonths = {
      status: 'source_unavailable',
      value: null,
      officialUrl: '',
      sourceTitle: '',
      checkedAt: '2026-07-28',
      quote: '',
      locator: '',
    }
    harvest.programs.push(second)

    expect(() => validateMiniMaxExpansion(task, harvest))
      .toThrow(/durationCoverageRate 0.50 < 0.60/u)
  })

  it('rejects an empty scholarship task instead of marking a gap completed', () => {
    const scholarshipTask = {
      ...task,
      id: 'minimax-v2-scholarships-test',
      kind: 'scholarships' as const,
    }
    const harvest = {
      ...validHarvest(),
      batchId: scholarshipTask.id,
      programs: [],
      sourceFailures: [{
        institutionId: 'uni-example',
        category: 'scholarships',
        discoveryAttempts: [{}, {}, {}],
      }],
    }

    expect(() => validateMiniMaxExpansion(scholarshipTask, harvest))
      .toThrow(/must contain at least one verified scholarship/u)
  })
  it('rejects a non-empty scholarship that does not satisfy the evidence contract', () => {
    const scholarshipTask = {
      ...task,
      id: 'minimax-v2-scholarships-invalid',
      kind: 'scholarships' as const,
    }
    const harvest = {
      ...validHarvest(),
      batchId: scholarshipTask.id,
      programs: [],
      scholarships: [{ institutionIds: ['uni-example'] }],
    }

    expect(() => validateMiniMaxExpansion(scholarshipTask, harvest))
      .toThrow(/scholarshipKey/u)
  })
})
