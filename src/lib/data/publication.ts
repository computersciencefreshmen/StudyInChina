import {
  getTodayDate,
  isCurrentVerifiedRecord,
  isWithinPostDeadlineGrace,
  withRuntimeFreshness,
} from './freshness'
import type { ContentStatus, DataBundle } from './types'

const PROFILE_STATUSES = new Set<ContentStatus>(['verified', 'stale'])

export function isPublicStatus(status: ContentStatus): boolean {
  return PROFILE_STATUSES.has(status)
}

/**
 * Keeps a confirmed program identity discoverable after its profile review expires,
 * while withholding every field that may have changed since the last check.
 */
function toPublicProgramIdentity<T extends DataBundle['programs'][number]>(
  program: T,
  today: string,
): T | null {
  if (!isPublicStatus(program.status)) return null
  if (isCurrentVerifiedRecord(program, today)) return program

  const { details: _details, ...identity } = withRuntimeFreshness(program, today)
  void _details
  return {
    ...identity,
    status: 'stale',
    teachingLanguages: [],
    durationMonths: null,
    durationMonthsMax: null,
    applyUrl: null,
    languageRequirements: [],
    verificationScope: 'identity',
  } as unknown as T
}

/**
 * Scholarship names and official evidence remain useful after a cycle expires.
 * Funding, deadline, summary and application-route claims do not.
 */
function toPublicScholarshipIdentity<T extends DataBundle['scholarships'][number]>(
  scholarship: T,
  today: string,
): T | null {
  if (!isPublicStatus(scholarship.status)) return null
  if (!isWithinPostDeadlineGrace(scholarship.deadline, today)) return null
  if (
    isCurrentVerifiedRecord(scholarship, today)
    && isWithinPostDeadlineGrace(scholarship.deadline, today)
  ) return scholarship

  return {
    ...withRuntimeFreshness(scholarship, today),
    status: 'stale',
    coverage: {
      tuition: 'unknown',
      accommodation: 'unknown',
      insurance: 'unknown',
      stipendCnyPerMonth: null,
    },
    deadline: null,
    applicationUrl: null,
    summary: null,
  } as T
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
  const programs = data.programs.flatMap((item) => {
    if (!universityIds.has(item.universityId)) return []
    const identity = toPublicProgramIdentity(item, today)
    return identity ? [identity] : []
  })
  const programIds = new Set(programs.map((item) => item.id))
  const admissionCycles = data.admissionCycles.filter(
    (item) => isCurrentVerifiedRecord(item, today)
      && item.dateStatus !== 'previous-cycle-reference'
      && (item.dateStatus === 'rolling' || isWithinPostDeadlineGrace(item.closesOn, today))
      && programIds.has(item.programId),
  )
  const scholarships = data.scholarships.flatMap((item) => {
    const identity = toPublicScholarshipIdentity(item, today)
    if (!identity) return []
    return [{
      ...identity,
      universityIds: identity.universityIds.filter((id) => universityIds.has(id)),
      programIds: identity.programIds.filter((id) => programIds.has(id)),
    }]
  })

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
