import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FavoritesView } from '@/components/features/FavoritesView'
import { getMessages } from '@/i18n/messages'
import * as freshness from '@/lib/data/freshness'
import { FAVORITES_KEY } from '@/lib/favorites'

const actualTodayDate = freshness.getTodayDate

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

beforeEach(() => {
  vi.spyOn(freshness, 'getTodayDate').mockReturnValue('2026-08-10')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
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
    expect(screen.getAllByText('Review due')).toHaveLength(4)
    expect(screen.getAllByText('Current cycle')).toHaveLength(4)
    expect(screen.queryByText('Aug 2, 2026')).not.toBeInTheDocument()
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
            currentCycle: { ...comparisonItem(ids[0]).currentCycle, opensOn: '2026-08-20', applicationState: 'upcoming' },
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

  it('does not present reference tuition as a current confirmed price', async () => {
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

    expect(screen.queryByText(/CN¥\s*30,000/)).not.toBeInTheDocument()
    expect(screen.getByText('Not yet announced')).toBeVisible()
    expect(screen.queryByText('Reference amount—confirm with university')).not.toBeInTheDocument()
  })
  it.each(['program-stale', 'cycle-stale', 'program-overdue', 'cycle-overdue'])(
    'suppresses application links and changing facts for %s evidence', async (scenario) => {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([ids[0]]))
      const item = comparisonItem(ids[0])
      if (scenario === 'program-stale') item.program.status = 'stale'
      if (scenario === 'cycle-stale') item.currentCycle.status = 'stale'
      if (scenario === 'program-overdue') item.program.reviewAfter = '2026-08-09'
      if (scenario === 'cycle-overdue') item.currentCycle.reviewAfter = '2026-08-09'
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { items: [item], missingIds: [] }, meta: {} }),
      }) as Response))
      const user = userEvent.setup()
      render(<FavoritesView locale="en" messages={getMessages('en')} />)
      await user.click(await screen.findByRole('checkbox'))
      expect(screen.queryByRole('link', { name: /Apply on official site/ })).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Official source/ })).toBeVisible()
      expect(screen.queryByText(/CN¥\s*30,000/)).not.toBeInTheDocument()
      expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0)
      if (scenario.startsWith('program-')) expect(screen.queryByText('English')).not.toBeInTheDocument()
    },
  )

  it('respects field-level conflict metadata even when a price is present', async () => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([ids[0]]))
    const item = comparisonItem(ids[0])
    item.currentCycle.fieldMeta = {
      tuitionCny: { status: 'conflict', officialUrl: 'https://example.edu/tuition', sourceTitle: 'Fees', checkedAt: '2026-08-01' },
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { items: [item], missingIds: [] }, meta: {} }),
    }) as Response))
    const user = userEvent.setup()
    const { container } = render(<FavoritesView locale="en" messages={getMessages('en')} />)
    await user.click(await screen.findByRole('checkbox'))
    expect(container.querySelector('[data-fact-status="conflict"]')).toBeVisible()
    expect(screen.queryByText(/CN¥\s*30,000/)).not.toBeInTheDocument()
  })

  it('recomputes an expired deadline even while evidence remains within its review period', async () => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([ids[0]]))
    const item = comparisonItem(ids[0])
    item.currentCycle.closesOn = '2026-08-10'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { items: [item], missingIds: [] }, meta: {} }),
    }) as Response))
    const user = userEvent.setup()
    render(<FavoritesView locale="en" messages={getMessages('en')} />)
    const checkbox = await screen.findByRole('checkbox')
    expect(screen.getByText('Open now')).toBeVisible()
    vi.mocked(freshness.getTodayDate).mockReturnValue('2026-08-11')
    await user.click(checkbox)
    expect(screen.getAllByText(getMessages('en').programs.applicationsClosed)).toHaveLength(2)
    expect(screen.queryByRole('link', { name: /Apply on official site/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Needs review')).not.toBeInTheDocument()
  })

  it.each(['opensOn', 'closesOn', 'dateStatus'])('does not infer an open window from conflicting %s evidence', async (field) => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([ids[0]]))
    const item = comparisonItem(ids[0])
    item.currentCycle.fieldMeta = { [field]: { status: 'conflict', officialUrl: 'https://example.edu/dates', sourceTitle: 'Dates', checkedAt: '2026-08-01' } }
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ data: { items: [item], missingIds: [] }, meta: {} }),
    }) as Response))
    const user = userEvent.setup()
    render(<FavoritesView locale="en" messages={getMessages('en')} />)
    await user.click(await screen.findByRole('checkbox'))
    expect(screen.queryByRole('link', { name: /Apply on official site/ })).not.toBeInTheDocument()
    expect(screen.getAllByText(getMessages('en').programs.notAnnounced)).toHaveLength(2)
  })

  it('refreshes at China midnight and on visibility restoration, then clears timers and listeners', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T15:59:59.000Z'))
    vi.mocked(freshness.getTodayDate).mockImplementation(actualTodayDate)
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([ids[0]]))
    const item = comparisonItem(ids[0])
    item.program.reviewAfter = '2026-09-30'
    item.currentCycle.reviewAfter = '2026-09-30'
    item.currentCycle.closesOn = '2026-09-16'
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => ({
      ok: true, status: 200,
      // Deliberately return the old API snapshot throughout: the UI must re-evaluate its dates.
      json: async () => ({ data: { items: [item], missingIds: [] }, meta: {} }),
    }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    let unmount!: () => void
    await act(async () => { ({ unmount } = render(<FavoritesView locale="en" messages={getMessages('en')} />)) })
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('link', { name: /Apply on official site/ })).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('link', { name: /Apply on official site/ })).not.toBeInTheDocument()
    expect(screen.getAllByText(getMessages('en').programs.applicationsClosed)).toHaveLength(2)
    expect(screen.getByRole('note').querySelector('time')).toHaveAttribute('datetime', '2026-09-17')

    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    visibility.mockReturnValue('hidden')
    await act(async () => { fireEvent(document, new Event('visibilitychange')) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.setSystemTime(new Date('2026-10-01T01:00:00.000Z'))
    visibility.mockReturnValue('visible')
    await act(async () => { fireEvent(document, new Event('visibilitychange')) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('note').querySelector('time')).toHaveAttribute('datetime', '2026-10-01')
    expect(screen.queryByText('English')).not.toBeInTheDocument()
    expect(screen.queryByText(/CN¥\s*30,000/)).not.toBeInTheDocument()
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({ cache: 'no-store' }))

    unmount()
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => { fireEvent(document, new Event('visibilitychange')) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

})
