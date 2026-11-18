import type { AuditMeta, Scholarship } from './types'
import type { DiscoveryMeta } from './discovery'

type WithDiscovery = AuditMeta & { discovery?: DiscoveryMeta }
/** A whole-current record or a fresh leaf can prove a value. Explicit unknown
 * overrides whole-record freshness; only a real not-applicable receipt grants
 * an exemption, never an absent/empty field by itself. */
export function supportsField(record: WithDiscovery, path: string, meaningful: boolean, today: string, allowExemption = false): boolean {
  const meta = record.discovery
  const current = meta ? meta.currentFacts : record.status === 'verified' && record.verifiedAt <= today && record.reviewAfter >= today
  if (!current && !meta?.currentFieldPaths.includes(path)) return false
  const state = meta?.fieldStates?.[path]
  if (state === 'not_applicable') return allowExemption
  if (state !== undefined && state !== 'known') return false
  return meaningful
}
export const hasList = (value: unknown): boolean => Array.isArray(value) && value.length > 0
export function applicationRoute(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password }
  catch { return false }
}
export function completeScholarship(award: Scholarship & { discovery?: DiscoveryMeta }, today: string): boolean {
  const known = (path: string, meaningful: boolean, exemption = false) => supportsField(award, path, meaningful, today, exemption)
  const deadline = typeof award.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(award.deadline) && award.deadline >= today
  return known('deadline', deadline, award.deadline === null) && known('applicationUrl', applicationRoute(award.applicationUrl))
    && known('eligibility', hasList(award.eligibility), true)
    && known('coverage.tuition', ['full', 'partial', 'none'].includes(award.coverage.tuition))
    && known('coverage.accommodation', ['full', 'partial', 'none'].includes(award.coverage.accommodation))
    && known('coverage.insurance', typeof award.coverage.insurance === 'boolean')
    && known('coverage.stipendCnyPerMonth', typeof award.coverage.stipendCnyPerMonth === 'number' && award.coverage.stipendCnyPerMonth >= 0, award.coverage.stipendCnyPerMonth === null)
}
