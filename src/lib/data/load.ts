import 'server-only'
import { cache } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTodayDate } from './freshness'
import { createCatalogRepository, type CatalogRepository } from '@/lib/catalog'
import { bundleSchema } from './schema'
import { selectPublishedData } from './publication'
import type { DataBundle } from './types'

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'content', 'data', `${name}.json`), 'utf8'))
}

export const getAllData = cache((): DataBundle => bundleSchema.parse({
  sources: readJson('sources'),
  cities: readJson('cities'),
  universities: readJson('universities'),
  programs: readJson('programs'),
  admissionCycles: readJson('admission-cycles'),
  scholarships: readJson('scholarships'),
}))

const getPublishedData = cache((today: string): DataBundle => selectPublishedData(getAllData(), today))

export function getData(): DataBundle {
  const data = getAllData()
  const previewEnabled = process.env.CONTENT_PREVIEW === 'true' && process.env.VERCEL_ENV !== 'production'
  return previewEnabled ? data : getPublishedData(getTodayDate())
}

let catalogRepository: CatalogRepository | undefined

function activeCatalogRepository(): CatalogRepository {
  catalogRepository ??= createCatalogRepository()
  return catalogRepository
}

const getRepositoryData = cache(async (today: string): Promise<DataBundle> => {
  const data = await activeCatalogRepository().getBundle()
  const previewEnabled = process.env.CONTENT_PREVIEW === 'true'
    && process.env.VERCEL_ENV !== 'production'
  return previewEnabled ? data : selectPublishedData(data, today)
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

export function getUniversityBySlug(slug: string) { return getData().universities.find((item) => item.slug === slug) }
export function getProgramBySlug(slug: string) { return getData().programs.find((item) => item.slug === slug) }
export function getScholarshipBySlug(slug: string) { return getData().scholarships.find((item) => item.slug === slug) }
export function getCityBySlug(slug: string) { return getData().cities.find((item) => item.slug === slug) }
