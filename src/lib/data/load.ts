import 'server-only'
import { cache } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

export const getData = cache((): DataBundle => {
  const data = getAllData()
  const previewEnabled = process.env.CONTENT_PREVIEW === 'true' && process.env.VERCEL_ENV !== 'production'
  return previewEnabled ? data : selectPublishedData(data)
})

export function getUniversityBySlug(slug: string) { return getData().universities.find((item) => item.slug === slug) }
export function getProgramBySlug(slug: string) { return getData().programs.find((item) => item.slug === slug) }
export function getScholarshipBySlug(slug: string) { return getData().scholarships.find((item) => item.slug === slug) }
export function getCityBySlug(slug: string) { return getData().cities.find((item) => item.slug === slug) }
