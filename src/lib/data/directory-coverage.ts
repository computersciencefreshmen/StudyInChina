import type { DataBundle } from './types'
import { getApplicationState } from './admission'
import { hasCurrentDirectoryField } from './discovery-state'

/** The input is the safe directory projection, never an unfiltered raw bundle. */
export function directoryCoverage(directory: DataBundle, cohortSchools: number, today: string) {
  const cycles = directory.admissionCycles.filter(cycle => ['open', 'upcoming', 'rolling'].includes(getApplicationState(cycle, today)))
  const programIds = new Set(cycles.map(cycle => cycle.programId))
  const coveredSchools = new Set(directory.programs.map(program => program.universityId))
  const opportunitySchools = new Set(directory.programs.filter(program => programIds.has(program.id)).map(program => program.universityId))
  const scholarships = directory.scholarships.filter(award => award.deadline && award.deadline >= today && award.applicationUrl
    && hasCurrentDirectoryField(award, 'deadline', today) && hasCurrentDirectoryField(award, 'applicationUrl', today))
  return {
    currentOpportunityCounts: { programs: programIds.size, admissionCycles: cycles.length, scholarships: scholarships.length },
    schoolCoverageCounts: { cohort: cohortSchools, directory: directory.universities.length,
      withDirectoryPrograms: coveredSchools.size, withCurrentOpportunities: opportunitySchools.size },
  }
}
