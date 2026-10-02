/** Pure window validation shared by server admission and browser-visible status. */
export function isCurrentQuotaWindow(window: { startAt: string | null; resetAt: string | null }, period: 'fiveHour' | 'weekly', now = Date.now()): boolean {
  const start = Date.parse(window.startAt || '')
  const end = Date.parse(window.resetAt || '')
  if (!Number.isFinite(now) || !Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || start > now || now >= end) return false
  const hour = 3_600_000
  const duration = end - start
  if (period === 'weekly') return duration === 7 * 24 * hour
  if (duration === 5 * hour) return true
  // The official endpoint reported 20:00–00:00 Asia/Shanghai on 2026-10-02.
  // The FAQ documents fixed windows, but not this shortened terminal window.
  // Keep the exception exact; an arbitrary short or shifted window is unknown.
  const day = 24 * hour
  return duration === 4 * hour && (start + 8 * hour) % day === 20 * hour && (end + 8 * hour) % day === 0
}
