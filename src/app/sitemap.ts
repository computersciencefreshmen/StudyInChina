import type { MetadataRoute } from 'next'
import { indexedLocales } from '@/i18n/config'
import { getTodayDate } from '@/lib/data/freshness'
import { getCatalogData } from '@/lib/data/load'
import { getDataReleaseDate } from '@/lib/data/release'
import { guides } from '@/lib/guides'
import {
  isIndexableCity,
  isIndexableProgram,
  isIndexableScholarship,
} from '@/lib/seo/indexability'
import { siteUrl } from '@/lib/site'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const data = await getCatalogData()
  const staticPaths = ['', 'universities', 'double-first-class', 'programs', 'scholarships', 'cities', 'guides', 'about', 'contact', 'privacy', 'disclaimer', 'data-policy', 'updates']
  const releaseDate = getDataReleaseDate(data)
  const today = getTodayDate()
  const entries = [
    ...staticPaths.map((path) => ({ path, lastModified: releaseDate })),
    ...data.universities.map((item) => ({ path: `universities/${item.slug}`, lastModified: item.verifiedAt })),
    ...data.programs
      .filter((item) => isIndexableProgram(item, data.admissionCycles, today))
      .map((item) => ({ path: `programs/${item.slug}`, lastModified: item.verifiedAt })),
    ...data.scholarships
      .filter(isIndexableScholarship)
      .map((item) => ({ path: `scholarships/${item.slug}`, lastModified: item.verifiedAt })),
    ...data.cities
      .filter((item) => isIndexableCity(item, data.universities))
      .map((item) => ({ path: `cities/${item.slug}`, lastModified: item.verifiedAt })),
    ...guides.map((item) => ({ path: `guides/${item.slug}`, lastModified: item.updatedAt })),
  ]
  return entries.flatMap(({ path, lastModified }) => indexedLocales.map((locale) => {
    const localized = `/${locale}${path ? `/${path}` : ''}`
    return { url: new URL(localized, siteUrl).toString(), lastModified: new Date(`${lastModified}T00:00:00Z`), changeFrequency: path.startsWith('programs') || path.startsWith('scholarships') ? 'weekly' as const : 'monthly' as const, priority: path === '' ? 1 : path.includes('/') ? 0.7 : 0.8, alternates: { languages: Object.fromEntries(indexedLocales.map((code) => [code, new URL(`/${code}${path ? `/${path}` : ''}`, siteUrl).toString()])) } }
  }))
}
