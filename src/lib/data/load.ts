import 'server-only'
import { cache } from 'react'
import { readValidatedCatalogBundle } from './raw-snapshot'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { getTodayDate } from './freshness'
import { createCatalogRepository, type CatalogRepository } from '@/lib/catalog'
import { selectDiscoveryData } from './discovery'
import { readIdentityAcceptances } from './identity-acceptance-store'
import { readFieldVerifications } from './field-verification-store'
import { isContentPreviewEnabled } from './preview'
import type { DataBundle } from './types'
import { canonicalUniversitySlug } from './slug-aliases'

export const getAllData = cache((): DataBundle => readValidatedCatalogBundle())

const getPublishedData = cache((today: string): DataBundle => getPublicCatalogSnapshot(getAllData(), today).current)

export function getData(): DataBundle {
  const data = getAllData()
  const previewEnabled = isContentPreviewEnabled(process.env)
  return previewEnabled ? data : getPublishedData(getTodayDate())
}

let catalogRepository: CatalogRepository | undefined

function activeCatalogRepository(): CatalogRepository {
  catalogRepository ??= createCatalogRepository()
  return catalogRepository
}

const getRepositoryData = cache(async (today: string): Promise<DataBundle> => {
  const data = await activeCatalogRepository().getBundle()
  const previewEnabled = isContentPreviewEnabled(process.env)
  if (!previewEnabled && activeCatalogRepository().mode === 'json') return getPublicCatalogSnapshot(data, today).directory
  return previewEnabled ? data : selectDiscoveryData(data, today,
    activeCatalogRepository().mode === 'json' ? readIdentityAcceptances(undefined, { strictProjection: true }) : [],
    activeCatalogRepository().mode === 'json' ? readFieldVerifications() : [])
})

/** Runtime page loader used by json, shadow, and d1 deployments. */
export function getCatalogData(): Promise<DataBundle> {
  return getRepositoryData(getTodayDate())
}

export async function getCatalogUniversityBySlug(slug: string) {
  return (await getCatalogData()).universities.find((item) => item.slug === slug)
}

export async function getCatalogProgramBySlug(slug: string) {
  return (await getCatalogData()).programs.find((item) => item.slug === slug)
}

export async function getCatalogScholarshipBySlug(slug: string) {
  return (await getCatalogData()).scholarships.find((item) => item.slug === slug)
}

export async function getCatalogCityBySlug(slug: string) {
  return (await getCatalogData()).cities.find((item) => item.slug === slug)
}

export function resetCatalogRepositoryForTests() {
  catalogRepository = undefined
}

export function getUniversityBySlug(slug: string) {
  const canonicalSlug = canonicalUniversitySlug(slug)
  return getData().universities.find((item) => item.slug === canonicalSlug)
}
export function getProgramBySlug(slug: string) { return getData().programs.find((item) => item.slug === slug) }
export function getScholarshipBySlug(slug: string) { return getData().scholarships.find((item) => item.slug === slug) }
export function getCityBySlug(slug: string) { return getData().cities.find((item) => item.slug === slug) }
