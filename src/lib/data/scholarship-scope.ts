import type { Program, Scholarship } from './types'

type LegacyScholarshipScope = Pick<Scholarship, 'programIds' | 'universityIds'>
type ProgramScopeTarget = Pick<Program, 'id' | 'universityId'>

/**
 * Returns whether a legacy Scholarship identity is explicitly linked to a
 * program.
 *
 * `universityIds` is institutional attribution in the legacy schema. It does
 * not prove that an award applies to every program at that institution. The
 * normalized ScholarshipCycle model has separate institution/program/degree
 * scopes and is evaluated independently by the D1 catalog API.
 */
export function scholarshipAppliesToProgram(
  scholarship: LegacyScholarshipScope,
  program: ProgramScopeTarget,
): boolean {
  return scholarship.programIds.includes(program.id)
}
