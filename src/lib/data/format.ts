import { isPublicLocale, localeIntlTag, type Locale } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import type { LocalizedText } from './types'

export function localize(value: LocalizedText, locale: Locale): string {
  const translated = value[locale]?.trim()
  if (translated) return translated
  if (locale === 'en') return value.en

  const pendingLabel = isPublicLocale(locale)
    ? getMessages(locale).common.translationPending
    : getMessages('en').common.translationPending

  return `${pendingLabel}: ${value.en}`
}

export function formatDate(value: string | null, locale: Locale, fallback: string): string {
  if (!value) return fallback
  return new Intl.DateTimeFormat(localeIntlTag(locale), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

export function formatCny(value: number | null, locale: Locale, fallback: string): string {
  if (value === null) return fallback
  return new Intl.NumberFormat(localeIntlTag(locale), { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 }).format(value)
}

export function isCurrentlyOpen(opensOn: string | null, closesOn: string | null, today = new Date()): boolean {
  const day = today.toISOString().slice(0, 10)
  return Boolean(opensOn && closesOn && opensOn <= day && day <= closesOn)
}
