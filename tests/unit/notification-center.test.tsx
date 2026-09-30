import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationCenter } from '@/components/features/NotificationCenter'
import { refreshSiteNotifications, useSiteNotifications } from '@/components/features/useSiteNotifications'
import { applySiteObservations, parseSiteNotifications, SITE_NOTIFICATIONS_KEY, type SiteNotificationState, type SiteObservation } from '@/lib/site-notifications'

const follow = { kind: 'university' as const, id: 'university-one', label: 'University One', followedAt: 100 }
const observation: SiteObservation = { observationKey: 'program:program-one', id: 'program-one', kind: 'program', universityId: 'university-one', title: 'New program', slug: 'new-program', fingerprint: 'before', verified: true }
const response = (observations: unknown[], status = 200) => ({ ok: status === 200, status, json: async () => ({ available: status === 200, observations, observedAt: Date.now() }) })

beforeEach(() => vi.clearAllMocks())
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function seed(initialized = false) {
  let state: SiteNotificationState = { ...parseSiteNotifications(null), follows: [follow] }
  if (initialized) state = applySiteObservations(state, [observation], Date.now() - 5 * 60 * 60_000)
  window.localStorage.setItem(SITE_NOTIFICATIONS_KEY, JSON.stringify(state))
}

describe('website notification center', () => {
  it('does not request observations before any website follow', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<NotificationCenter locale="en" />)
    expect(screen.getAllByText('No website follows yet').length).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows unavailable honestly without deleting local follows', async () => {
    seed()
    vi.stubGlobal('fetch', vi.fn(async () => response([], 503)))
    render(<NotificationCenter locale="en" />)
    expect(await screen.findByText(/Updates could not be loaded/)).toBeVisible()
    expect(screen.queryByText('No new important updates')).not.toBeInTheDocument()
    expect(screen.getByText('University One')).toBeVisible()
    expect(parseSiteNotifications(window.localStorage.getItem(SITE_NOTIFICATIONS_KEY)).follows).toEqual([follow])
  })

  it('establishes a first baseline without displaying historical records', async () => {
    seed()
    vi.stubGlobal('fetch', vi.fn(async () => response([observation])))
    render(<NotificationCenter locale="en" />)
    expect(await screen.findByText('No new important updates')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'New program ↗' })).not.toBeInTheDocument()
    expect(Object.keys(parseSiteNotifications(window.localStorage.getItem(SITE_NOTIFICATIONS_KEY)).baseline)).toEqual([observation.observationKey])
  })

  it('shows observed changes and retains read state across remounts', async () => {
    seed(true)
    vi.stubGlobal('fetch', vi.fn(async () => response([{ ...observation, fingerprint: 'after' }])))
    const view = render(<NotificationCenter locale="en" />)
    expect(await screen.findByRole('link', { name: 'New program ↗' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(screen.getByText('Read')).toBeVisible()
    expect(parseSiteNotifications(window.localStorage.getItem(SITE_NOTIFICATIONS_KEY)).readIds).toHaveLength(1)
    view.unmount()
    render(<NotificationCenter locale="en" />)
    expect(await screen.findByText('Read')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop following: University One' }))
    expect(screen.getAllByText('No website follows yet').length).toBeGreaterThan(0)
  })

  it('throttles repeated automatic checks while allowing an explicit refresh', async () => {
    seed()
    const fetchMock = vi.fn(async () => response([observation]))
    vi.stubGlobal('fetch', fetchMock)
    expect(await refreshSiteNotifications(true)).toBe(true)
    expect(await refreshSiteNotifications()).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(await refreshSiteNotifications(true)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shares concurrent refreshes across components and never posts follow preferences', async () => {
    seed()
    let resolve: (value: ReturnType<typeof response>) => void = () => {}
    const fetchMock = vi.fn(() => new Promise<ReturnType<typeof response>>(done => { resolve = done }))
    vi.stubGlobal('fetch', fetchMock)
    const first = refreshSiteNotifications(true)
    const second = refreshSiteNotifications(true)
    resolve(response([observation]))
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]).toEqual(['/api/notifications', expect.objectContaining({ cache: 'no-store' })])
  })

  it('updates preferences on storage events and preserves original follow time', () => {
    const { result } = renderHook(() => useSiteNotifications())
    act(() => { result.current.follow([{ kind: 'program', id: 'program-one', label: 'Program One' }]) })
    const followedAt = result.current.follows[0].followedAt
    act(() => { result.current.follow([{ kind: 'program', id: 'program-one', label: 'Program One' }]) })
    expect(result.current.follows[0].followedAt).toBe(followedAt)
    act(() => {
      window.localStorage.setItem(SITE_NOTIFICATIONS_KEY, JSON.stringify({ follows: [follow], readIds: ['new-read'] }))
      window.dispatchEvent(new StorageEvent('storage', { key: SITE_NOTIFICATIONS_KEY }))
    })
    expect(result.current.follows).toEqual([follow])
    expect(result.current.readIds).toEqual(['new-read'])
  })

  it('refreshes on return when the automatic interval has elapsed', async () => {
    seed(true)
    const now = Date.now() + 5 * 60 * 60_000
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const fetchMock = vi.fn(async () => response([observation]))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useSiteNotifications(true))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(result.current.events).toEqual([])
    fireEvent(document, new Event('visibilitychange'))
    expect(fetchMock).toHaveBeenCalledOnce()
    clock.mockReturnValue(now + 5 * 60 * 60_000)
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('persists the chosen summary frequency across notification center remounts', () => {
    const view = render(<NotificationCenter locale="en" />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Summary frequency' }))
    fireEvent.click(screen.getByRole('option', { name: 'Daily summary', exact: true }))
    expect(parseSiteNotifications(window.localStorage.getItem(SITE_NOTIFICATIONS_KEY)).summaryFrequency).toBe('daily')
    view.unmount()
    render(<NotificationCenter locale="en" />)
    expect(screen.getByRole('combobox', { name: 'Summary frequency' })).toHaveAttribute('value', 'daily')
  })

  it.each(['five-hours', 'daily'] as const)('waits for the exact %s summary interval and allows manual refresh', async frequency => {
    seed()
    const start = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
    const fetchMock = vi.fn(async () => response([observation]))
    vi.stubGlobal('fetch', fetchMock)
    const state = parseSiteNotifications(window.localStorage.getItem(SITE_NOTIFICATIONS_KEY))
    window.localStorage.setItem(SITE_NOTIFICATIONS_KEY, JSON.stringify({ ...state, summaryFrequency: frequency }))
    expect(await refreshSiteNotifications(true)).toBe(true)
    const interval = (frequency === 'daily' ? 24 : 5) * 60 * 60_000
    clock.mockReturnValue(start + interval - 1)
    expect(await refreshSiteNotifications()).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    clock.mockReturnValue(start + interval)
    expect(await refreshSiteNotifications()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await refreshSiteNotifications(true)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

})
