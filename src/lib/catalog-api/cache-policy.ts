import { getTodayDate } from '../data/freshness'

/** A cached admissions response must expire before the China calendar changes. */
export function catalogCacheControl(now = new Date()): string {
  const today = getTodayDate(now)
  const midnight = Date.parse(`${today}T00:00:00+08:00`) + 24 * 60 * 60 * 1_000
  // Round down: a response generated in the last partial second is not cacheable.
  const remaining = Math.max(0, Math.floor((midnight - now.getTime()) / 1_000))
  if (remaining === 0) return 'no-store'
  const maxAge = Math.min(60, remaining)
  const sharedMaxAge = Math.min(300, remaining)
  const staleWindow = Math.min(300, remaining - sharedMaxAge)
  return `public, max-age=${maxAge}, s-maxage=${sharedMaxAge}, stale-while-revalidate=${staleWindow}, must-revalidate`
}
