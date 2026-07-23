import type { SourceManifestV1 } from './types'

export const DEFAULT_RETRY_DELAYS_SECONDS = [15 * 60, 2 * 60 * 60, 12 * 60 * 60, 24 * 60 * 60]

export function retryDelaySeconds(
  attempts: number,
  requestedDelay?: number,
): number {
  if (requestedDelay !== undefined && Number.isFinite(requestedDelay)) {
    return Math.max(1, Math.min(24 * 60 * 60, Math.ceil(requestedDelay)))
  }
  const index = Math.max(0, Math.min(DEFAULT_RETRY_DELAYS_SECONDS.length - 1, attempts - 1))
  return DEFAULT_RETRY_DELAYS_SECONDS[index] ?? DEFAULT_RETRY_DELAYS_SECONDS.at(-1)!
}

export function parseRetryAfter(value: string | null, now = new Date()): number | undefined {
  if (!value) return undefined
  if (/^\d+$/.test(value.trim())) {
    return Math.max(1, Math.min(24 * 60 * 60, Number.parseInt(value.trim(), 10)))
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return Math.max(1, Math.min(24 * 60 * 60, Math.ceil((date.getTime() - now.getTime()) / 1_000)))
}

function deterministicJitterMinutes(sourceId: string, maximum: number, epochHours: number): number {
  if (maximum <= 0) return 0
  let hash = 2_166_136_261
  for (const character of `${sourceId}:${epochHours}`) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0) % (maximum + 1)
}

export function nextFetchAt(
  manifest: Pick<SourceManifestV1, 'id' | 'schedule'>,
  from = new Date(),
): string {
  const intervalMs = manifest.schedule.intervalHours * 60 * 60 * 1_000
  const epochHours = Math.floor(from.getTime() / (60 * 60 * 1_000))
  const jitter = deterministicJitterMinutes(
    manifest.id,
    manifest.schedule.jitterMinutes ?? 0,
    epochHours,
  )
  return new Date(from.getTime() + intervalMs + jitter * 60 * 1_000).toISOString()
}

export function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}
