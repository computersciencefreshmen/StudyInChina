import 'server-only'
import { createHash } from 'node:crypto'
import { getCatalogData } from './data/load'
import { findReviewedProgramTranslation } from './data/format'
import { classifyProgramField } from './data/fields'
import { matchesUniversityRankings, rankingFilterKeys } from './data/rankings'
import { getTodayDate, isCurrentVerifiedRecord } from './data/freshness'
import { scholarshipAppliesToProgram } from './data/scholarship-scope'
import type { DataBundle, DegreeLevel, University } from './data/types'
import { getProgramFeedIndex, getProgramFeedRecord } from './program-feed'
import { publicThirdPartyProgram } from './third-party-public'
import { programWithdrawalReason } from './program-publication-policy.mjs'
import type { ThirdPartyProgram } from './third-party-programs'
import { parseProgramCatalogFilters, selectProgramCatalogItems, PROGRAM_CATALOG_PAGE_SIZE, type ProgramCatalogFilters, type ProgramCatalogItem, type ProgramCatalogResult } from './program-catalog'

export type CollectedProgramItem = { collected: ThirdPartyProgram; university?: University; degree?: DegreeLevel; languages: string[]; sources: ThirdPartyProgram[] }
export type ReviewedProgramItem = ProgramCatalogItem & { sources?: ThirdPartyProgram[] }
export type UnifiedProgramItem = ReviewedProgramItem | CollectedProgramItem
export type UnifiedProgramResult = Omit<ProgramCatalogResult, 'items'> & { items: UnifiedProgramItem[]; revision: string; sourceConditionsUnknown: number }
type ProgramProjection = { items: UnifiedProgramItem[]; aliases: Map<string, string>; bySlug: Map<string, UnifiedProgramItem> }

// The feed replaces its array only after validating a complete new snapshot.
// Keep just the latest generation/day per immutable directory, never a global
// fallback. Mutable injected catalogues deliberately recompute on every call.
const projections = new WeakMap<DataBundle, {
  captured: ThirdPartyProgram[]; today: string; revision: string | undefined; value: ProgramProjection
}>()

const directoryHashes = new WeakMap<DataBundle, string>()
export function unifiedCatalogRevision(data: DataBundle, feedRevision: string, today: string) {
  let directory = Object.isFrozen(data) ? directoryHashes.get(data) : undefined
  if (!directory) {
    directory = createHash('sha256').update(JSON.stringify(data)).digest('hex')
    if (Object.isFrozen(data)) directoryHashes.set(data, directory)
  }
  return createHash('sha256').update(['program-publication-v2', directory, feedRevision, today].join('\n')).digest('hex')
}

export function normalizeProgramIdentity(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
function universityNameKey(value: string) {
  // Punctuation/spacing variants such as Xi'an/Xian have the same exact letters.
  // Never remove meaningful words (Medical/Forestry/etc.) or infer abbreviations.
  return normalizeProgramIdentity(value).replaceAll(' ', '')
}
function universityNameIndex(universities: University[]) {
  const index = new Map<string, University | null>()
  for (const university of universities) for (const name of [university.name.en, university.name.zh]) {
    if (!name) continue
    const key = universityNameKey(name)
    if (!key) continue
    if (!index.has(key)) index.set(key, university)
    else if (index.get(key)?.id !== university.id) index.set(key, null)
  }
  return index
}
export function collectedDegree(value = ''): DegreeLevel | undefined {
  const key = normalizeProgramIdentity(value).replaceAll(' ', '')
  if (['bachelor', 'bachelors', 'bachelordegree', 'undergraduate', 'bsc', 'ba', 'beng'].includes(key)) return 'bachelor'
  if (['master', 'masters', 'masterdegree', 'postgraduate', 'msc', 'ma', 'mba'].includes(key)) return 'master'
  if (['doctor', 'doctorate', 'doctoral', 'phd', 'phddegree'].includes(key)) return 'doctorate'
  if (['language', 'chineselanguage', 'chineselanguageprogram'].includes(key)) return 'language'
  if (['foundation', 'preparatory', 'preparatorycourse'].includes(key)) return 'foundation'
  if (['nondegree', 'nondegreeprogram', 'other'].includes(key)) return 'other'
  return undefined
}
export function collectedLanguages(value = ''): string[] {
  const key = normalizeProgramIdentity(value)
  if (['english', 'english taught', 'english medium'].includes(key)) return ['English']
  if (['chinese', 'mandarin', 'chinese taught', 'chinese medium'].includes(key)) return ['Chinese']
  if (['bilingual', 'chinese english', 'english chinese', 'chinese and english', 'english and chinese'].includes(key)) return ['Chinese', 'English']
  return []
}
function languageKey(languages: string[]) {
  return [...new Set(languages.flatMap(language => collectedLanguages(language)))].sort().join('|')
}
function identity(school: string, name: string, degree: DegreeLevel | undefined, languages: string[]) {
  const schoolKey = normalizeProgramIdentity(school), nameKey = normalizeProgramIdentity(name), language = languageKey(languages)
  return schoolKey && nameKey && degree && language ? `${schoolKey}\0${nameKey}\0${degree}\0${language}` : undefined
}
const offeringDimensions = ['duration', 'tuition', 'startDate', 'deadline'] as const
function offeringValue(value: string | undefined) {
  const normalized = value?.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
  return normalized && !/^(unknown|not announced|not provided|not available|n\/a|tba)$/.test(normalized) ? normalized : undefined
}
function sameKnownOffering(candidate: UnifiedProgramItem, record: ThirdPartyProgram) {
  // The reviewed schema does not supply a course start date and source fee wording
  // on the same scope. Missing dimensions cannot prove that two offerings coincide.
  if (!('collected' in candidate)) return false
  return offeringDimensions.every(key => {
    const left = offeringValue(candidate.collected.fields[key]), right = offeringValue(record.fields[key])
    if (!left || !right || left !== right) return false
    return key !== 'startDate' && key !== 'deadline' || /\b(?:19|20)\d{2}\b/.test(left)
  })
}
export function unifiedProgramSlug(item: UnifiedProgramItem) { return 'collected' in item ? item.collected.id : item.program.slug }
function title(item: UnifiedProgramItem) { return 'collected' in item ? item.collected.name : item.program.name.en || item.program.name.zh || '' }
function schoolName(item: UnifiedProgramItem) { return 'collected' in item ? item.collected.schoolName : item.university.name.en || '' }

/** Only exact identities AND fully known equal offering dimensions combine sources. Unknowns retain distinct offerings. */
export function combineProgramRecords(data: DataBundle, captured: ThirdPartyProgram[], today: string, revision?: string): ProgramProjection {
  const cacheable = data !== null && typeof data === 'object' && Object.isFrozen(data)
  const cached = cacheable ? projections.get(data) : undefined
  if (cached && cached.captured === captured && cached.today === today
    && (revision === undefined || cached.revision === revision)) return cached.value
  const items: UnifiedProgramItem[] = selectProgramCatalogItems(data, parseProgramCatalogFilters({}), today).map(item => ({ ...item }))
  const keys = new Map<string, UnifiedProgramItem[]>(), aliases = new Map<string, string>()
  const schools = universityNameIndex(data.universities)
  for (const item of items) if (!('collected' in item)) {
    const key = identity(item.university.id, item.program.name.en || '', item.program.degreeLevel, item.program.teachingLanguages)
    if (key) keys.set(key, [...keys.get(key) || [], item])
  }
  for (const record of [...captured].sort((a, b) => a.id.localeCompare(b.id))) {
    if (record.status !== 'extracted' || programWithdrawalReason(record)) continue
    const degree = collectedDegree(record.fields.degree), languages = collectedLanguages(record.fields.language)
    const university = schools.get(universityNameKey(record.schoolName)) || undefined
    const key = identity(university?.id || record.schoolName, record.name, degree, languages)
    const existing = key ? keys.get(key)?.find(candidate => sameKnownOffering(candidate, record)) : undefined
    const publicRecord = publicThirdPartyProgram(record) as ThirdPartyProgram
    if (existing) {
      existing.sources = [...existing.sources || [], publicRecord]
      aliases.set(record.id, unifiedProgramSlug(existing))
      continue
    }
    const item: CollectedProgramItem = { collected: publicRecord, degree, languages, university, sources: [publicRecord] }
    items.push(item)
    aliases.set(record.id, record.id)
    if (key) keys.set(key, [...keys.get(key) || [], item])
  }
  const bySlug = new Map<string, UnifiedProgramItem>()
  for (const item of items) {
    const slug = unifiedProgramSlug(item)
    if (!bySlug.has(slug)) bySlug.set(slug, item)
  }
  const value = { items, aliases, bySlug }
  if (cacheable) {
    // Consumers may filter/sort their own result arrays, but must not alter the
    // shared projection's membership or merged source lists.
    for (const item of items) { if (item.sources) Object.freeze(item.sources); Object.freeze(item) }
    Object.freeze(items)
    projections.set(data, { captured, today, revision, value })
  }
  return value
}

/** Counts the same canonical offerings as university details and Programs filters. */
export function countUnifiedUniversityPrograms(data: DataBundle, captured: ThirdPartyProgram[], today: string, revision?: string): Map<string, number> {
  const counts = new Map(data.universities.map(university => [university.id, 0]))
  for (const item of combineProgramRecords(data, captured, today, revision).items) {
    if (item.university) counts.set(item.university.id, (counts.get(item.university.id) || 0) + 1)
  }
  return counts
}

export async function getUnifiedUniversityProgramCounts(today = getTodayDate(), catalogData?: DataBundle): Promise<Map<string, number>> {
  const [data, feed] = await Promise.all([catalogData ?? getCatalogData(), getProgramFeedIndex()])
  return countUnifiedUniversityPrograms(data, feed.programs, today, unifiedCatalogRevision(data, feed.revision, today))
}

function matchesCollected(item: CollectedProgramItem, filters: ProgramCatalogFilters, data: DataBundle, today: string, queryTokens: string[]) {
  const record = item.collected, university = item.university
  const city = university ? data.cities.find(candidate => candidate.id === university.cityId) : undefined
  if (queryTokens.length) {
    const search = normalizeProgramIdentity([record.name, findReviewedProgramTranslation(record.name, 'en'), record.schoolName, record.fields.degree, record.fields.language,
      university?.name.en, university?.name.zh, city?.name.en, city?.name.zh].filter(Boolean).join(' '))
    if (queryTokens.some(token => !search.includes(token))) return false
  }
  let unknown = Boolean(filters.degree && !item.degree || filters.language && !item.languages.length)
  if (filters.degree && item.degree && item.degree !== filters.degree) return false
  if (filters.language && item.languages.length && !(filters.language === 'Bilingual' ? item.languages.length > 1 : item.languages.includes(filters.language))) return false
  if (filters.discipline && classifyProgramField({ name: { en: record.name }, degreeLevel: item.degree || 'other', discipline: 'other' }) !== filters.discipline) return false
  if (filters.institution && ![record.schoolId, normalizeProgramIdentity(record.schoolName), university?.id, university?.slug].includes(filters.institution)) return false
  if (filters.city && ![city?.id, city?.slug].includes(filters.city)) return false
  if (rankingFilterKeys.some(key => filters[key]) && (!university || !matchesUniversityRankings(university, filters, today))) return false
  // Source wording is retained; it does not establish a current application cycle or comparable annual tuition.
  if (filters.intake || filters.scholarship || filters.applicationState && filters.applicationState !== 'not-announced') unknown = true
  const hasTuition = Boolean(record.fields.tuition?.trim()) && !/^(unknown|not provided|n\/a|not available)$/i.test(record.fields.tuition!.trim())
  if (filters.tuition === 'known' && !hasTuition || filters.tuition === 'unknown' && hasTuition) return false
  if (filters.tuition && !['known', 'unknown'].includes(filters.tuition)) unknown = true
  return unknown ? 'unknown' : true
}

export function queryUnifiedProgramData(data: DataBundle, captured: ThirdPartyProgram[], filters: ProgramCatalogFilters, today: string, revision: string,
  combined = combineProgramRecords(data, captured, today, revision)): UnifiedProgramResult {
  const sourceSchool = captured.find(record => record.status === 'extracted' && record.schoolId === filters.institution)
  const sourceUniversity = sourceSchool ? universityNameIndex(data.universities).get(universityNameKey(sourceSchool.schoolName)) : undefined
  const effectiveFilters = sourceSchool ? { ...filters, institution: sourceUniversity?.slug || normalizeProgramIdentity(sourceSchool.schoolName) } : filters
  const currentScholarships = filters.scholarship ? data.scholarships.filter(scholarship => isCurrentVerifiedRecord(scholarship, today)) : []
  const reviewedData = filters.scholarship ? {
    ...data,
    programs: data.programs.filter(program => currentScholarships.some(scholarship => scholarshipAppliesToProgram(scholarship, program))),
  } : data
  const reviewedMatches = new Set(selectProgramCatalogItems(reviewedData, effectiveFilters, today).map(item => item.program.id))
  let sourceConditionsUnknown = 0
  const queryTokens = normalizeProgramIdentity(effectiveFilters.query).split(' ').filter(Boolean)
  const matching = combined.items.filter(item => {
    if (!('collected' in item)) return reviewedMatches.has(item.program.id)
    const result = matchesCollected(item, effectiveFilters, data, today, queryTokens)
    if (result === 'unknown') sourceConditionsUnknown++
    return result === true
  })
  if (filters.sort === 'name') matching.sort((a, b) => title(a).localeCompare(title(b), 'en') || unifiedProgramSlug(a).localeCompare(unifiedProgramSlug(b)))
  else if (filters.sort !== 'default') {
    const reviewedOrder = new Map(selectProgramCatalogItems(reviewedData, effectiveFilters, today).map((item, index) => [item.program.id, index]))
    matching.sort((a, b) => ('collected' in a ? Number.MAX_SAFE_INTEGER : reviewedOrder.get(a.program.id) || 0) - ('collected' in b ? Number.MAX_SAFE_INTEGER : reviewedOrder.get(b.program.id) || 0))
  } else {
    // Interleave institutions so a large source school cannot monopolize the first page.
    const groups = new Map<string, UnifiedProgramItem[]>()
    for (const item of matching) { const key = normalizeProgramIdentity(schoolName(item)); const group = groups.get(key) || []; group.push(item); groups.set(key, group) }
    const ordered: UnifiedProgramItem[] = [], values = [...groups.values()]
    for (let offset = 0; ordered.length < matching.length; offset++) for (const group of values) if (group[offset]) ordered.push(group[offset])
    matching.splice(0, matching.length, ...ordered)
  }
  const pageCount = Math.ceil(matching.length / PROGRAM_CATALOG_PAGE_SIZE)
  const stale = Boolean(filters.cursor) || Boolean(filters.revision && filters.revision !== revision)
  const page = pageCount ? Math.min(stale ? 1 : filters.page, pageCount) : 1
  const options = new Map<string, { value: string; name: { en?: string; zh?: string } }>()
  const cityIds = new Set<string>()
  for (const item of combined.items) {
    const university = item.university
    const value = university?.slug || normalizeProgramIdentity(schoolName(item))
    options.set(value, { value, name: university?.name || { en: schoolName(item) } })
    if (university) cityIds.add(university.cityId)
    if ('collected' in item && item.collected.schoolId === filters.institution) options.set(filters.institution, { value: filters.institution, name: { en: item.collected.schoolName } })
  }
  return { items: matching.slice((page - 1) * PROGRAM_CATALOG_PAGE_SIZE, page * PROGRAM_CATALOG_PAGE_SIZE), total: matching.length, totalExact: true, page, pageCount, pageSize: PROGRAM_CATALOG_PAGE_SIZE, revision, sourceConditionsUnknown,
    filters: { ...filters, page, cursor: '', cursorHistory: [], nextCursor: undefined, paginationMode: 'offset', revision },
    universityOptions: [...options.values()].sort((a, b) => (a.name.en || '').localeCompare(b.name.en || '')),
    cityOptions: data.cities.filter(city => cityIds.has(city.id)).map(city => ({ value: city.slug, name: city.name })) }
}

export async function queryUnifiedPrograms(filters: ProgramCatalogFilters, today: string, catalogData?: DataBundle) {
  const [data, feed] = await Promise.all([catalogData ?? getCatalogData(), getProgramFeedIndex()])
  return queryUnifiedProgramData(data, feed.programs, filters, today, unifiedCatalogRevision(data, feed.revision, today))
}
export async function resolveUnifiedProgram(slug: string, today: string, catalogData?: DataBundle) {
  const [data, feed] = await Promise.all([catalogData ?? getCatalogData(), getProgramFeedIndex()])
  const revision = unifiedCatalogRevision(data, feed.revision, today)
  const combined = combineProgramRecords(data, feed.programs, today, revision)
  const canonical = combined.aliases.get(slug) || slug
  const item = combined.bySlug.get(canonical)
  if (!item) return undefined
  if ('collected' in item) {
    const record = await getProgramFeedRecord(item.collected.id)
    if (!record || record.status !== 'extracted') return undefined
    return { item: { ...item, collected: record }, canonical, revision }
  }
  return { item, canonical, revision }
}
