import 'server-only'
import {
  consumeFeedbackRateLimit,
  MemoryFeedbackRateLimiter,
  type RateLimitResult,
} from '@/lib/feedback/rate-limit'

type AdminRateLimitEnvironment = Pick<
  NodeJS.ProcessEnv,
  'UPSTASH_REDIS_REST_URL' | 'UPSTASH_REDIS_REST_TOKEN' | 'NODE_ENV'
> & { ADMIN_LOGIN_RATE_LIMIT_MODE?: string }

type AdminRateLimitOptions = {
  environment?: AdminRateLimitEnvironment
  fetcher?: typeof fetch
}

// The explicit small-usage mode has its own counters, independent of feedback.
// Counters apply only to this process and reset on restart or serverless cold start.
const adminMemoryLimiter = new MemoryFeedbackRateLimiter()

export async function consumeAdminLoginRateLimit(
  hashedIp: string,
  options: AdminRateLimitOptions = {},
): Promise<RateLimitResult> {
  const environment = options.environment ?? process.env
  if (environment.ADMIN_LOGIN_RATE_LIMIT_MODE === 'memory') {
    return adminMemoryLimiter.consume(hashedIp)
  }

  // Missing/unknown modes retain distributed production limiting, including
  // refusing login if its configuration or Redis service is unavailable.
  return consumeFeedbackRateLimit(`admin-login:${hashedIp}`, options)
}
