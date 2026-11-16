import 'server-only'
import { readCloudMiniMax } from '../admin/cloud-minimax'
import { agePublicMiniMax, projectPublicMiniMax, stalePublicMiniMax, PUBLIC_MONITOR_CACHE_MS, type PublicMiniMaxStatus } from './public-monitor'

/** Per-isolate request coalescing plus the existing protected reader's bounded
 * 8-second/64-KiB transport and 45-second cache. No browser headers are forwarded. */
export function createPublicMonitorReader(read: () => Promise<unknown>, now: () => number = Date.now) {
  let saved: PublicMiniMaxStatus | null = null, until = 0, pending: Promise<PublicMiniMaxStatus> | null = null
  return async (): Promise<PublicMiniMaxStatus> => {
    if (pending) return pending
    if (saved && until > now()) return agePublicMiniMax(saved, now())
    pending = (async () => {
      try {
        const next = projectPublicMiniMax(await read(), now())
        if (next.state === 'unavailable' && saved) {
          const old = stalePublicMiniMax(saved, now())
          saved = { ...old, quota: next.quota.observedAt ? next.quota : old.quota, processing: next.processing ?? old.processing }
        } else saved = next
      } catch { saved = saved ? stalePublicMiniMax(saved, now()) : projectPublicMiniMax(null, now()) }
      until = now() + PUBLIC_MONITOR_CACHE_MS
      return saved
    })().finally(() => { pending = null })
    return pending
  }
}
export const readPublicMiniMax = createPublicMonitorReader(readCloudMiniMax)
