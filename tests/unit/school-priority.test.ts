import { describe, expect, it } from 'vitest'
import { orderSchoolExpansionCandidates } from '../../workers/catalog-maintenance/src/school-priority'
import priority from '../../content/maintenance/expansion-priority.v1.json'

const schools = Array.from({ length: 272 }, (_, index) => ({ university_id: `uni-${String(index).padStart(3, '0')}`, last_attempt_at: null as string | null }))
const scope = 'a'.repeat(64)
const hint = () => ({ format: 'studyinchina.school-expansion-priority', version: 1, evaluatedForDate: '2026-10-25', scopeRegistrySha256: scope,
  inputCatalogSha256: 'b'.repeat(64), universityIds: schools.map(row => row.university_id).reverse() })

describe('fixed-cohort school expansion priority hints', () => {
  it('uses all 272 priority positions without changing school rows or requiring a fresh catalogue digest', () => {
    const before = structuredClone(schools), sorted = orderSchoolExpansionCandidates(schools, scope, hint())
    expect(sorted.map(row => row.university_id)).toEqual(hint().universityIds)
    expect(schools).toEqual(before)
    const bundled = priority.universityIds.map(university_id => ({ university_id, last_attempt_at: null }))
    expect(orderSchoolExpansionCandidates([...bundled].reverse(), priority.scopeRegistrySha256).map(row => row.university_id)).toEqual(priority.universityIds)
  })
  it('preserves the original SQL order for a foreign scope, duplicate/noncohort ID, incomplete cohort or malformed date', () => {
    const foreign = { ...hint(), scopeRegistrySha256: 'c'.repeat(64) }, duplicate = hint(), outside = hint()
    duplicate.universityIds[0] = duplicate.universityIds[1]; outside.universityIds[0] = 'uni-not-in-this-cohort'
    for (const value of [foreign, duplicate, outside, { ...hint(), evaluatedForDate: '2026-02-30' }]) expect(orderSchoolExpansionCandidates(schools, scope, value)).toEqual(schools)
    expect(orderSchoolExpansionCandidates(schools.slice(0, 271), scope, hint())).toEqual(schools.slice(0, 271))
  })
  it('places previously attempted schools after unattempted schools even when the hint ranks them first', () => {
    const rows = structuredClone(schools), firstPriority = hint().universityIds[0]
    rows.find(row => row.university_id === firstPriority)!.last_attempt_at = '2026-10-24T00:00:00.000Z'
    const sorted = orderSchoolExpansionCandidates(rows, scope, hint())
    expect(sorted.at(-1)!.university_id).toBe(firstPriority)
    expect(sorted[0].university_id).toBe(hint().universityIds[1])
    expect(sorted).toHaveLength(272)
  })
})
