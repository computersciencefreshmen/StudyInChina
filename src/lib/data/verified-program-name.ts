import type { IdentityAcceptance } from './identity-acceptance'
import { hasRequiredProgramNameScope, requiresReviewedProgramNameScope, identityAcceptanceSchema, identityFingerprint, verifiedNameMatchesRecord } from './identity-acceptance'
import type { Program, Source } from './types'
import { getTodayDate } from './freshness'

/** Pure shared projection. No filesystem, model or database dependencies.
 * Old ledgers retain their previous semantics. An explicit but invalid scoped
 * review fails closed even for current records; it never restores raw siblings. */
export function projectVerifiedProgramName(record: Program, sources: Source[], entries: IdentityAcceptance[], today: string): Program | undefined {
  return createVerifiedProgramNameProjector(sources, entries, today)(record)
}

/** Invocation-local indexes: callers build this once for a projection, then
 * discard it. Rebuilding on the next invocation respects mutable input data. */
export function createVerifiedProgramNameProjector(sources: Source[], entries: IdentityAcceptance[], today: string): (record: Program) => Program | undefined {
  const byProgram = new Map<string, IdentityAcceptance[]>()
  for (const entry of entries) {
    if (entry.entityType !== 'program') continue
    const matching = byProgram.get(entry.recordId)
    if (matching) matching.push(entry)
    else byProgram.set(entry.recordId, [entry])
  }
  const official = new Set<string>(), officialByUrl = new Map<string, string[]>()
  for (const source of sources) {
    if (!source.official) continue
    official.add(source.id)
    const ids = officialByUrl.get(source.url)
    if (ids) ids.push(source.id)
    else officialByUrl.set(source.url, [source.id])
  }

  return record => {
    const matching = byProgram.get(record.id) ?? []
    if (requiresReviewedProgramNameScope(record.id) && (matching.length !== 1 || !hasRequiredProgramNameScope(matching[0]))) return undefined
    const scoped = matching.filter(entry => Object.hasOwn(entry, 'verifiedName') || Object.hasOwn(entry, 'verifiedNameAlias') || Object.hasOwn(entry, 'verifiedSourceUrl'))
    if (!scoped.length) return record
    if (scoped.length !== 1) return undefined
    const parsed = identityAcceptanceSchema.safeParse(scoped[0])
    if (!parsed.success) return undefined
    const entry = parsed.data
    if (!entry.verifiedName || !verifiedNameMatchesRecord(entry, record)
      || entry.identitySha256 !== identityFingerprint('program', record) || getTodayDate(new Date(entry.acceptedAt)) > today
      || record.verifiedAt > today || ['draft', 'archived'].includes(record.status)
      || !record.sourceIds.length || !record.sourceIds.every(id => official.has(id))
      || !entry.sourceIds.every(id => record.sourceIds.includes(id) && official.has(id))
      || (entry.verifiedSourceUrl !== undefined && !(officialByUrl.get(entry.verifiedSourceUrl) ?? [])
        .some(id => entry.sourceIds.includes(id) && record.sourceIds.includes(id)))) return undefined
    return { ...record, name: { ...entry.verifiedName }, programUrl: entry.verifiedSourceUrl ?? record.programUrl }
  }
}
