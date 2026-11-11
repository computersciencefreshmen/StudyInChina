import { getTodayDate, isCurrentVerifiedRecord } from './freshness'
import { hasCurrentDirectoryField } from './discovery-state'
import type { AdmissionCycle, Program, ProgramDetails } from './types'

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

/** A selected annual track supplies its own conditions; global siblings cannot fill its gaps. */
export function getProgramCycleDisplayDetails(program: Program, cycle: AdmissionCycle | undefined, today = getTodayDate(), hasScopedCycles = false): ProgramDisplayDetails | undefined {
  const details = getProgramDisplayDetails(program, today)
  if (!details) return undefined
  if (!hasScopedCycles && !cycle?.teachingLanguage && !cycle?.applicationRound && program.teachingLanguages.length <= 1) return details
  return { ...details, eligibility: cycle && hasCurrentDirectoryField(cycle, 'eligibility', today) ? cycle.eligibility ?? [] : [],
    applicationMaterials: cycle && hasCurrentDirectoryField(cycle, 'applicationMaterials', today) ? cycle.applicationMaterials ?? [] : [], languagePolicy: undefined }
}
