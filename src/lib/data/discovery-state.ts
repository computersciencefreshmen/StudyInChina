import type { AdmissionCycle, AuditMeta } from './types'
import { isCurrentVerifiedRecord } from './freshness'
import type { FieldMeta } from '@/lib/catalog-api/types'

export type DirectoryFieldRecord = AuditMeta & { discovery?: {
  currentFacts: boolean; currentFieldPaths: string[]
  fieldStates?: Record<string, string>
  fieldMeta?: Record<string, FieldMeta>
} }

/** Leaf verification never upgrades unrelated fields or the whole record. */
export function hasCurrentDirectoryField(record: AuditMeta, fieldPath: string, today: string): boolean {
  const directory = (record as DirectoryFieldRecord).discovery
  if (!directory) return isCurrentVerifiedRecord(record, today) && record.verifiedAt <= today
  return directory.currentFacts || directory.currentFieldPaths.includes(fieldPath)
}

export function hasCurrentDirectoryCycleDates(cycle: AdmissionCycle | undefined, today: string): boolean {
  if (!cycle || !hasCurrentDirectoryField(cycle, 'dateStatus', today)) return false
  if (cycle.dateStatus === 'rolling' || cycle.dateStatus === 'not-announced') return true
  if (cycle.dateStatus !== 'published') return false
  const openingKnown = hasCurrentDirectoryField(cycle, 'opensOn', today)
  const closingKnown = hasCurrentDirectoryField(cycle, 'closesOn', today)
  if (cycle.opensOn && cycle.opensOn > today) return openingKnown
  // A past opening without a checked end condition cannot certify an open window.
  if (cycle.opensOn) return openingKnown && closingKnown
  return cycle.closesOn !== null && closingKnown
}

export function hasCurrentDirectoryTuition(cycle: AdmissionCycle | undefined, today: string): boolean {
  return Boolean(cycle && ['tuitionCny', 'tuitionStatus', 'tuitionPeriod']
    .every(path => hasCurrentDirectoryField(cycle, path, today)))
}
