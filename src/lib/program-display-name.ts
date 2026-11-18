import 'server-only'
import type { LaunchLocale } from '@/i18n/config'
import { localize, localizeProgramText, containsHan } from './data/format'
import type { Program, University } from './data/types'
import type { ThirdPartyProgram } from './third-party-programs'
import { getOfficialTitleTranslation, getProgramTitleTranslation } from './program-translations'

export async function officialDisplayName(program: Program, university: University | undefined, locale: LaunchLocale) {
  const name = localize(program.name, locale)
  if (locale !== 'en' || !university || !containsHan(name)) return name
  return (await getOfficialTitleTranslation(program, university, locale))?.text || name
}

export async function collectedDisplayName(program: ThirdPartyProgram, locale: LaunchLocale) {
  const name = localizeProgramText(program.name, locale)
  if (locale !== 'en' || !containsHan(name)) return name
  return (await getProgramTitleTranslation(program, locale))?.text || name
}
