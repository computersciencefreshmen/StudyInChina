import { isPublicLocale, localeIntlTag, type Locale } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import type { AdmissionCycle, LocalizedText } from './types'
import reviewedProgramLocalizations from '../../../content/data/program-localizations.json'

const programTranslations = reviewedProgramLocalizations.entries as Record<string, LocalizedText>
const containsHan = (value: string) => /[\u3400-\u9fff]/u.test(value)
export const normalizeProgramTranslationKey = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim()

/** Exact source keys only; publication imports separately reviewed translations. */
export function findReviewedProgramTranslation(source: string, locale: Locale): string | undefined {
  const key = normalizeProgramTranslationKey(source)
  if (!Object.hasOwn(programTranslations, key)) return undefined
  return programTranslations[key]?.[locale]?.trim() || undefined
}

export function localizeProgramText(value: string, locale: Locale): string {
  return findReviewedProgramTranslation(value, locale) || value
}

export function localize(value: LocalizedText | null | undefined, locale: Locale): string {
  const unknown = getMessages(isPublicLocale(locale) ? locale : 'en').common.unknown
  if (!value) return unknown
  const translated = value[locale]?.trim()
  if (translated && (locale === 'zh' || locale === 'ar' || locale === 'pt' || !containsHan(translated))) return translated
  const candidates = [translated, value.en, value.zh, value.ru, ...Object.values(value)]
  for (const candidate of candidates) {
    const reviewed = candidate && findReviewedProgramTranslation(candidate, locale)
    if (reviewed) return reviewed
  }
  if (translated) return translated

  // Record-level translations arrive incrementally. Keep the original or
  // English title visible without adding a synthetic "translation pending"
  // prefix that can be mistaken for part of the official program name.
  const fallback = value.en?.trim()
    || value.zh?.trim()
    || value.ru?.trim()
    || Object.values(value).find((item) => item?.trim())?.trim()
  return fallback || unknown
}

export function formatDate(value: string | null, locale: Locale, fallback: string): string {
  if (!value) return fallback
  return new Intl.DateTimeFormat(localeIntlTag(locale), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

export function formatCny(value: number | null, locale: Locale, fallback: string): string {
  if (value === null) return fallback
  return new Intl.NumberFormat(localeIntlTag(locale), { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 }).format(value)
}

export function formatTuition(cycle: AdmissionCycle, locale: Locale, periodLabel: string, fallback = ''): string {
  return cycle.tuitionSchedule ? localize(cycle.tuitionSchedule, locale)
    : `${formatCny(cycle.tuitionCny, locale, fallback)} / ${periodLabel}`
}

export function isCurrentlyOpen(opensOn: string | null, closesOn: string | null, today = new Date()): boolean {
  const day = today.toISOString().slice(0, 10)
  return Boolean(opensOn && closesOn && opensOn <= day && day <= closesOn)
}
