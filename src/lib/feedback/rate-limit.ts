export const FEEDBACK_RATE_LIMIT = 5
export const FEEDBACK_RATE_WINDOW_SECONDS = 60 * 60
const FEEDBACK_RATE_WINDOW_MS = FEEDBACK_RATE_WINDOW_SECONDS * 1_000

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

type MemoryEntry = {
  count: number
  expiresAt: number
  deletionTimer?: ReturnType<typeof setTimeout>
}

export class MemoryFeedbackRateLimiter {
  private readonly entries = new Map<string, MemoryEntry>()

  constructor(private readonly now: () => number = Date.now) {}

  consume(key: string): RateLimitResult {
    const currentTime = this.now()
    let entry = this.entries.get(key)

    if (!entry || entry.expiresAt <= currentTime) {
      if (entry?.deletionTimer) clearTimeout(entry.deletionTimer)

      const expiresAt = currentTime + FEEDBACK_RATE_WINDOW_MS
      const deletionTimer = setTimeout(() => {
        const currentEntry = this.entries.get(key)
        if (currentEntry?.expiresAt === expiresAt) this.entries.delete(key)
      }, FEEDBACK_RATE_WINDOW_MS)

      // Avoid keeping a Node.js process alive solely for local-development cleanup.
      if (typeof deletionTimer === 'object' && 'unref' in deletionTimer) {
        deletionTimer.unref()
      }

      entry = { count: 0, expiresAt, deletionTimer }
      this.entries.set(key, entry)
    }

    entry.count += 1
    return {
      allowed: entry.count <= FEEDBACK_RATE_LIMIT,
      remaining: Math.max(0, FEEDBACK_RATE_LIMIT - entry.count),
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((entry.expiresAt - currentTime) / 1_000),
      ),
    }
  }
}

const developmentLimiter = new MemoryFeedbackRateLimiter()

type RateLimitEnvironment = Pick<
  NodeJS.ProcessEnv,
  'UPSTASH_REDIS_REST_URL' | 'UPSTASH_REDIS_REST_TOKEN' | 'NODE_ENV'
>

type RateLimitOptions = {
  environment?: RateLimitEnvironment
  fetcher?: typeof fetch
}

type UpstashPipelineResult = Array<{ result?: unknown; error?: string }>

export async function consumeFeedbackRateLimit(
  hashedIp: string,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const environment = options.environment ?? process.env
  const fetcher = options.fetcher ?? fetch
  const redisUrl = environment.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, '')
  const redisToken = environment.UPSTASH_REDIS_REST_TOKEN

  if (!redisUrl || !redisToken) {
    if (environment.NODE_ENV === 'production') {
      throw new Error('Distributed feedback rate limiting is not configured')
    }
    return developmentLimiter.consume(hashedIp)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)

  try {
    const response = await fetcher(`${redisUrl}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redisToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', `feedback:rate:${hashedIp}`],
        [
          'EXPIRE',
          `feedback:rate:${hashedIp}`,
          String(FEEDBACK_RATE_WINDOW_SECONDS),
          'NX',
        ],
        ['TTL', `feedback:rate:${hashedIp}`],
      ]),
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) throw new Error('Rate limit service request failed')

    const payload = (await response.json()) as UpstashPipelineResult
    const count = Number(payload[0]?.result)
    const ttl = Number(payload[2]?.result)
    if (
      !Number.isSafeInteger(count) ||
      count < 1 ||
      !Number.isSafeInteger(ttl) ||
      ttl < 1 ||
      payload.some((command) => Boolean(command.error))
    ) {
      throw new Error('Rate limit service returned an invalid response')
    }

    return {
      allowed: count <= FEEDBACK_RATE_LIMIT,
      remaining: Math.max(0, FEEDBACK_RATE_LIMIT - count),
      retryAfterSeconds: ttl,
    }
  } finally {
    clearTimeout(timeout)
  }
}
