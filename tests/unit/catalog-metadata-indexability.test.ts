import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }))
vi.mock('@/lib/data/load', () => ({ getCatalogData: vi.fn(), getData: vi.fn() }))

import { generateMetadata as generateCitiesMetadata } from '@/app/[locale]/cities/page'
import { generateMetadata as generateProgramDetailMetadata } from '@/app/[locale]/programs/[slug]/page'
import { generateMetadata as generateProgramsMetadata } from '@/app/[locale]/programs/page'
import { generateMetadata as generateScholarshipsMetadata } from '@/app/[locale]/scholarships/page'
import { generateMetadata as generateUniversitiesMetadata } from '@/app/[locale]/universities/page'
import { getCatalogData } from '@/lib/data/load'
import type { DataBundle } from '@/lib/data/types'

const localeParams = Promise.resolve({ locale: 'en' })
const audit = { status: 'verified' as const, verifiedAt: '2026-08-01', reviewAfter: '2026-09-01', sourceIds: ['metadata-source'] }
const metadataFixture: DataBundle = {
  sources: [], cities: [], scholarships: [], admissionCycles: [],
  universities: [{ ...audit, id: 'metadata-university', slug: 'metadata-university', name: { en: 'Example Technical University' }, cityId: 'metadata-city', region: null, officialUrl: 'https://example.edu.cn', admissionsUrl: null, summary: null, featured: false }],
  programs: [{ ...audit, id: 'metadata-program', slug: 'computer-science-title-test', universityId: 'metadata-university', name: { en: 'Computer Science and Technology' }, degreeLevel: 'bachelor', discipline: 'engineering', teachingLanguages: ['English'], durationMonths: 48, programUrl: 'https://example.edu.cn/program', applyUrl: null, languageRequirements: [], verificationScope: 'facts' }],
}

beforeEach(() => { vi.mocked(getCatalogData).mockResolvedValue(metadataFixture) })

describe('catalogue metadata indexability', () => {
  it('indexes base catalogues and marks every parameterized catalogue noindex,follow', async () => {
    const pages = [
      generateProgramsMetadata,
      generateUniversitiesMetadata,
      generateScholarshipsMetadata,
      generateCitiesMetadata,
    ]

    for (const generateMetadata of pages) {
      const base = await generateMetadata({ params: localeParams })
      const parameterized = await generateMetadata({
        params: localeParams,
        searchParams: Promise.resolve({ q: 'engineering' }),
      })

      expect(base.robots).toBeUndefined()
      expect(parameterized.robots).toEqual({ index: false, follow: true })
    }
  })

  it('adds the university name to a program title to disambiguate repeated names', async () => {
    const metadata = await generateProgramDetailMetadata({
      params: Promise.resolve({
        locale: 'en',
        slug: 'computer-science-title-test',
      }),
    })

    expect(metadata.title).toContain('Computer Science and Technology')
    expect(metadata.title).toContain('Example Technical University')
  })
})
