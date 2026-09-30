import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FollowUpdates, type FollowTarget } from '@/components/features/FollowUpdates'
import { parseSiteNotifications, SITE_NOTIFICATIONS_KEY } from '@/lib/site-notifications'

const targets: FollowTarget[] = [{ kind: 'program', id: 'real-program-id', label: 'Computer Science' }]
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('website follow controls', () => {
  it('saves follows locally without any email request or CAPTCHA', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<FollowUpdates locale="en" targets={targets} />)
    fireEvent.click(screen.getByRole('button', { name: 'Follow on this website' }))
    expect(screen.getByRole('button', { name: 'Stop following on website' })).toHaveAttribute('aria-pressed', 'true')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(parseSiteNotifications(window.localStorage.getItem(SITE_NOTIFICATIONS_KEY)).follows[0]).toMatchObject({ kind: 'program', id: 'real-program-id', label: 'Computer Science' })
    view.unmount()
    render(<FollowUpdates locale="en" targets={targets} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop following on website' }))
    expect(parseSiteNotifications(window.localStorage.getItem(SITE_NOTIFICATIONS_KEY)).follows).toEqual([])
  })

  it('requires choosing an oversized batch and never silently truncates to twenty', () => {
    vi.stubGlobal('fetch', vi.fn())
    const saved = Array.from({ length: 21 }, (_, index) => ({ kind: 'program' as const, id: 'program-' + index, label: 'Program ' + index }))
    render(<FollowUpdates locale="en" targets={saved} bulk />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose website follows' }))
    expect(screen.getByRole('button', { name: 'Save website follows' })).toBeDisabled()
    for (let index = 0; index < 20; index++) fireEvent.click(screen.getByRole('checkbox', { name: 'Program ' + index }))
    expect(screen.getByRole('checkbox', { name: 'Program 20' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Program 0' }))
    expect(screen.getByRole('checkbox', { name: 'Program 20' })).toBeEnabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Program 20' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save website follows' }))
    const follows = parseSiteNotifications(window.localStorage.getItem(SITE_NOTIFICATIONS_KEY)).follows
    expect(follows).toHaveLength(20)
    expect(follows.some(follow => follow.id === 'program-0')).toBe(false)
    expect(follows.some(follow => follow.id === 'program-20')).toBe(true)
    expect(screen.getByText('Website follows saved.')).toBeVisible()
  })

  it('shows an honest error if the browser rejects saving preferences', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Denied') })
    render(<FollowUpdates locale="en" targets={targets} />)
    fireEvent.click(screen.getByRole('button', { name: 'Follow on this website' }))
    expect(screen.getByRole('alert')).toHaveTextContent('This browser could not save')
    expect(screen.getByRole('button', { name: 'Follow on this website' })).toBeVisible()
  })

  it('renders no controls for an empty target list', () => {
    const { container } = render(<FollowUpdates locale="en" targets={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
