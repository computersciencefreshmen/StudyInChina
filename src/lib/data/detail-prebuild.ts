import { getApplicationState, selectAdmissionCycle } from './admission'
import type { DataBundle } from './types'

export const DETAIL_PREBUILD_LIMITS = {
  universities: 120,
  programs: 120,
  scholarships: 60,
  cities: 30,
} as const

type Slugged = { slug: string }

function rankedSlugs<T extends Slugged>(
  items: T[],
  score: (item: T) => number,
  limit: number,
): string[] {
  return [...items]
    .sort((left, right) => score(right) - score(left) || left.slug.localeCompare(right.slug))
    .slice(0, Math.max(0, limit))
    .map((item) => item.slug)
}

export function selectProgramPrebuildSlugs(
  data: DataBundle,
  today: string,
  limit: number = DETAIL_PREBUILD_LIMITS.programs,
): string[] {
  return rankedSlugs(data.programs, (program) => {
    const cycle = selectAdmissionCycle(data.admissionCycles, program.id, today)
    const applicationState = getApplicationState(cycle, today)
    const cycleScore = {
      open: 10,
      rolling: 9,
      upcoming: 8,
      'dates-published': 6,
      'not-announced': 2,
      closed: 1,
      'previous-cycle': 0,
    }[applicationState]

    return cycleScore
      + (program.status === 'verified' ? 8 : 0)
      + (program.details ? 6 : 0)
      + (program.durationMonths !== null ? 3 : 0)
      + (program.applyUrl ? 3 : 0)
      + (program.teachingLanguages.length > 0 ? 2 : 0)
      + (program.languageRequirements.length > 0 ? 2 : 0)
      + (cycle?.tuitionCny != null ? 1 : 0)
  }, limit)
}

export function selectScholarshipPrebuildSlugs(
  data: DataBundle,
  today: string,
  limit: number = DETAIL_PREBUILD_LIMITS.scholarships,
): string[] {
  return rankedSlugs(data.scholarships, (scholarship) => (
    (scholarship.status === 'verified' ? 8 : 0)
    + (scholarship.deadline && scholarship.deadline >= today ? 8 : 0)
    + (scholarship.applicationUrl ? 4 : 0)
    + (scholarship.summary ? 3 : 0)
    + (scholarship.universityIds.length > 0 ? 2 : 0)
    + (scholarship.coverage.tuition !== 'unknown' ? 1 : 0)
    + (scholarship.coverage.accommodation !== 'unknown' ? 1 : 0)
  ), limit)
}

export function selectUniversityPrebuildSlugs(
  data: DataBundle,
  limit: number = DETAIL_PREBUILD_LIMITS.universities,
): string[] {
  const programCounts = new Map<string, number>()
  const scholarshipCounts = new Map<string, number>()
  for (const program of data.programs) {
    programCounts.set(program.universityId, (programCounts.get(program.universityId) ?? 0) + 1)
  }
  for (const scholarship of data.scholarships) {
    for (const universityId of scholarship.universityIds) {
      scholarshipCounts.set(universityId, (scholarshipCounts.get(universityId) ?? 0) + 1)
    }
  }

  return rankedSlugs(data.universities, (university) => (
    (university.status === 'verified' ? 8 : 0)
    + (university.featured ? 8 : 0)
    + Math.min(programCounts.get(university.id) ?? 0, 5)
    + Math.min(scholarshipCounts.get(university.id) ?? 0, 3)
    + (university.admissionsUrl ? 3 : 0)
    + (university.summary ? 2 : 0)
  ), limit)
}

export function selectCityPrebuildSlugs(
  data: DataBundle,
  limit: number = DETAIL_PREBUILD_LIMITS.cities,
): string[] {
  const universityCounts = new Map<string, number>()
  for (const university of data.universities) {
    universityCounts.set(university.cityId, (universityCounts.get(university.cityId) ?? 0) + 1)
  }

  return rankedSlugs(data.cities, (city) => (
    (city.status === 'verified' ? 6 : 0)
    + (city.coordinates ? 5 : 0)
    + Math.min(universityCounts.get(city.id) ?? 0, 8)
    + (city.overview ? 2 : 0)
  ), limit)
}
