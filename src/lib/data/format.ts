import type { Locale } from '@/i18n/config'
import type { LocalizedText } from './types'

const intlLocale: Record<Locale, string> = { en: 'en-US', zh: 'zh-CN', ru: 'ru-RU', es: 'es-ES', fr: 'fr-FR', ar: 'ar', pt: 'pt-BR' }

export function localize(value: LocalizedText, locale: Locale): string {
  return value[locale] || value.en
}

export function formatDate(value: string | null, locale: Locale, fallback: string): string {
  if (!value) return fallback
  return new Intl.DateTimeFormat(intlLocale[locale], { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

export function formatCny(value: number | null, locale: Locale, fallback: string): string {
  if (value === null) return fallback
  return new Intl.NumberFormat(intlLocale[locale], { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 }).format(value)
}

export function isCurrentlyOpen(opensOn: string | null, closesOn: string | null, today = new Date()): boolean {
  const day = today.toISOString().slice(0, 10)
  return Boolean(opensOn && closesOn && opensOn <= day && day <= closesOn)
}
