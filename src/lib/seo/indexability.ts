import { selectAdmissionCycle } from '@/lib/data/admission'
import { isPublicStatus } from '@/lib/data/publication'
import type {
  AdmissionCycle,
  City,
  Program,
  Scholarship,
  University,
} from '@/lib/data/types'

/**
 * Public access and search-engine indexing are separate decisions.
 * Identity-only program records stay reachable for official-source discovery,
 * but are indexed only after the page has enough verified decision context.
 */
export function isIndexableProgram(
  program: Program,
  admissionCycles: AdmissionCycle[],
  today: string,
): boolean {
  const cycle = selectAdmissionCycle(admissionCycles, program.id, today)

  return program.status === 'verified'
    && program.verificationScope !== 'identity'
    && Boolean(program.details)
    && Boolean(cycle)
    && program.durationMonths !== null
    && program.teachingLanguages.length > 0
    && Boolean(program.applyUrl)
}

export function isIndexableScholarship(scholarship: Scholarship): boolean {
  const hasFundingFact = scholarship.coverage.tuition !== 'unknown'
    || scholarship.coverage.accommodation !== 'unknown'
    || scholarship.coverage.insurance !== 'unknown'
    || scholarship.coverage.stipendCnyPerMonth !== null

  return scholarship.status === 'verified'
    && Boolean(scholarship.summary)
    && Boolean(scholarship.applicationUrl)
    && (Boolean(scholarship.deadline) || hasFundingFact)
}

export function isIndexableCity(city: City, universities: University[]): boolean {
  return isPublicStatus(city.status)
    && Boolean(city.overview)
    && Boolean(city.coordinates)
    && universities.some((university) => university.cityId === city.id)
}
