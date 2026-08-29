import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import UniversityDetailPage, {
  generateMetadata as generateUniversityMetadata,
} from '@/app/[locale]/universities/[slug]/page'
import ScholarshipDetail from '@/app/[locale]/scholarships/[slug]/page'
import { indexedLocales, launchLocales } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import { providerLabel } from '@/lib/data/scholarship'

const ALIAS_SLUG = 'beijing-language-university'
const CANONICAL_SLUG = 'beijing-language-and-culture-university'
const SCHOLARSHIP_SLUG = 'blcu-beijing-international-students-2027'

afterEach(() => {
  vi.useRealTimers()
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
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-26T12:00:00+08:00'))

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
