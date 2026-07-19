import { z } from 'zod'

export const FEEDBACK_MESSAGE_MAX_LENGTH = 2_000
export const FEEDBACK_BODY_MAX_BYTES = 16 * 1024

const optionalString = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim().length === 0
        ? undefined
        : value,
    schema.optional(),
  )

const httpUrl = z
  .string()
  .trim()
  .max(2_048)
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === 'https:' || protocol === 'http:'
  }, 'Only HTTP(S) URLs are accepted')

export const feedbackRequestSchema = z
  .object({
    category: z.enum([
      'incorrect-data',
      'broken-link',
      'suggest-program',
      'other',
    ]),
    message: z
      .string()
      .trim()
      .min(1)
      .refine(
        (value) => Array.from(value).length <= FEEDBACK_MESSAGE_MAX_LENGTH,
        `Message must contain at most ${FEEDBACK_MESSAGE_MAX_LENGTH} characters`,
      ),
    sourceUrl: optionalString(httpUrl),
    replyEmail: optionalString(z.string().trim().email().max(254)),
    pageUrl: httpUrl,
    recordId: optionalString(
      z
        .string()
        .trim()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9:_-]+$/),
    ),
    consent: z.literal(true),
    turnstileToken: z.string().trim().min(1).max(2_048),
    website: z.string().trim().max(256).optional().default(''),
  })
  .strict()

export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>

export async function readFeedbackJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json')) {
    throw new FeedbackBodyError('Expected application/json')
  }

  const declaredSize = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > FEEDBACK_BODY_MAX_BYTES) {
    throw new FeedbackBodyError('Request body is too large')
  }

  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > FEEDBACK_BODY_MAX_BYTES) {
    throw new FeedbackBodyError('Request body is too large')
  }

  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new FeedbackBodyError('Malformed JSON')
  }
}

export class FeedbackBodyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeedbackBodyError'
  }
}
