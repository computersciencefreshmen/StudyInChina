import type { Metadata } from 'next'
import { getLocaleConfig, indexedLocales, isBetaLocale, isPublicLocale, type LaunchLocale } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'

function resolveSiteUrl(): URL {
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  const productionOrigin = 'https://studyinchina.vercel.app'
  const fallbackOrigin = process.env.VERCEL_ENV === 'production'
    ? productionOrigin
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'
  const resolved = new URL(configuredOrigin || fallbackOrigin)
  if (process.env.VERCEL_ENV === 'production' && resolved.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_SITE_URL must use HTTPS in production')
  }
  return resolved
}

export const siteUrl = resolveSiteUrl()

export function requireLocale(value: string): LaunchLocale | null {
  return isPublicLocale(value) ? value : null
}

export function pageMetadata(locale: LaunchLocale, title: string, description: string, path = ''): Metadata {
  const messages = getMessages(locale)
  const suffix = title === messages.brand ? title : `${title} | ${messages.brand}`
  const localizedPath = path ? `/${locale}/${path.replace(/^\//, '')}` : `/${locale}`
  const languages = Object.fromEntries(indexedLocales.map((code) => [code, path ? `/${code}/${path.replace(/^\//, '')}` : `/${code}`]))

  return {
    title: suffix,
    description,
    robots: isBetaLocale(locale) ? { index: false, follow: true } : undefined,
    alternates: { canonical: localizedPath, languages: { ...languages, 'x-default': `/en${path ? `/${path.replace(/^\//, '')}` : ''}` } },
    openGraph: { title: suffix, description, url: localizedPath, siteName: messages.brand, type: 'website', locale: getLocaleConfig(locale).openGraphLocale },
    twitter: { card: 'summary_large_image', title: suffix, description },
  }
}
