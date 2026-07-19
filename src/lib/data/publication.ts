import type { ContentStatus, DataBundle } from './types'

const PUBLIC_STATUSES = new Set<ContentStatus>(['verified', 'stale'])

export function isPublicStatus(status: ContentStatus): boolean {
  return PUBLIC_STATUSES.has(status)
}

export function selectPublishedData(data: DataBundle): DataBundle {
  const cities = data.cities.filter((item) => isPublicStatus(item.status))
  const cityIds = new Set(cities.map((item) => item.id))
  const universities = data.universities.filter((item) => isPublicStatus(item.status) && cityIds.has(item.cityId))
  const universityIds = new Set(universities.map((item) => item.id))
  const programs = data.programs.filter((item) => isPublicStatus(item.status) && universityIds.has(item.universityId))
  const programIds = new Set(programs.map((item) => item.id))
  const admissionCycles = data.admissionCycles.filter((item) => isPublicStatus(item.status) && programIds.has(item.programId))
  const scholarships = data.scholarships
    .filter((item) => isPublicStatus(item.status))
    .map((item) => ({
      ...item,
      universityIds: item.universityIds.filter((id) => universityIds.has(id)),
      programIds: item.programIds.filter((id) => programIds.has(id)),
    }))

  const sourceIds = new Set([
    ...cities.flatMap((item) => item.sourceIds),
    ...universities.flatMap((item) => item.sourceIds),
    ...programs.flatMap((item) => item.sourceIds),
    ...admissionCycles.flatMap((item) => item.sourceIds),
    ...scholarships.flatMap((item) => item.sourceIds),
  ])

  return {
    sources: data.sources.filter((source) => sourceIds.has(source.id)),
    cities,
    universities,
    programs,
    admissionCycles,
    scholarships,
  }
}
