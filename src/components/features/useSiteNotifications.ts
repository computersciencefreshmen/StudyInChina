'use client'

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { applySiteObservations, EMPTY_NOTIFICATIONS, matchesSiteFollow, notificationSummaryInterval, parseSiteNotifications, parseSiteObservations, SITE_NOTIFICATIONS_EVENT, SITE_NOTIFICATIONS_KEY, siteFollowKey, type NotificationSummaryFrequency, type SiteFollow, type SiteNotificationState } from '@/lib/site-notifications'

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback)
  window.addEventListener(SITE_NOTIFICATIONS_EVENT, callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(SITE_NOTIFICATIONS_EVENT, callback)
  }
}
function snapshot() {
  try { return window.localStorage.getItem(SITE_NOTIFICATIONS_KEY) || EMPTY_NOTIFICATIONS }
  catch { return EMPTY_NOTIFICATIONS }
}
function save(change: (current: SiteNotificationState) => SiteNotificationState): boolean {
  try {
    const current = parseSiteNotifications(window.localStorage.getItem(SITE_NOTIFICATIONS_KEY))
    window.localStorage.setItem(SITE_NOTIFICATIONS_KEY, JSON.stringify(change(current)))
    window.dispatchEvent(new Event(SITE_NOTIFICATIONS_EVENT))
    return true
  } catch { return false }
}

let refreshPromise: Promise<boolean> | null = null
let lastAttemptAt = 0
let lastAttemptSucceeded = true
/** A shared request prevents desktop/mobile header instances from making duplicate checks. */
export function refreshSiteNotifications(force = false): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  const state = parseSiteNotifications(snapshot())
  if (!state.follows.length) return Promise.resolve(true)
  const now = Date.now()
  if (!force && state.lastCheckedAt > 0 && now - Math.max(state.lastCheckedAt, lastAttemptSucceeded ? 0 : lastAttemptAt) < notificationSummaryInterval(state.summaryFrequency)) return Promise.resolve(lastAttemptSucceeded)
  lastAttemptAt = now
  refreshPromise = (async () => {
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      const result: { available?: boolean; observations?: unknown; observedAt?: number } = await response.json()
      if (!response.ok || result.available !== true || !Array.isArray(result.observations)
        || typeof result.observedAt !== 'number' || !Number.isFinite(result.observedAt) || result.observedAt < 0
        || result.observedAt > Date.now() + 60_000) throw new Error('Unavailable')
      // Re-read preferences after the request: a visitor may unfollow during network latency.
      lastAttemptSucceeded = save(current => applySiteObservations(current, parseSiteObservations(result.observations), result.observedAt!))
      return lastAttemptSucceeded
    } catch { lastAttemptSucceeded = false; return false }
    finally { refreshPromise = null }
  })()
  return refreshPromise
}

export function useSiteNotifications(refreshOnResume = false) {
  const raw = useSyncExternalStore(subscribe, snapshot, () => EMPTY_NOTIFICATIONS)
  const ready = useSyncExternalStore(() => () => undefined, () => true, () => false)
  const state = useMemo(() => parseSiteNotifications(raw), [raw])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const updateClock = () => { if (document.visibilityState === 'visible') setNow(Date.now()) }
    document.addEventListener('visibilitychange', updateClock)
    return () => document.removeEventListener('visibilitychange', updateClock)
  }, [])
  const followSignature = state.follows.map(siteFollowKey).join(',')
  useEffect(() => {
    if (!refreshOnResume || !ready || !followSignature) return
    void refreshSiteNotifications(state.lastCheckedAt === 0)
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshSiteNotifications() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshOnResume, ready, followSignature, state.lastCheckedAt, state.summaryFrequency])

  const follow = useCallback((targets: Omit<SiteFollow, 'followedAt'>[]) => save(current => {
    const existing = new Map(current.follows.map(item => [siteFollowKey(item), item]))
    const now = Date.now()
    let added = false
    for (const target of targets) {
      const key = siteFollowKey(target)
      if (!existing.has(key)) { existing.set(key, { ...target, followedAt: now }); added = true }
    }
    return { ...current, follows: [...existing.values()].slice(0, 500), lastCheckedAt: added ? 0 : current.lastCheckedAt }
  }), [])
  const unfollow = useCallback((target: Pick<SiteFollow, 'kind' | 'id'>) => save(current => {
    const follows = current.follows.filter(item => siteFollowKey(item) !== siteFollowKey(target))
    const events = current.events.filter(event => follows.some(follow => matchesSiteFollow(follow, event)))
    return {
      ...current, follows, events, readIds: current.readIds.filter(id => events.some(event => event.eventId === id)),
      baseline: Object.fromEntries(Object.entries(current.baseline).filter(([, item]) => follows.some(follow => matchesSiteFollow(follow, item)))),
      initializedTargets: current.initializedTargets.filter(key => key !== siteFollowKey(target)),
    }
  }), [])
  const markRead = useCallback((eventIds: string[]) => save(current => ({
    ...current, readIds: [...new Set([...current.readIds, ...eventIds])].slice(-100),
  })), [])
  const setSummaryFrequency = useCallback((summaryFrequency: NotificationSummaryFrequency) => save(current => ({
    ...current, summaryFrequency: summaryFrequency === 'daily' ? 'daily' : 'five-hours',
  })), [])
  return { ...state, now, ready, follow, unfollow, markRead, setSummaryFrequency }
}
