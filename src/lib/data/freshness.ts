import type { AuditMeta } from './types'

export const DATA_TIME_ZONE = 'Asia/Shanghai'

export type FreshnessState = 'fresh' | 'overdue'

/** Returns the current calendar date used by admissions data in YYYY-MM-DD form. */
export function getTodayDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: DATA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))

  return `${values.year}-${values.month}-${values.day}`
}

export function getFreshnessState(
  record: Pick<AuditMeta, 'reviewAfter'>,
  today = getTodayDate(),
): FreshnessState {
  return record.reviewAfter >= today ? 'fresh' : 'overdue'
}

export function isCurrentVerifiedRecord(
  record: Pick<AuditMeta, 'reviewAfter' | 'status'>,
  today = getTodayDate(),
): boolean {
  return record.status === 'verified' && getFreshnessState(record, today) === 'fresh'
}

/** Keeps a stable profile visible while marking an overdue verification at runtime. */
export function withRuntimeFreshness<T extends AuditMeta>(record: T, today = getTodayDate()): T {
  if (record.status !== 'verified' || getFreshnessState(record, today) === 'fresh') return record
  return { ...record, status: 'stale' }
}
