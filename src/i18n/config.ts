export type LocaleDirection = 'ltr' | 'rtl'
export type LocaleReleaseState = 'public' | 'preview'

export interface LocaleConfig {
  code: string
  nativeName: string
  intlLocale: string
  openGraphLocale: string
  direction: LocaleDirection
  releaseState: LocaleReleaseState
}

/**
 * The single source of truth for every locale the product knows about.
 * Preview locales are intentionally excluded from routing, navigation and SEO
 * until their dictionaries and legal copy have passed release review.
 */
export const localeRegistry = [
  { code: 'en', nativeName: 'English', intlLocale: 'en-US', openGraphLocale: 'en_US', direction: 'ltr', releaseState: 'public' },
  { code: 'zh', nativeName: '中文', intlLocale: 'zh-CN', openGraphLocale: 'zh_CN', direction: 'ltr', releaseState: 'public' },
  { code: 'ru', nativeName: 'Русский', intlLocale: 'ru-RU', openGraphLocale: 'ru_RU', direction: 'ltr', releaseState: 'public' },
  { code: 'de', nativeName: 'Deutsch', intlLocale: 'de-DE', openGraphLocale: 'de_DE', direction: 'ltr', releaseState: 'preview' },
  { code: 'fr', nativeName: 'Français', intlLocale: 'fr-FR', openGraphLocale: 'fr_FR', direction: 'ltr', releaseState: 'preview' },
  { code: 'es', nativeName: 'Español', intlLocale: 'es-ES', openGraphLocale: 'es_ES', direction: 'ltr', releaseState: 'preview' },
  { code: 'pt', nativeName: 'Português', intlLocale: 'pt-BR', openGraphLocale: 'pt_BR', direction: 'ltr', releaseState: 'preview' },
  { code: 'ar', nativeName: 'العربية', intlLocale: 'ar', openGraphLocale: 'ar_AR', direction: 'rtl', releaseState: 'preview' },
] as const satisfies readonly LocaleConfig[]

type RegistryEntry = (typeof localeRegistry)[number]

export type Locale = RegistryEntry['code']
export type PublicLocale = Extract<RegistryEntry, { releaseState: 'public' }>['code']
export type PreviewLocale = Extract<RegistryEntry, { releaseState: 'preview' }>['code']

/** Kept as a compatibility alias while launch-language call sites migrate. */
export type LaunchLocale = PublicLocale

const localeByCode = Object.fromEntries(
  localeRegistry.map((config) => [config.code, config]),
) as { [Code in Locale]: Extract<RegistryEntry, { code: Code }> }

function localeCodesByState<State extends LocaleReleaseState>(state: State) {
  return localeRegistry
    .filter((config) => config.releaseState === state)
    .map((config) => config.code) as Array<Extract<RegistryEntry, { releaseState: State }>['code']>
}

export const allLocales: readonly Locale[] = localeRegistry.map(({ code }) => code)
export const publicLocales: readonly PublicLocale[] = localeCodesByState('public')
export const previewLocales: readonly PreviewLocale[] = localeCodesByState('preview')

/** Kept as a compatibility alias; publicLocales is the canonical name. */
export const launchLocales: readonly LaunchLocale[] = publicLocales

export const defaultLocale: PublicLocale = 'en'

export function isLocale(value: string): value is Locale {
  return Object.hasOwn(localeByCode, value)
}

export function isPublicLocale(value: string): value is PublicLocale {
  return isLocale(value) && localeByCode[value].releaseState === 'public'
}

export function isPreviewLocale(value: string): value is PreviewLocale {
  return isLocale(value) && localeByCode[value].releaseState === 'preview'
}

/** Kept as a compatibility alias; isPublicLocale is the canonical predicate. */
export const isLaunchLocale = isPublicLocale

export function getLocaleConfig<Code extends Locale>(locale: Code): Extract<RegistryEntry, { code: Code }> {
  return localeByCode[locale]
}

export function localeDirection(locale: Locale): LocaleDirection {
  return getLocaleConfig(locale).direction
}

export function localeIntlTag(locale: Locale): string {
  return getLocaleConfig(locale).intlLocale
}

export const localeNames = Object.fromEntries(
  localeRegistry.map(({ code, nativeName }) => [code, nativeName]),
) as Record<Locale, string>

export function pathnameLocale(pathname: string): Locale | null {
  const firstSegment = pathname.split('/')[1]
  return firstSegment && isLocale(firstSegment) ? firstSegment : null
}

/** Replace a known locale prefix, or add one when the path is unlocalized. */
export function localizePathname(pathname: string, locale: PublicLocale): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  const existingLocale = pathnameLocale(normalizedPath)
  const remainder = existingLocale
    ? normalizedPath.slice(existingLocale.length + 1)
    : normalizedPath

  return `/${locale}${remainder === '/' ? '' : remainder}`
}
