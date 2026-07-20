import type { MetadataRoute } from 'next'
import { indexedLocales } from '@/i18n/config'
import { getData } from '@/lib/data/load'
import { getDataReleaseDate } from '@/lib/data/release'
import { guides } from '@/lib/guides'
import { siteUrl } from '@/lib/site'

export default function sitemap(): MetadataRoute.Sitemap {
  const data = getData()
  const staticPaths = ['', 'universities', 'programs', 'scholarships', 'cities', 'guides', 'favorites', 'about', 'contact', 'privacy', 'disclaimer', 'data-policy', 'updates']
  const releaseDate = getDataReleaseDate(data)
  const entries = [
    ...staticPaths.map((path) => ({ path, lastModified: releaseDate })),
    ...data.universities.map((item) => ({ path: `universities/${item.slug}`, lastModified: item.verifiedAt })),
    ...data.programs.map((item) => ({ path: `programs/${item.slug}`, lastModified: item.verifiedAt })),
    ...data.scholarships.map((item) => ({ path: `scholarships/${item.slug}`, lastModified: item.verifiedAt })),
    ...data.cities.map((item) => ({ path: `cities/${item.slug}`, lastModified: item.verifiedAt })),
    ...guides.map((item) => ({ path: `guides/${item.slug}`, lastModified: item.updatedAt })),
  ]
  return entries.flatMap(({ path, lastModified }) => indexedLocales.map((locale) => {
    const localized = `/${locale}${path ? `/${path}` : ''}`
    return { url: new URL(localized, siteUrl).toString(), lastModified: new Date(`${lastModified}T00:00:00Z`), changeFrequency: path.startsWith('programs') || path.startsWith('scholarships') ? 'weekly' as const : 'monthly' as const, priority: path === '' ? 1 : path.includes('/') ? 0.7 : 0.8, alternates: { languages: Object.fromEntries(indexedLocales.map((code) => [code, new URL(`/${code}${path ? `/${path}` : ''}`, siteUrl).toString()])) } }
  }))
}
