import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }))
vi.mock('@/lib/data/load', () => ({ getCatalogData: vi.fn(), getData: vi.fn() }))

import UniversityDetailPage, {
  generateMetadata as generateUniversityMetadata,
} from '@/app/[locale]/universities/[slug]/page'
import ScholarshipDetail from '@/app/[locale]/scholarships/[slug]/page'
import { indexedLocales, launchLocales } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import { providerLabel } from '@/lib/data/scholarship'
import { getCatalogData } from '@/lib/data/load'
import * as freshness from '@/lib/data/freshness'
import type { DataBundle } from '@/lib/data/types'

const ALIAS_SLUG = 'beijing-language-university'
const CANONICAL_SLUG = 'beijing-language-and-culture-university'
const SCHOLARSHIP_SLUG = 'city-scholarship-locale-test'
const audit = { status: 'verified' as const, verifiedAt: '2026-08-01', reviewAfter: '2026-09-01', sourceIds: ['locale-source'] }
function localeFixture(): DataBundle {
  return {
    sources: [{ id: 'locale-source', url: 'https://example.edu.cn/scholarships', title: 'Official funding guide', publisher: 'Example University', kind: 'scholarship', language: 'en', official: true, accessedAt: '2026-08-02' }],
    cities: [], programs: [], admissionCycles: [],
    universities: [{ ...audit, id: 'locale-university', slug: CANONICAL_SLUG, name: { en: 'Example Language University', zh: '示例语言大学' }, cityId: 'locale-city', region: null, officialUrl: 'https://example.edu.cn', admissionsUrl: null, summary: { en: 'Official university profile.' }, featured: false }],
    scholarships: [{ ...audit, id: 'locale-scholarship', slug: SCHOLARSHIP_SLUG, name: { en: 'City International Student Scholarship' }, providerType: 'city', universityIds: ['locale-university'], programIds: [], coverage: { tuition: 'full', accommodation: 'unknown', insurance: 'unknown', stipendCnyPerMonth: null }, deadline: '2027-07-01', applicationUrl: 'https://example.edu.cn/scholarships/apply', summary: { en: 'Official city funding route.' } }],
  }
}

beforeEach(() => {
  // Locale/canonical behavior must not depend on whichever live records remain publishable today.
  vi.spyOn(freshness, 'getTodayDate').mockReturnValue('2026-08-26')
  vi.mocked(getCatalogData).mockResolvedValue(localeFixture())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('detail-page canonical and locale hardening', () => {
  it('uses the canonical university slug for canonical, hreflang and x-default metadata', async () => {
    const metadata = await generateUniversityMetadata({
      params: Promise.resolve({ locale: 'zh', slug: ALIAS_SLUG }),
    })
    const alternates = metadata.alternates as {
      canonical?: string
      languages?: Record<string, string>
    }

    expect(alternates.canonical).toBe(`/zh/universities/${CANONICAL_SLUG}`)
    expect(alternates.languages?.['x-default']).toBe(`/en/universities/${CANONICAL_SLUG}`)
    for (const locale of indexedLocales) {
      expect(alternates.languages?.[locale]).toBe(`/${locale}/universities/${CANONICAL_SLUG}`)
    }
  })

  it('renders scholarship providers on the university page in every public locale', async () => {
    for (const locale of launchLocales) {
      const page = await UniversityDetailPage({
        params: Promise.resolve({ locale, slug: ALIAS_SLUG }),
      })
      const { container, unmount } = render(page)
      const detailLink = container.querySelector<HTMLAnchorElement>(
        `a[href="/${locale}/scholarships/${SCHOLARSHIP_SLUG}"]`,
      )
      const card = detailLink?.closest('.atlas-card')
      const badgeLabels = [...(card?.querySelectorAll('.atlas-badge') ?? [])]
        .map((badge) => badge.textContent?.trim())

      expect(detailLink).not.toBeNull()
      expect(badgeLabels).toContain(providerLabel('city', locale))
      expect(badgeLabels).not.toContain('CITY')
      unmount()
    }
  }, 15_000)

  it('renders the scholarship source status as localized copy, never as a raw enum', async () => {
    const data = localeFixture()
    data.scholarships[0].status = 'stale'
    vi.mocked(getCatalogData).mockResolvedValue(data)

    for (const locale of launchLocales) {
      const page = await ScholarshipDetail({
        params: Promise.resolve({ locale, slug: SCHOLARSHIP_SLUG }),
      })
      const { container, unmount } = render(page)
      const badgeLabels = [...container.querySelectorAll('.atlas-badge')]
        .map((badge) => badge.textContent?.trim())

      expect(badgeLabels).toContain(getMessages(locale).common.stale)
      expect(badgeLabels).not.toContain('verified')
      expect(badgeLabels).not.toContain('stale')
      unmount()
    }
  }, 15_000)
})
