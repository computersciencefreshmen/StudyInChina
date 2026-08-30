import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FavoritesView } from '@/components/features/FavoritesView'
import { getMessages } from '@/i18n/messages'
import { FAVORITES_KEY } from '@/lib/favorites'

const ids = Array.from({ length: 6 }, (_, index) => `program-${index + 1}`)

function comparisonItem(id: string) {
  return {
    program: {
      id,
      slug: id,
      universityId: `university-${id}`,
      name: { en: `Program ${id}` },
      degreeLevel: 'master',
      discipline: 'engineering',
      teachingLanguages: ['English'],
      durationMonths: 24,
      durationMonthsMax: null,
      programUrl: `https://example.edu/${id}`,
      applyUrl: `https://apply.example.edu/${id}`,
      languageRequirements: [],
      verificationScope: 'facts',
      details: null,
      sourceIds: [`source-${id}`],
      verifiedAt: '2026-08-01',
      reviewAfter: '2026-09-01',
      status: 'verified',
      programType: 'degree',
      university: {
        id: `university-${id}`,
        slug: `university-${id}`,
        name: { en: `University ${id}` },
      },
      officialSources: [{
        url: `https://example.edu/${id}`,
        title: 'Official program page',
        checkedAt: '2026-08-01',
      }],
      fieldMeta: {},
    },
    currentCycle: {
      id: `cycle-${id}`,
      programId: id,
      academicYear: '2026-2027',
      intake: 'autumn',
      opensOn: '2026-08-01',
      closesOn: '2026-12-01',
      dateStatus: 'published',
      tuitionCny: 30_000,
      tuitionPeriod: 'academic-year',
      tuitionStatus: 'confirmed',
      evidenceBasis: 'cycle-specific',
      applicationFeeCny: 600,
      sourceIds: [`source-${id}`],
      verifiedAt: '2026-08-01',
      reviewAfter: '2026-09-01',
      status: 'verified',
      applicationState: 'open',
      officialSources: [{
        url: `https://example.edu/${id}/admissions`,
        title: 'Official admissions notice',
        checkedAt: '2026-08-02',
      }],
      fieldMeta: {},
    },
    linkedScholarshipCount: 2,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('favorites comparison workspace', () => {
  it('keeps the server page from serializing the complete catalogue', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'app', '[locale]', 'favorites', 'page.tsx'),
      'utf8',
    )

    expect(source).not.toContain('getCatalogData')
    expect(source).not.toContain('programs={')
    expect(source).not.toContain('admissionCycles')
  })

  it('loads any number of saved ids in batches of four and limits comparison to four', async () => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://example.test')
      const requestedIds = (url.searchParams.get('ids') || '').split(',').filter(Boolean)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            items: requestedIds.map(comparisonItem),
            missingIds: [],
          },
          meta: {
            releaseId: 'test-release',
            generatedAt: '2026-08-10T00:00:00.000Z',
            notice: 'Official sources remain authoritative.',
          },
        }),
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<FavoritesView locale="en" messages={getMessages('en')} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const batchSizes = fetchMock.mock.calls.map(([input]) => {
      const url = new URL(String(input), 'https://example.test')
      return (url.searchParams.get('ids') || '').split(',').filter(Boolean).length
    })
    expect(batchSizes).toEqual([4, 2])
    expect(await screen.findAllByRole('checkbox')).toHaveLength(6)

    const checkboxes = screen.getAllByRole('checkbox')
    for (const checkbox of checkboxes.slice(0, 4)) await user.click(checkbox)
    expect(checkboxes[4]).toBeDisabled()

    expect(screen.getAllByText('Application status')).toHaveLength(4)
    expect(screen.getAllByText('Application fee')).toHaveLength(4)
    expect(screen.getAllByText('Related scholarships')).toHaveLength(4)
    expect(screen.getAllByText('Verified on')).toHaveLength(4)
    expect(screen.getAllByRole('link', { name: /Official source/ })).toHaveLength(4)
    expect(screen.getAllByRole('link', { name: /Apply on official site/ })).toHaveLength(4)
    expect(screen.getAllByRole('link', { name: /Apply on official site/ })[0])
      .toHaveAttribute('href', 'https://apply.example.edu/program-1')
  })

  it('does not show an application action when the official cycle is not open', async () => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([ids[0]]))
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          items: [{
            ...comparisonItem(ids[0]),
            currentCycle: { ...comparisonItem(ids[0]).currentCycle, applicationState: 'upcoming' },
          }],
          missingIds: [],
        },
        meta: {},
      }),
    }) as Response))
    const user = userEvent.setup()

    render(<FavoritesView locale="en" messages={getMessages('en')} />)
    const checkbox = await screen.findByRole('checkbox')
    await user.click(checkbox)

    expect(screen.getByRole('link', { name: /Official source/ })).toBeVisible()
    expect(screen.queryByRole('link', { name: /Apply on official site/ })).not.toBeInTheDocument()
  })

  it('keeps reference tuition concise in comparison cards', async () => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([ids[0]]))
    const item = comparisonItem(ids[0])
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          items: [{
            ...item,
            currentCycle: { ...item.currentCycle, tuitionStatus: 'reference' },
          }],
          missingIds: [],
        },
        meta: {},
      }),
    }) as Response))
    const user = userEvent.setup()
    const messages = getMessages('en')

    render(<FavoritesView locale="en" messages={messages} />)
    await user.click(await screen.findByRole('checkbox'))

    expect(screen.getByText(/CN¥\s*30,000/)).toBeVisible()
    expect(screen.queryByText('Reference amount—confirm with university')).not.toBeInTheDocument()
  })
})
