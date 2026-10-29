import { getTodayDate, isCurrentVerifiedRecord } from './freshness'
import type { AuditMeta, ContentStatus, DataBundle } from './types'
import type { IdentityAcceptance } from './identity-acceptance'
import { projectVerifiedProgramName } from './verified-program-name'

/** Unreviewed records remain available to administrators, never to applicants. */
export function isPublicStatus(status: ContentStatus): boolean {
  return status === 'verified'
}

/** A confirmed deadline is inclusive in China's calendar. */
export function isUnexpiredApplicationDeadline(deadline: string | null, today: string): boolean {
  return deadline === null || deadline >= today
}

export function isPublicVerifiedRecord(record: AuditMeta, today: string): boolean {
  return isCurrentVerifiedRecord(record, today) && record.verifiedAt <= today
}

/**
 * One publication decision serves pages and the JSON API. Expired reviews are
 * quarantined without changing original facts, evidence, or review dates.
 */
export function selectPublishedData(data: DataBundle, today = getTodayDate(), identities: IdentityAcceptance[] = []): DataBundle {
  const officialSourceIds = new Set(data.sources.filter(source => source.official).map(source => source.id))
  const publishable = (record: AuditMeta) => isPublicVerifiedRecord(record, today)
    && record.sourceIds.length > 0 && record.sourceIds.every(id => officialSourceIds.has(id))
  const cities = data.cities.filter(publishable)
  const cityIds = new Set(cities.map(item => item.id))
  const universities = data.universities.filter(item => publishable(item) && cityIds.has(item.cityId))
  const universityIds = new Set(universities.map(item => item.id))
  const programs = data.programs.filter(item => publishable(item)
    && item.verificationScope !== 'identity' && universityIds.has(item.universityId)).flatMap(item => {
      const projected = projectVerifiedProgramName(item, data.sources, identities, today)
      return projected ? [projected] : []
    })
  const programIds = new Set(programs.map(item => item.id))
  const admissionCycles = data.admissionCycles.filter(item => publishable(item)
    && item.dateStatus !== 'previous-cycle-reference'
    && (item.dateStatus === 'rolling' || isUnexpiredApplicationDeadline(item.closesOn, today))
    && programIds.has(item.programId))
  const scholarships = data.scholarships.filter(item => publishable(item)
    && isUnexpiredApplicationDeadline(item.deadline, today)).map(item => ({
      ...item,
      universityIds: item.universityIds.filter(id => universityIds.has(id)),
      programIds: item.programIds.filter(id => programIds.has(id)),
    }))
  const sourceIds = new Set([
    ...cities.flatMap(item => item.sourceIds), ...universities.flatMap(item => item.sourceIds),
    ...programs.flatMap(item => item.sourceIds), ...admissionCycles.flatMap(item => item.sourceIds),
    ...scholarships.flatMap(item => item.sourceIds),
  ])
  return { sources: data.sources.filter(source => sourceIds.has(source.id)), cities,
    universities, programs, admissionCycles, scholarships }
}
