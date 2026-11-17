import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => {
  const schools = [
    { id: 'cucas-alpha', name: 'Alpha University', provider: 'CUCAS', programCount: 3, extractedCount: 3 },
    { id: 'sicas-gamma', name: 'Gamma University', provider: 'SICAS', programCount: 2, extractedCount: 0 },
  ]
  const query = vi.fn((filters: { view?: string; provider?: string; school?: string; query?: string; page?: number } = {}) => ({
    items: [], total: 0, page: 1, totalPages: 1, pageSize: 40,
    schools: schools.filter(school => (filters.view === 'links' || school.extractedCount > 0)
      && (!filters.provider || school.provider.toLowerCase() === filters.provider)),
  }))
  return { query }
})

vi.mock('@/lib/third-party-programs', () => ({
  queryThirdPartyPrograms: fixture.query,
  getThirdPartySummary: () => ({ programCount: 5, extractedCount: 3, schoolCount: 2 }),
}))
vi.mock('@/components/ui', () => ({ PageHero: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('@/lib/site', () => ({
  requireLocale: (locale: string) => locale === 'en' || locale === 'zh' ? locale : null,
  hasSearchParameters: (params: Record<string, unknown>) => Object.keys(params).length > 0,
  pageMetadata: vi.fn(),
}))

import ImportedProgramsPage from '@/app/[locale]/programs/imported/page'

async function renderPage(locale: 'en' | 'zh', filters: Record<string, string>) {
  const tree = await ImportedProgramsPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(filters) })
  const container = document.createElement('div')
  // Parse the real server markup, reproducing the browser's selected-option fallback behavior.
  container.innerHTML = renderToStaticMarkup(tree)
  return { container, school: container.querySelector<HTMLSelectElement>('select[name="school"]')! }
}

beforeEach(() => vi.clearAllMocks())

describe('imported school filter state in server-rendered markup', () => {
  it('retains a CUCAS school when a provider change makes it incompatible, while Reset clears filters', async () => {
    const { container, school } = await renderPage('en', {
      view: 'links', school: 'cucas-alpha', provider: 'sicas', query: 'Medicine', page: '3',
    })
    expect(school.value).toBe('cucas-alpha')
    expect(school.selectedOptions[0].textContent).toBe('Selected school: Alpha University (no programs match these filters)')
    expect(fixture.query).toHaveBeenNthCalledWith(1, {
      view: 'links', school: 'cucas-alpha', provider: 'sicas', query: 'Medicine', page: 3,
    })
    expect(fixture.query).toHaveBeenNthCalledWith(2, { view: 'links' })
    const reset = [...container.querySelectorAll('a')].find(link => link.textContent === 'Reset filters')!
    const resetUrl = new URL(reset.getAttribute('href')!, 'https://example.test')
    expect(resetUrl.searchParams.get('view')).toBe('links')
    for (const key of ['school', 'provider', 'query', 'page']) expect(resetUrl.searchParams.has(key)).toBe(false)
  })

  it('retains a link-only school when switching to captured details, with the Chinese empty-state label', async () => {
    const { school } = await renderPage('zh', { school: 'sicas-gamma', provider: 'sicas' })
    expect(school.value).toBe('sicas-gamma')
    expect(school.selectedOptions[0].textContent).toBe('所选院校：Gamma University（当前筛选无项目）')
  })

  it('shows an unknown school ID as escaped text and retains the existing input-length bound', async () => {
    const unsafe = '"><img src=x onerror=alert(1)>' + 'z'.repeat(180)
    const { container, school } = await renderPage('en', { school: unsafe })
    expect(school.value).toBe(unsafe.slice(0, 150))
    expect(school.selectedOptions[0].textContent).toBe(`Selected school: ${unsafe.slice(0, 150)} (no programs match these filters)`)
    expect(container.querySelector('img, script')).toBeNull()
  })

  it('does not add an extra option or query the complete school list for a compatible selection', async () => {
    const { school } = await renderPage('en', { school: 'cucas-alpha', provider: 'cucas' })
    expect(school.value).toBe('cucas-alpha')
    expect(school.selectedOptions[0].textContent).toBe('Alpha University (3)')
    expect(school.querySelectorAll('option[value="cucas-alpha"]')).toHaveLength(1)
    expect(fixture.query).toHaveBeenCalledTimes(1)
  })
})
