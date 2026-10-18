import { getTodayDate, isCurrentVerifiedRecord } from './freshness'
import type { Program, ProgramDetails } from './types'

export type ProgramDisplayDetails = Partial<ProgramDetails> & Pick<ProgramDetails,
  'curriculumHighlights' | 'eligibility' | 'applicationMaterials'>

/** Show approved admissions facts even when no official curriculum was published. */
export function getProgramDisplayDetails(program: Program, today = getTodayDate()): ProgramDisplayDetails | undefined {
  if (!isCurrentVerifiedRecord(program, today) || program.verifiedAt > today || program.verificationScope === 'identity') return undefined
  if (program.details) return program.details
  const details = program.supplementaryDetails
  if (!details) return undefined
  return { ...details, curriculumHighlights: details.curriculumHighlights ?? [],
    eligibility: details.eligibility ?? [], applicationMaterials: details.applicationMaterials ?? [] }
}
