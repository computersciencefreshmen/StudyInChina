import { queryThirdPartyPrograms, type ThirdPartySchool } from './third-party-programs'

export function normalizeFullSchoolName(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export type ThirdPartySchoolLink = ThirdPartySchool & { view: 'extracted' | 'links' }

// This immutable index covers the imported artifact's full school directory,
// independently of the first page of programs returned alongside it.
const names = new Map<string, ThirdPartySchool[]>()
for (const school of queryThirdPartyPrograms({ view: 'links' }).schools) {
  const key = normalizeFullSchoolName(school.name)
  if (!key || school.programCount <= 0) continue
  const group = names.get(key) || []
  group.push(school)
  names.set(key, group)
}

/** No substring, acronym, reordered-word or fuzzy matching between institutions. */
export function getThirdPartySchoolLinks(englishSchoolName: string): ThirdPartySchoolLink[] {
  const normalized = normalizeFullSchoolName(englishSchoolName)
  if (!normalized) return []
  return (names.get(normalized) || []).map(school => ({
    ...school,
    view: school.extractedCount > 0 ? 'extracted' : 'links',
  }))
}
