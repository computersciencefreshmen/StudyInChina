import type { AdmissionCycle, AuditMeta, City, DataBundle, Program, Scholarship, University } from './types'
import { getTodayDate } from './freshness'
import { selectPublishedData } from './publication'
import { identityAcceptanceLedgerSchema, identityFingerprint, type IdentityAcceptance, type IdentityEntityType } from './identity-acceptance'
import { applyFreshFieldVerifications, validateFieldVerification, type FieldVerification } from './field-verification'
import type { FieldMeta } from '@/lib/catalog-api/types'

export type DiscoveryMeta = { identityAcceptedAt: string; currentFacts: boolean; currentFieldPaths: string[]
  fieldStates?: Record<string, string>; fieldMeta?: Record<string, FieldMeta> }
export type DiscoveryRecord<T> = T & { discovery: DiscoveryMeta }
export type DiscoveryCounts = { universities: number; programs: number; scholarships: number }
export type DiscoveryData = DataBundle & {
  cities: DiscoveryRecord<City>[]; universities: DiscoveryRecord<University>[]
  programs: DiscoveryRecord<Program>[]; scholarships: DiscoveryRecord<Scholarship>[]
}

/** A public identity is not a statement about this year's admission or award. */
export function selectDiscoveryData(bundle: DataBundle, today = getTodayDate(), evidence: IdentityAcceptance[] = [], fieldEvidence: FieldVerification[] = []): DiscoveryData {
  const officialSources = new Map(bundle.sources.filter(source => source.official).map(source => [source.id, source]))
  const current = selectPublishedData(bundle, today)
  const currentIds = {
    city: new Set(current.cities.map(record => record.id)), university: new Set(current.universities.map(record => record.id)),
    program: new Set(current.programs.map(record => record.id)), scholarship: new Set(current.scholarships.map(record => record.id)),
  }
  const acceptedByRecord = new Map<string, IdentityAcceptance[]>()
  for (const input of evidence) {
    const parsed = identityAcceptanceLedgerSchema.shape.entries.element.safeParse(input)
    if (!parsed.success) continue
    const entry = parsed.data, key = `${entry.entityType}:${entry.recordId}`
    acceptedByRecord.set(key, [...(acceptedByRecord.get(key) ?? []), entry])
  }
  const accepted = (entityType: IdentityEntityType, record: City | University | Program | Scholarship) => {
    if (record.status === 'draft' || record.status === 'archived' || record.verifiedAt > today) return undefined
    if (!record.sourceIds.length || !record.sourceIds.every(id => officialSources.has(id))) return undefined
    if (currentIds[entityType].has(record.id)) return record.verifiedAt
    const candidates = acceptedByRecord.get(`${entityType}:${record.id}`)
    if (!candidates?.length) return undefined
    const fingerprint = identityFingerprint(entityType, record)
    return candidates.find(entry => entry.identitySha256 === fingerprint
      && getTodayDate(new Date(entry.acceptedAt)) <= today
      && entry.sourceIds.every(id => record.sourceIds.includes(id) && officialSources.has(id)))?.acceptedAt
  }
  const audit = (record: AuditMeta, fresh: boolean): AuditMeta => ({ sourceIds: [...record.sourceIds], verifiedAt: record.verifiedAt,
    reviewAfter: record.reviewAfter, status: fresh ? 'verified' : 'stale' })
  const metadata = (entityType: IdentityEntityType, record: City | University | Program | Scholarship, acceptedAt: string): DiscoveryMeta => ({
    identityAcceptedAt: acceptedAt, currentFacts: currentIds[entityType].has(record.id), currentFieldPaths: [],
  })
  // Explicit construction prevents newly added raw narrative fields leaking by spread.
  const cities = bundle.cities.flatMap(record => {
    const acceptedAt = accepted('city', record)
    if (!acceptedAt) return []
    const fresh = currentIds.city.has(record.id)
    return [{ ...audit(record, fresh), id: record.id, slug: record.slug, name: record.name, province: record.province, region: record.region,
      coordinates: fresh ? record.coordinates : null, overview: fresh ? record.overview : null, climate: fresh ? record.climate : null,
      foodHighlights: fresh ? record.foodHighlights : [], sights: fresh ? record.sights : [], discovery: metadata('city', record, acceptedAt) }]
  })
  const cityIds = new Set(cities.map(record => record.id))
  const universities = bundle.universities.flatMap(record => {
    const acceptedAt = accepted('university', record)
    if (!acceptedAt || !cityIds.has(record.cityId)) return []
    const fresh = currentIds.university.has(record.id)
    return [{ ...audit(record, fresh), id: record.id, slug: record.slug, name: record.name, cityId: record.cityId, region: record.region,
      officialUrl: record.officialUrl, admissionsUrl: fresh ? record.admissionsUrl : null, summary: fresh ? record.summary : null,
      featured: fresh && record.featured, ...(fresh && record.rankings ? { rankings: record.rankings } : {}), discovery: metadata('university', record, acceptedAt) }]
  })
  const universityIds = new Set(universities.map(record => record.id))
  const programs = bundle.programs.flatMap(record => {
    const acceptedAt = accepted('program', record)
    if (!acceptedAt || !universityIds.has(record.universityId)) return []
    const fresh = currentIds.program.has(record.id)
    return [{ ...audit(record, fresh), id: record.id, slug: record.slug, name: record.name, universityId: record.universityId,
      degreeLevel: record.degreeLevel, programUrl: record.programUrl,
      discipline: fresh ? record.discipline : 'other' as const, teachingLanguages: fresh ? record.teachingLanguages : [],
      durationMonths: fresh ? record.durationMonths : null, ...(fresh ? { durationMonthsMax: record.durationMonthsMax, durationText: record.durationText } : {}),
      applyUrl: fresh ? record.applyUrl : null, languageRequirements: fresh ? record.languageRequirements : [],
      verificationScope: fresh ? record.verificationScope : 'identity' as const,
      ...(fresh ? { details: record.details, supplementaryDetails: record.supplementaryDetails } : {}),
      discovery: metadata('program', record, acceptedAt) }]
  })
  const programIds = new Set(programs.map(record => record.id))
  const scholarships = bundle.scholarships.flatMap(record => {
    const acceptedAt = accepted('scholarship', record)
    if (!acceptedAt) return []
    const fresh = currentIds.scholarship.has(record.id)
    return [{ ...audit(record, fresh), id: record.id, slug: record.slug, name: record.name, providerType: record.providerType,
      universityIds: record.universityIds.filter(id => universityIds.has(id)), programIds: fresh ? record.programIds.filter(id => programIds.has(id)) : [],
      coverage: fresh ? { ...record.coverage } : { tuition: 'unknown' as const, accommodation: 'unknown' as const, insurance: 'unknown' as const, stipendCnyPerMonth: null },
      deadline: fresh ? record.deadline : null, applicationUrl: fresh ? record.applicationUrl : null,
      summary: fresh ? record.summary : null, ...(fresh ? { eligibility: record.eligibility } : {}),
      discovery: metadata('scholarship', record, acceptedAt) }]
  })
  const admissionCycles: Array<AdmissionCycle & { discovery?: DiscoveryMeta }> = current.admissionCycles
    .filter(record => programIds.has(record.programId))
  const cycleIds = new Set(admissionCycles.map(record => record.id))
  const reviewedCycleFields = new Map<string, FieldVerification[]>()
  for (const input of fieldEvidence) {
    if (input.entityType !== 'admissionCycle' || cycleIds.has(input.recordId)) continue
    const entry = validateFieldVerification(bundle, input, today)
    if (entry) reviewedCycleFields.set(entry.recordId, [...(reviewedCycleFields.get(entry.recordId) ?? []), entry])
  }
  for (const record of bundle.admissionCycles) {
    const checked = reviewedCycleFields.get(record.id)
    const years = record.academicYear.match(/\d{4}/gu)?.map(Number) ?? []
    if (!checked?.length || !programIds.has(record.programId) || record.dateStatus === 'previous-cycle-reference'
      || record.closesOn !== null && record.closesOn < today || years.length > 0 && Math.max(...years) < Number(today.slice(0, 4))) continue
    // A scoped field receipt permits a blank annual container, never its old siblings.
    admissionCycles.push({ ...audit(record, false), sourceIds: [...new Set(checked.map(entry => entry.sourceId))],
      id: record.id, programId: record.programId, academicYear: record.academicYear, intake: record.intake,
      opensOn: null, closesOn: null, dateStatus: 'not-announced', tuitionCny: null, tuitionPeriod: null,
      tuitionStatus: null, applicationFeeCny: null, factScope: 'partial',
      discovery: { identityAcceptedAt: checked[0].verifiedAt, currentFacts: false, currentFieldPaths: [] } })
  }
  const sourceIds = new Set([...cities, ...universities, ...programs, ...scholarships, ...admissionCycles].flatMap(record => record.sourceIds))
  const projected = { cities, universities, programs, scholarships, admissionCycles,
    sources: bundle.sources.filter(source => sourceIds.has(source.id)).map(source => ({ id: source.id, url: source.url, title: source.title,
      publisher: source.publisher, kind: source.kind, language: source.language, official: source.official, accessedAt: source.accessedAt })) }
  return applyFreshFieldVerifications(bundle, projected, today, fieldEvidence) as DiscoveryData
}

export function discoveryCounts(bundle: DataBundle): DiscoveryCounts {
  return { universities: bundle.universities.length, programs: bundle.programs.length, scholarships: bundle.scholarships.length }
}
