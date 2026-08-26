'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { LinkButton } from '@/components/ui'
import type { LaunchLocale } from '@/i18n/config'
import {
  RELEASE_ANNOUNCEMENT_STORAGE_KEY,
  type ReleaseAnnouncementContent,
} from '@/i18n/release-announcement'
import styles from './ReleaseAnnouncement.module.css'

export const DISMISSED_RELEASE_ANNOUNCEMENT_KEY = RELEASE_ANNOUNCEMENT_STORAGE_KEY

type ReleaseStats = {
  universities: number
  programs: number
  scholarships: number
}

type ReleaseAnnouncementProps = {
  locale: LaunchLocale
  announcement: ReleaseAnnouncementContent
  dataReleaseDate: string
  stats: ReleaseStats
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function saveDismissedAnnouncement(id: string) {
  try {
    window.localStorage.setItem(DISMISSED_RELEASE_ANNOUNCEMENT_KEY, id)
  } catch {
    // Storage can be unavailable in hardened browsing modes. Dismissal still
    // works for the current page without weakening the rest of the experience.
  }
}

export function ReleaseAnnouncement({
  locale,
  announcement,
  dataReleaseDate,
  stats,
}: ReleaseAnnouncementProps) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const copy = announcement.copy
  const number = new Intl.NumberFormat(locale)

  useEffect(() => {
    let cancelled = false
    let dismissed: string | null = null
    try {
      dismissed = window.localStorage.getItem(DISMISSED_RELEASE_ANNOUNCEMENT_KEY)
    } catch {
      // A storage failure must not make the dialog or the page unusable.
    }
    if (dismissed !== announcement.id) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      queueMicrotask(() => {
        if (!cancelled) setOpen(true)
      })
    }
    return () => { cancelled = true }
  }, [announcement.id])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        saveDismissedAnnouncement(announcement.id)
        setOpen(false)
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hasAttribute('disabled'))
      if (!focusable.length) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocusRef.current?.focus()
    }
  }, [announcement.id, open])

  const dismiss = () => {
    saveDismissedAnnouncement(announcement.id)
    setOpen(false)
  }

  if (!open) return null

  return <div
    className={styles.backdrop}
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) dismiss()
    }}
  >
    <div
      ref={dialogRef}
      className={styles.dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
    >
      <div className={styles.horizon} aria-hidden="true"><span /><span /><span /></div>
      <div className={styles.header}>
        <span className={styles.seal} aria-hidden="true">{copy.mark}</span>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h2 id={titleId}>{copy.title}</h2>
        </div>
        <button
          ref={closeRef}
          className={styles.close}
          type="button"
          aria-label={copy.dismiss}
          onClick={dismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <p id={descriptionId} className={styles.summary}>{copy.summary}</p>

      <dl className={styles.stats}>
        <div><dt>{copy.universitiesLabel}</dt><dd>{number.format(stats.universities)}</dd></div>
        <div><dt>{copy.programsLabel}</dt><dd>{number.format(stats.programs)}</dd></div>
        <div><dt>{copy.scholarshipsLabel}</dt><dd>{number.format(stats.scholarships)}</dd></div>
      </dl>

      <div className={styles.details}>
        <div>
          <h3>{copy.highlightsTitle}</h3>
          <ol>
            {copy.highlights.map((item, index) => <li key={item}>
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <p>{item}</p>
            </li>)}
          </ol>
        </div>
        <aside className={styles.releaseMeta}>
          <span>{copy.dataAsOf}</span>
          <strong>{dataReleaseDate}</strong>
          <p>{copy.storageNote}</p>
        </aside>
      </div>

      <div className={styles.actions}>
        <LinkButton
          href={`/${locale}/programs?applicationState=open`}
          size="large"
          onClick={dismiss}
        >
          {copy.explorePrograms}
        </LinkButton>
        <LinkButton
          href={`/${locale}/updates`}
          variant="secondary"
          size="large"
          onClick={dismiss}
        >
          {copy.fullUpdate}
        </LinkButton>
      </div>
    </div>
  </div>
}
