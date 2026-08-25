import { describe, expect, it } from 'vitest'
import { scholarshipAppliesToProgram } from '@/lib/data/scholarship-scope'

const program = { id: 'program-target', universityId: 'university-one' }

describe('scholarshipAppliesToProgram', () => {
  it('matches an explicitly listed program', () => {
    expect(scholarshipAppliesToProgram({
      programIds: ['program-target'],
      universityIds: ['university-one'],
    }, program)).toBe(true)
  })

  it('does not expand an explicit program subset to sibling programs', () => {
    expect(scholarshipAppliesToProgram({
      programIds: ['program-other'],
      universityIds: ['university-one'],
    }, program)).toBe(false)
  })

  it('does not treat university-only legacy attribution as program applicability', () => {
    expect(scholarshipAppliesToProgram({
      programIds: [],
      universityIds: ['university-one'],
    }, program)).toBe(false)
  })

  it('does not treat an unscoped legacy identity as globally applicable', () => {
    expect(scholarshipAppliesToProgram({
      programIds: [],
      universityIds: [],
    }, program)).toBe(false)
  })
})
