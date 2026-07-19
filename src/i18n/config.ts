export const allLocales = ['en', 'zh', 'ru', 'es', 'fr', 'ar', 'pt'] as const
export const launchLocales = ['en', 'zh', 'ru'] as const

export type Locale = (typeof allLocales)[number]
export type LaunchLocale = (typeof launchLocales)[number]

export const defaultLocale: LaunchLocale = 'en'

export function isLocale(value: string): value is Locale {
  return (allLocales as readonly string[]).includes(value)
}

export function isLaunchLocale(value: string): value is LaunchLocale {
  return (launchLocales as readonly string[]).includes(value)
}

export function localeDirection(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr'
}

export const localeNames: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
  ru: 'Русский',
  es: 'Español',
  fr: 'Français',
  ar: 'العربية',
  pt: 'Português',
}
