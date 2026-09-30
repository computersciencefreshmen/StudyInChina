'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { localeIntlTag, type LaunchLocale } from '@/i18n/config'
import { followedSiteUpdates, getSiteNotificationCopy, siteFollowKey } from '@/lib/site-notifications'
import { refreshSiteNotifications, useSiteNotifications } from './useSiteNotifications'
import styles from './NotificationCenter.module.css'

export function NotificationCenter({ locale }: { locale: LaunchLocale }) {
  const copy = getSiteNotificationCopy(locale)
  const { follows, readIds, events, now, ready, unfollow, markRead } = useSiteNotifications()
  const [status, setStatus] = useState<'loading' | 'available' | 'unavailable'>('loading')
  const [retry, setRetry] = useState(0)
  const [storageError, setStorageError] = useState(false)
  const hasFollows = follows.length > 0
  const matching = useMemo(() => followedSiteUpdates(follows, events).filter(event => event.publishedAt >= now - 30 * 86_400_000), [follows, events, now])
  const unread = matching.filter(event => !readIds.includes(event.eventId))

  useEffect(() => {
    if (!ready || !hasFollows) return
    let active = true
    async function load(force = false) {
      const available = await refreshSiteNotifications(force)
      if (active) setStatus(available ? 'available' : 'unavailable')
    }
    void load(true)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { active = false; document.removeEventListener('visibilitychange', onVisible) }
  }, [ready, hasFollows, retry])

  function saved(ok: boolean) { setStorageError(!ok) }

  return <div className={styles.center}>
    <div className={styles.feed}>
      <div className={styles.toolbar}><span className={styles.eyebrow}>{copy.eyebrow}{unread.length > 0 ? ' · ' + unread.length + ' ' + copy.unread : ''}</span>
        <Button type="button" size="small" variant="ghost" disabled={!ready || !unread.length} onClick={() => saved(markRead(matching.map(event => event.eventId)))}>{copy.allRead}</Button>
      </div>
      {!ready ? <p role="status" className={styles.state}>{copy.loading}</p> : !hasFollows ? <div className={styles.state}><span className={styles.stateIcon} aria-hidden="true">☆</span><h2>{copy.noFollows}</h2><p>{copy.noFollowsDetail}</p><Link className="atlas-button atlas-button--secondary atlas-button--medium" href={'/' + locale + '/universities'}>{copy.explore} →</Link></div>
        : status === 'loading' ? <p role="status" className={styles.state}>{copy.loading}</p>
          : <>{status === 'unavailable' ? <div className={styles.unavailable} role="status"><p>{copy.unavailable}</p><Button type="button" variant="secondary" size="small" onClick={() => { setStatus('loading'); setRetry(value => value + 1) }}>{copy.retry}</Button></div> : null}
            {!matching.length && status === 'available' ? <div className={styles.state} role="status"><span className={styles.stateIcon} aria-hidden="true">✓</span><h2>{copy.empty}</h2><p>{copy.emptyDetail}</p></div>
              : <ul className={styles.updates}>{matching.map(event => {
                const isRead = readIds.includes(event.eventId)
                return <li key={event.eventId} className={styles.update + (isRead ? ' ' + styles.read : '')}>
                  <span className={styles.dot} aria-hidden="true" /><div className={styles.updateContent}><div className={styles.updateMeta}><span>{event.change === 'created' ? copy.created : copy.updated}</span><span>{copy.detected}: <time dateTime={new Date(event.publishedAt).toISOString()}>{new Intl.DateTimeFormat(localeIntlTag(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(event.publishedAt)}</time></span></div>
                    <h2><Link href={'/' + locale + '/' + (event.kind === 'program' ? 'programs' : 'universities') + '/' + encodeURIComponent(event.slug)} onClick={() => saved(markRead([event.eventId]))}>{event.title || event.id} ↗</Link></h2>
                    {isRead ? <span className={styles.readLabel}>{copy.viewed}</span> : <Button type="button" size="small" variant="ghost" onClick={() => saved(markRead([event.eventId]))}>{copy.read}</Button>}
                  </div>
                </li>
              })}</ul>}</>}
    </div>
    <aside className={styles.follows} aria-labelledby="website-follows-heading"><h2 id="website-follows-heading">{copy.followed} <span>{ready ? follows.length : 0}</span></h2>
      {ready && follows.length ? <ul>{follows.map(follow => <li key={siteFollowKey(follow)}><span>{follow.label}</span><button type="button" onClick={() => saved(unfollow(follow))} aria-label={copy.remove + ': ' + follow.label}>{copy.remove}</button></li>)}</ul> : <p>{copy.noFollows}</p>}
      <p className={styles.local}>{copy.local}</p>
      {locale !== 'zh' && locale !== 'en' && locale !== 'ru' ? <p className={styles.local}>{copy.fallback}</p> : null}
    </aside>
    {storageError ? <p className={styles.error} role="alert">{copy.storageError}</p> : null}
  </div>
}
