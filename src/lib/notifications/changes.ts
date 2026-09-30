import { createHash } from 'node:crypto'

export type FollowTarget = { kind: 'university' | 'program'; id: string }
export type PublishedObservation = {
  id: string
  kind: FollowTarget['kind']
  universityId: string
  fingerprint: string
  verified: boolean
  title: string
  slug: string
}
export type PublishedUpdate = PublishedObservation & { eventId: string; change: 'created' | 'updated'; observationKey?: string }
export type PublishedEvent = PublishedUpdate & { publishedAt: number }
export type ObservationBaseline = Record<string, Pick<PublishedObservation, 'fingerprint' | 'verified'>>

const auditFields = new Set(['lastVerified', 'verifiedAt', 'reviewAfter', 'status', 'accessedAt', 'checkedAt', 'sourceIds', 'featured'])

/** Only facts that affect a visitor's decision belong in an opportunity fingerprint. */
export function meaningfulFingerprint(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize)
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry)
        .filter(([key]) => !auditFields.has(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalize(item)]))
    }
    return entry
  }
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')
}

/** Initial observation establishes a baseline; candidates never notify. */
export function publishedUpdates(previous: ObservationBaseline | null, current: Record<string, PublishedObservation>): PublishedUpdate[] {
  if (!previous) return []
  return Object.entries(current)
    .filter(([key, item]) => item.verified && (!previous[key]?.verified || previous[key]?.fingerprint !== item.fingerprint))
    .map(([key, item]) => ({
      ...item,
      observationKey: key,
      eventId: createHash('sha256').update(`${key}:${item.fingerprint}`).digest('hex'),
      change: previous[key]?.verified ? 'updated' : 'created',
    }))
}

/** Keep the last verified fingerprint through withdrawal/expiry to avoid renewal-only alerts. */
export function nextObservationBaseline(previous: ObservationBaseline | null, current: Record<string, PublishedObservation>): ObservationBaseline {
  const baseline = { ...previous }
  for (const [key, item] of Object.entries(current)) {
    if (item.verified || !baseline[key]) baseline[key] = { fingerprint: item.fingerprint, verified: item.verified }
  }
  return baseline
}

export function matchesFollowedUpdate(targets: FollowTarget[], event: PublishedObservation): boolean {
  return targets.some(target => target.kind === 'program'
    ? event.kind === 'program' && target.id === event.id
    : target.id === event.universityId)
}
