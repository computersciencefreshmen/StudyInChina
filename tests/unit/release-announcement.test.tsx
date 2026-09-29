import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'

import {
  DISMISSED_RELEASE_ANNOUNCEMENT_KEY,
  ReleaseAnnouncement,
} from '@/components/features/ReleaseAnnouncement'
import { getReleaseAnnouncement } from '@/i18n/release-announcement'

const stats = {
  universities: 266,
  programs: 1263,
  scholarships: 367,
}

describe('ReleaseAnnouncement', () => {
  it('shows the current localized release once with dynamic public counts', async () => {
    const announcement = getReleaseAnnouncement('zh')
    render(<ReleaseAnnouncement
      locale="zh"
      announcement={announcement}
      dataReleaseDate="2026年8月26日"
      stats={stats}
    />)

    const dialog = await screen.findByRole('dialog', { name: announcement.copy.title })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent('266')
    expect(dialog).toHaveTextContent('1,263')
    expect(dialog).toHaveTextContent('367')
    expect(screen.getByRole('link', { name: announcement.copy.explorePrograms }))
      .toHaveAttribute('href', '/zh/programs?applicationState=open')
    expect(screen.getByRole('link', { name: announcement.copy.fullUpdate }))
      .toHaveAttribute('href', '/zh/updates')
    expect(window.localStorage.getItem(DISMISSED_RELEASE_ANNOUNCEMENT_KEY))
      .toBe(announcement.id)
  })

  it('does not reappear after leaving before dismissing the first presentation', async () => {
    const announcement = getReleaseAnnouncement('en')
    const props = {
      locale: 'en' as const,
      announcement,
      dataReleaseDate: 'September 29, 2026',
      stats,
    }
    const first = render(<StrictMode><ReleaseAnnouncement {...props} /></StrictMode>)

    await screen.findByRole('dialog')
    expect(window.localStorage.getItem(DISMISSED_RELEASE_ANNOUNCEMENT_KEY))
      .toBe(announcement.id)
    first.unmount()

    render(<ReleaseAnnouncement {...props} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('persists dismissal and suppresses the same announcement on the next mount', async () => {
    const user = userEvent.setup()
    const announcement = getReleaseAnnouncement('en')
    const props = {
      locale: 'en' as const,
      announcement,
      dataReleaseDate: 'August 26, 2026',
      stats,
    }
    const first = render(<ReleaseAnnouncement {...props} />)

    await user.click(await screen.findByRole('button', { name: announcement.copy.dismiss }))
    expect(window.localStorage.getItem(DISMISSED_RELEASE_ANNOUNCEMENT_KEY))
      .toBe(announcement.id)
    first.unmount()

    render(<ReleaseAnnouncement {...props} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('suppresses newer releases when an older dismissal is already stored', async () => {
    const announcement = getReleaseAnnouncement('en')
    window.localStorage.setItem(DISMISSED_RELEASE_ANNOUNCEMENT_KEY, 'older-release')

    render(<ReleaseAnnouncement
      locale="en"
      announcement={announcement}
      dataReleaseDate="August 26, 2026"
      stats={stats}
    />)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(DISMISSED_RELEASE_ANNOUNCEMENT_KEY))
      .toBe('older-release')
  })

  it('stays dismissed after the language and release change', async () => {
    const user = userEvent.setup()
    const announcement = getReleaseAnnouncement('en')
    const view = render(<ReleaseAnnouncement
      locale="en"
      announcement={announcement}
      dataReleaseDate="September 29, 2026"
      stats={stats}
    />)

    await user.click(await screen.findByRole('button', { name: announcement.copy.dismiss }))
    view.rerender(<ReleaseAnnouncement
      locale="zh"
      announcement={{ ...getReleaseAnnouncement('zh'), id: 'future-release' }}
      dataReleaseDate="2026年9月29日"
      stats={stats}
    />)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes with Escape, restores scrolling and keeps Tab focus inside while open', async () => {
    const announcement = getReleaseAnnouncement('en')
    const previousFocus = document.createElement('button')
    document.body.appendChild(previousFocus)
    previousFocus.focus()
    render(<ReleaseAnnouncement
      locale="en"
      announcement={announcement}
      dataReleaseDate="August 26, 2026"
      stats={stats}
    />)

    const dialog = await screen.findByRole('dialog')
    const close = screen.getByRole('button', { name: announcement.copy.dismiss })
    const details = screen.getByRole('link', { name: announcement.copy.fullUpdate })
    await waitFor(() => expect(close).toHaveFocus())
    expect(document.body.style.overflow).toBe('hidden')

    details.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(dialog).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(previousFocus).toHaveFocus()
    previousFocus.remove()
  })
})
