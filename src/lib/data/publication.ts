import { getTodayDate, isCurrentVerifiedRecord, withRuntimeFreshness } from './freshness'
import type { ContentStatus, DataBundle } from './types'

const PROFILE_STATUSES = new Set<ContentStatus>(['verified', 'stale'])

export function isPublicStatus(status: ContentStatus): boolean {
  return PROFILE_STATUSES.has(status)
}

export function selectPublishedData(data: DataBundle, today = getTodayDate()): DataBundle {
  const cities = data.cities
    .filter((item) => isPublicStatus(item.status))
    .map((item) => withRuntimeFreshness(item, today))
  const cityIds = new Set(cities.map((item) => item.id))
  const universities = data.universities
    .filter((item) => isPublicStatus(item.status) && cityIds.has(item.cityId))
    .map((item) => withRuntimeFreshness(item, today))
  const universityIds = new Set(universities.map((item) => item.id))
  const programs = data.programs.filter((item) => isCurrentVerifiedRecord(item, today) && universityIds.has(item.universityId))
  const programIds = new Set(programs.map((item) => item.id))
  const admissionCycles = data.admissionCycles.filter((item) => isCurrentVerifiedRecord(item, today) && programIds.has(item.programId))
  const scholarships = data.scholarships
    .filter((item) => isCurrentVerifiedRecord(item, today))
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
