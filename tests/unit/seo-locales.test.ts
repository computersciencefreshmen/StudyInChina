import { describe, expect, it } from 'vitest'

import sitemap from '@/app/sitemap'
import { getTodayDate } from '@/lib/data/freshness'
import { getData } from '@/lib/data/load'
import {
  isIndexableCity,
  isIndexableProgram,
  isIndexableScholarship,
} from '@/lib/seo/indexability'

describe('localized sitemap', () => {
  it('indexes the three fully translated locales and excludes beta and preview locales', async () => {
    const entries = await sitemap()
    const paths = entries.map((entry) => new URL(entry.url).pathname)

    for (const locale of ['en', 'zh', 'ru']) {
      expect(paths).toContain(`/${locale}`)
    }
    expect(paths.some((path) => ['de', 'fr', 'es'].some((locale) => path === `/${locale}` || path.startsWith(`/${locale}/`)))).toBe(false)
    expect(paths.some((path) => path === '/pt' || path.startsWith('/pt/'))).toBe(false)
    expect(paths.some((path) => path === '/ar' || path.startsWith('/ar/'))).toBe(false)
    expect(paths.some((path) => path.endsWith('/favorites'))).toBe(false)

    const englishPrograms = entries.find((entry) => new URL(entry.url).pathname === '/en/programs')
    expect(Object.keys(englishPrograms?.alternates?.languages || {}).sort()).toEqual(['en', 'ru', 'zh'])
  }, 15_000)

  it('keeps thin records accessible but excludes them from discovery feeds', async () => {
    const data = getData()
    const today = getTodayDate()
    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname)
    const detailCount = (segment: string) => paths.filter((path) => (
      new RegExp(`^/(en|zh|ru)/${segment}/[^/]+$`).test(path)
    )).length

    const indexablePrograms = data.programs.filter((program) => (
      isIndexableProgram(program, data.admissionCycles, today)
    )).length
    const indexableScholarships = data.scholarships.filter(isIndexableScholarship).length
    const indexableCities = data.cities.filter((city) => (
      isIndexableCity(city, data.universities)
    )).length

    expect(detailCount('programs')).toBe(indexablePrograms * 3)
    expect(detailCount('scholarships')).toBe(indexableScholarships * 3)
    expect(detailCount('cities')).toBe(indexableCities * 3)
    expect(indexablePrograms).toBeLessThan(data.programs.length)
  }, 15_000)
})
