import type { DataBundle } from './types'

export function getDataReleaseDate(data: DataBundle): string {
  const auditDates = [
    ...data.sources.map((source) => source.accessedAt),
    ...data.cities.map((city) => city.verifiedAt),
    ...data.universities.map((university) => university.verifiedAt),
    ...data.programs.map((program) => program.verifiedAt),
    ...data.admissionCycles.map((cycle) => cycle.verifiedAt),
    ...data.scholarships.map((scholarship) => scholarship.verifiedAt),
  ]

  return auditDates.sort().at(-1) ?? '1970-01-01'
}
