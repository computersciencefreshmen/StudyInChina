import type { Metadata } from 'next'
import { getLocaleConfig, indexedLocales, isBetaLocale, isPublicLocale, type LaunchLocale } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'

type SiteEnvironment = {
  [name: string]: string | undefined
  NEXT_PUBLIC_SITE_URL?: string
  VERCEL_ENV?: string
  VERCEL_URL?: string
  RENDER?: string
  RENDER_EXTERNAL_URL?: string
}

export function resolveSiteUrl(environment: SiteEnvironment = process.env): URL {
  const configuredOrigin = environment.NEXT_PUBLIC_SITE_URL?.trim()
  const renderOrigin = environment.RENDER_EXTERNAL_URL?.trim()
  const productionOrigin = 'https://studyinchina.vercel.app'
  const fallbackOrigin = environment.VERCEL_ENV === 'production'
    ? productionOrigin
    : environment.VERCEL_URL
      ? `https://${environment.VERCEL_URL}`
      : renderOrigin || 'http://localhost:3000'
  const resolved = new URL(configuredOrigin || fallbackOrigin)
  // Hosted production origins must use TLS. Local production-build smoke tests
  // may still use localhost without pretending to be a Render/Vercel deployment.
  if ((environment.VERCEL_ENV === 'production' || environment.RENDER === 'true' || renderOrigin) && resolved.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_SITE_URL must use HTTPS in production')
  }
  return resolved
}

export const siteUrl = resolveSiteUrl()

export function requireLocale(value: string): LaunchLocale | null {
  return isPublicLocale(value) ? value : null
}

export type PageSearchParams = Record<string, string | string[] | undefined>

// Campaign labels do not change catalogue content. Keep the list explicit so
// unknown parameters and real filters still use the conservative noindex gate.
const campaignParameters = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'utm_id',
  'utm_source_platform',
])

export function hasSearchParameters(params: PageSearchParams): boolean {
  return Object.keys(params).some(key => !campaignParameters.has(key))
}

type PageMetadataOptions = {
  indexable?: boolean
}

export function pageMetadata(
  locale: LaunchLocale,
  title: string,
  description: string,
  path = '',
  options: PageMetadataOptions = {},
): Metadata {
  const messages = getMessages(locale)
  const suffix = title === messages.brand ? title : `${title} | ${messages.brand}`
  const localizedPath = path ? `/${locale}/${path.replace(/^\//, '')}` : `/${locale}`
  const languages = Object.fromEntries(indexedLocales.map((code) => [code, path ? `/${code}/${path.replace(/^\//, '')}` : `/${code}`]))

  return {
    title: suffix,
    description,
    robots: isBetaLocale(locale) || options.indexable === false
      ? { index: false, follow: true }
      : undefined,
    alternates: { canonical: localizedPath, languages: { ...languages, 'x-default': `/en${path ? `/${path.replace(/^\//, '')}` : ''}` } },
    openGraph: { title: suffix, description, url: localizedPath, siteName: messages.brand, type: 'website', locale: getLocaleConfig(locale).openGraphLocale },
    twitter: { card: 'summary_large_image', title: suffix, description },
  }
}
