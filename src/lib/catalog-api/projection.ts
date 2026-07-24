import {
  isCurrentVerifiedRecord,
  isWithinPostDeadlineGrace,
  withRuntimeFreshness,
} from '@/lib/data/freshness'
import { isPublicStatus } from '@/lib/data/publication'
import type { DataBundle } from '@/lib/data/types'

/**
 * Legacy JSON has record-level gates. Convert it to the v1 identity projection:
 * confirmed identities remain available when stale, while draft/archived
 * templates remain private. CatalogApiService performs field-level masking.
 */
export function selectCatalogApiData(data: DataBundle, today: string): DataBundle {
  const cities = data.cities
    .filter((item) => isPublicStatus(item.status))
    .map((item) => withRuntimeFreshness(item, today))
  const cityIds = new Set(cities.map((item) => item.id))
  const universities = data.universities
    .filter((item) => isPublicStatus(item.status) && cityIds.has(item.cityId))
    .map((item) => withRuntimeFreshness(item, today))
  const universityIds = new Set(universities.map((item) => item.id))
  const programs = data.programs
    .filter((item) => isPublicStatus(item.status) && universityIds.has(item.universityId))
    .map((item) => withRuntimeFreshness(item, today))
  const programIds = new Set(programs.map((item) => item.id))
  const admissionCycles = data.admissionCycles
    .filter((item) => isPublicStatus(item.status)
      && item.dateStatus !== 'previous-cycle-reference'
      && (!isCurrentVerifiedRecord(item, today)
        || item.dateStatus === 'rolling'
        || isWithinPostDeadlineGrace(item.closesOn, today))
      && programIds.has(item.programId))
    .map((item) => withRuntimeFreshness(item, today))
  const scholarships = data.scholarships
    .filter((item) => isPublicStatus(item.status))
    .map((item) => withRuntimeFreshness(item, today))

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
