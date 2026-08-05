import { describe, expect, it } from 'vitest'

import {
  validateMiniMaxRecapture,
} from '../../scripts/ingestion/validate-minimax-recapture'

const task = {
  id: 'minimax-v3-programs-001',
  kind: 'programs' as const,
  schools: [{ institutionRef: 'uni-example' }],
  outputJsonPath: 'quality/minimax-recapture/inbox/minimax-v3-programs-001.json',
}

function evidence(value: unknown, quote: string) {
  return {
    status: 'known',
    value,
    officialUrl: 'https://international.example.edu.cn/admissions/programs/example',
    sourceTitle: '2027 International Student Admission Guide',
    checkedAt: '2026-07-27',
    quote,
    locator: 'Program table, row 1',
  }
}

function validProgram() {
  return {
    institutionId: 'uni-example',
    programKey: 'uni-example:program:computer-science',
    programUrl: 'https://international.example.edu.cn/admissions/programs/computer-science',
    rawSnapshotHash: 'sha256:official-snapshot',
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
    checkedAt: '2026-07-27',
    collector: {
      agent: 'MiniMax Coding Plan',
      model: 'MiniMax-M2.7',
      officialSourcesOnly: true,
    },
    scope: { schoolIds: ['uni-example'] },
    programs: [validProgram()],
    scholarships: [],
    reconciliation: [{ institutionId: 'uni-example', categories: {} }],
    sourceFailures: [],
  }
}

describe('MiniMax v3 recapture validator', () => {
  it('accepts a source-backed program with complete core facts', () => {
    const result = validateMiniMaxRecapture(task, validHarvest())

    expect(result.publishablePrograms).toBe(1)
    expect(result.durationCoverageRate).toBe(1)
    expect(result.tuitionCoverageRate).toBe(1)
    expect(result.futureDeadlineCoverageRate).toBe(1)
    expect(result.missingSnapshotEvidenceCount).toBe(0)
  })

  it('rejects generated eligibility evidence templates', () => {
    const harvest = validHarvest()
    harvest.programs[0]!.internationalEligibility.quote =
      'The official program page identifies this program as open to non-Chinese citizens.'

    expect(() => validateMiniMaxRecapture(task, harvest))
      .toThrow(/generated evidence template/u)
  })

  it('rejects known evidence without a raw snapshot reference', () => {
    const harvest = validHarvest()
    Reflect.deleteProperty(harvest.programs[0]!, 'rawSnapshotHash')

    expect(() => validateMiniMaxRecapture(task, harvest))
      .toThrow(/rawSnapshotPath or rawSnapshotHash/u)
  })

  it('rejects an empty scholarship task even when failures are documented', () => {
    const scholarshipTask = {
      ...task,
      id: 'minimax-v3-scholarships-001',
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

    expect(() => validateMiniMaxRecapture(scholarshipTask, harvest))
      .toThrow(/must contain at least one verified scholarship/u)
  })

  it('enforces the duration coverage threshold', () => {
    const harvest = validHarvest()
    const second = validProgram()
    second.programKey = 'uni-example:program:data-science'
    second.durationMonths = {
      status: 'source_unavailable',
      value: null,
      officialUrl: '',
      sourceTitle: '',
      checkedAt: '2026-07-27',
      quote: '',
      locator: '',
    }
    harvest.programs.push(second)

    expect(() => validateMiniMaxRecapture(task, harvest))
      .toThrow(/durationCoverageRate 0.50 < 0.60/u)
  })
})
