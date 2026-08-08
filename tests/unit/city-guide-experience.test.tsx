import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import GuideDetail from '@/app/[locale]/guides/[slug]/page'
import { CityExplorer } from '@/components/features/CityExplorer'
import { launchLocales } from '@/i18n/config'
import { getCityGuideExperience } from '@/i18n/city-guide-experience'
import {
  cityExplorerSearchParams,
  parseCityExplorerSearchParams,
} from '@/lib/city-explorer'
import type { City } from '@/lib/data/types'

const guangzhou: City = {
  id: 'city-guangzhou',
  slug: 'guangzhou',
  name: { en: 'Guangzhou', zh: '广州' },
  province: { en: 'Guangdong', zh: '广东省' },
  region: 'south',
  coordinates: { lat: 23.1291, lng: 113.2644 },
  overview: { en: 'A student city.' },
  climate: null,
  foodHighlights: [],
  sights: [],
  sourceIds: ['source-city-guangzhou'],
  verifiedAt: '2026-07-26',
  reviewAfter: '2027-07-26',
  status: 'verified',
}

const beijing: City = {
  ...guangzhou,
  id: 'city-beijing',
  slug: 'beijing',
  name: { en: 'Beijing', zh: '北京' },
  province: { en: 'Beijing', zh: '北京市' },
  region: 'north',
  coordinates: { lat: 39.9042, lng: 116.4074 },
}

describe('city and guide experience', () => {
  it('offers keyboard-native city views, filters and deterministic sorting', () => {
    render(<CityExplorer
      cities={[guangzhou, beijing]}
      locale="en"
      universityCounts={{ [guangzhou.id]: 3, [beijing.id]: 9 }}
    />)

    expect(screen.getByRole('link', { name: 'Beijing: 9 Universities' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Constellation' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Directory' }))
    const directoryLinks = screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.includes('/cities/'))
    expect(directoryLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/en/cities/beijing',
      '/en/cities/guangzhou',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'South China 1' }))
    expect(screen.queryByRole('link', { name: /Beijing/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Guangzhou/ })).toBeVisible()

    fireEvent.change(screen.getByLabelText('Search cities'), { target: { value: 'missing' } })
    expect(screen.getByText('No cities match these filters.')).toBeVisible()
  })

  it('validates and serializes shareable city explorer state', () => {
    const state = parseCityExplorerSearchParams({
      view: 'directory',
      q: ' Guangzhou ',
      region: 'south',
      sort: 'name',
    })
    expect(state).toEqual({
      view: 'directory',
      query: 'Guangzhou',
      region: 'south',
      sort: 'name',
      viewExplicit: true,
    })

    const params = cityExplorerSearchParams(new URLSearchParams('campaign=atlas'), state)
    expect(params.get('campaign')).toBe('atlas')
    expect(params.get('view')).toBe('directory')
    expect(params.get('q')).toBe('Guangzhou')
    expect(params.get('region')).toBe('south')
    expect(params.get('sort')).toBe('name')

    expect(parseCityExplorerSearchParams({ view: 'map', region: 'invalid', sort: 'price' }))
      .toEqual(expect.objectContaining({ view: 'constellation', region: 'all', sort: 'universities', viewExplicit: false }))
  })

  it('renders flagship guide navigation, official sources and valid Article / FAQ JSON-LD', async () => {
    const page = await GuideDetail({
      params: Promise.resolve({ locale: 'en', slug: 'visa-and-arrival' }),
    })
    const { container } = render(page)

    expect(screen.getByRole('navigation', { name: 'On this page' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Official sources' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Frequently asked questions' })).toBeVisible()
    expect(screen.getAllByRole('link', { name: /official|visa|residence|accommodation|law/i }).length).toBeGreaterThan(3)

    const schemas = [...container.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')]
      .map((script) => JSON.parse(script.textContent || '{}') as { '@type'?: string; mainEntity?: unknown[]; mainEntityOfPage?: string })
    const article = schemas.find((schema) => schema['@type'] === 'Article')
    const faq = schemas.find((schema) => schema['@type'] === 'FAQPage')

    expect(article?.mainEntityOfPage).toContain('/en/guides/visa-and-arrival')
    expect(faq?.mainEntity).toHaveLength(4)
  })

  it.each(launchLocales)('keeps the flagship guide usable in %s with localized UI or safe content fallback', async (locale) => {
    const page = await GuideDetail({
      params: Promise.resolve({ locale, slug: 'choose-a-program' }),
    })
    render(page)

    const copy = getCityGuideExperience(locale).guides
    expect(screen.getByRole('navigation', { name: copy.contents })).toBeVisible()
    expect(screen.getByRole('heading', { name: copy.officialSources })).toBeVisible()
    expect(screen.queryByText(/translation pending|翻译待补充|перевод готовится/i)).not.toBeInTheDocument()
  })
})
