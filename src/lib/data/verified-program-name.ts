import type { IdentityAcceptance } from './identity-acceptance'
import { identityAcceptanceSchema, identityFingerprint, verifiedNameMatchesRecord, verifiedSourceUrlMatchesRecord } from './identity-acceptance'
import type { Program, Source } from './types'
import { getTodayDate } from './freshness'

/** Pure shared projection. No filesystem, model or database dependencies.
 * Old ledgers retain their previous semantics. An explicit but invalid scoped
 * review fails closed even for current records; it never restores raw siblings. */
export function projectVerifiedProgramName(record: Program, sources: Source[], entries: IdentityAcceptance[], today: string): Program | undefined {
  const scoped = entries.filter(entry => entry.entityType === 'program' && entry.recordId === record.id
    && (Object.hasOwn(entry, 'verifiedName') || Object.hasOwn(entry, 'verifiedSourceUrl')))
  if (!scoped.length) return record
  if (scoped.length !== 1) return undefined
  const parsed = identityAcceptanceSchema.safeParse(scoped[0])
  if (!parsed.success) return undefined
  const entry = parsed.data, official = new Set(sources.filter(source => source.official).map(source => source.id))
  if (!entry.verifiedName || !verifiedNameMatchesRecord(entry, record)
    || entry.identitySha256 !== identityFingerprint('program', record) || getTodayDate(new Date(entry.acceptedAt)) > today
    || record.verifiedAt > today || ['draft', 'archived'].includes(record.status)
    || !record.sourceIds.length || !record.sourceIds.every(id => official.has(id))
    || !entry.sourceIds.every(id => record.sourceIds.includes(id) && official.has(id))
    || !verifiedSourceUrlMatchesRecord(entry, record, sources)) return undefined
  return { ...record, name: { ...entry.verifiedName }, programUrl: entry.verifiedSourceUrl ?? record.programUrl }
}
