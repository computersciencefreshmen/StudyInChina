import { describe, expect, it } from 'vitest'

import {
  buildMiniMaxHarvestQueue,
} from '../../scripts/ingestion/build-minimax-harvest-queue'
import {
  validateMiniMaxHarvest,
} from '../../scripts/ingestion/validate-minimax-harvest'

const queue = buildMiniMaxHarvestQueue({
  doubleFirstClassTargets: [
    {
      targetId: 'dfc-001',
      ordinal: 1,
      officialNameZh: '甲大学',
      catalogInstitutionId: 'uni-a',
    },
    {
      targetId: 'dfc-002',
      ordinal: 2,
      officialNameZh: '某军医大学',
    },
    {
      targetId: 'dfc-003',
      ordinal: 3,
      officialNameZh: '乙大学',
    },
  ],
  regionalTargets: [
    {
      targetId: 'regional-001',
      officialNameZh: '甲大学',
      officialNameEn: 'University A',
      province: 'A',
      city: 'A',
      proposedInstitutionId: 'uni-a',
      focusTags: [],
    },
    {
      targetId: 'regional-002',
      officialNameZh: '丙大学',
      officialNameEn: 'University C',
      province: 'C',
      city: 'C',
      proposedInstitutionId: 'uni-c',
      focusTags: ['languages'],
    },
  ],
  catalogUniversities: [
    { id: 'uni-a', name: { zh: '甲大学', en: 'University A' } },
    { id: 'uni-b', name: { zh: '乙大学', en: 'University B' } },
  ],
  batchSize: 2,
  generatedAt: '2026-07-27T00:00:00.000Z',
})

describe('MiniMax continuous harvest queue', () => {
  it('excludes military schools, deduplicates cohorts, and creates two task passes', () => {
    expect(queue.summary).toEqual({
      doubleFirstClassTargets: 2,
      regionalPriorityTargets: 1,
      uniqueSchools: 3,
      schoolBatches: 2,
      tasks: 4,
    })
    expect(queue.tasks.map((task) => task.kind)).toEqual([
      'programs',
      'scholarships',
      'programs',
      'scholarships',
    ])
    expect(queue.tasks.flatMap((task) => task.schools)
      .some((school) => school.officialNameZh.includes('军医'))).toBe(false)
  })

  it('validates an assigned program batch with field evidence', () => {
    const task = queue.tasks[0]!
    const evidence = {
      status: 'known',
      value: 48,
      rawValue: '4 years',
      officialUrl: 'https://international.example.edu.cn/program',
      sourceTitle: 'International Admission Guide',
      checkedAt: '2026-07-27',
      quote: 'Duration: 4 years.',
      locator: 'Program table',
    }
    const result = validateMiniMaxHarvest(task, {
      format: 'studyinchina.minimax-official-harvest',
      formatVersion: 1,
      batchId: task.id,
      scope: { schoolIds: task.schools.map((school) => school.institutionRef) },
      programs: task.schools.map((school, index) => ({
        institutionId: school.institutionRef,
        programKey: `${school.institutionRef}:program:${index}`,
        programUrl: 'https://international.example.edu.cn/program',
        durationMonths: evidence,
      })),
      scholarships: [],
      reconciliation: task.schools.map((school) => ({
        institutionId: school.institutionRef,
        categories: {},
      })),
      sourceFailures: [],
    })
    expect(result).toEqual({ programs: 2, scholarships: 0, sourceFailures: 0 })
  })

  it('rejects an empty scholarship task', () => {
    const task = queue.tasks[1]!
    expect(() => validateMiniMaxHarvest(task, {
      format: 'studyinchina.minimax-official-harvest',
      formatVersion: 1,
      batchId: task.id,
      scope: { schoolIds: task.schools.map((school) => school.institutionRef) },
      programs: [],
      scholarships: [],
      reconciliation: task.schools.map((school) => ({
        institutionId: school.institutionRef,
        categories: {},
      })),
      sourceFailures: [],
    })).toThrow('cannot complete with zero scholarship identities')
  })
})
