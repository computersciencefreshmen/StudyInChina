import { z } from 'zod'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const timestamp = z.string().datetime()
export const minimaxContinuousStatusSchema = z.object({
  schemaVersion: z.literal(1),
  policyVersion: z.literal('minimax-continuous-once-v1'),
  model: z.literal('MiniMax-M3'),
  phase: z.enum(['idle', 'capturing', 'reviewing-candidates', 'preparing-records', 'reviewing-record', 'publishing', 'waiting', 'paused', 'blocked', 'complete']),
  reason: z.enum(['heartbeat_ready', 'heartbeat_already_completed', 'finite_pass_complete', 'official_source_capture', 'unpaid_candidate_review',
    'source_bound_record_prepare', 'source_bound_record_review', 'approved_publication', 'manual_pause', 'authorization_missing',
    'existing_worker_preserved', 'failure_budget_exhausted', 'bounded_failure_backoff', 'quota_or_billing_admission_stopped', 'paid_admission_stopped',
    'no_actionable_work', 'stage_revalidation_required', 'ambiguous_paid_outcome', 'engineering_failure']),
  updatedAt: timestamp, nextCheckAt: timestamp.nullable(), heartbeatId: z.string().max(100).nullable(),
  desiredState: z.enum(['running', 'paused']), active: z.boolean(),
  reviewer: z.object({ completed: count, failed: count, consecutiveFailures: count }).strict(),
  fullRecord: z.object({ completed: count, failed: count, consecutiveFailures: count, pending: count, approvedPublications: count }).strict(),
  sources: z.object({ programsCaptured: count, captures: count, lastCapturedAt: timestamp.nullable() }).strict(),
  budgets: z.object({ candidateReviews: count, fullRecords: count, capturePrograms: count }).strict(),
  extractorConsecutiveFailures: count.nullable(),
  usageLedgerPath: z.literal('.tmp/minimax-verification/usage-ledger.json'),
  sourceFactsInterpretedByCodex: z.literal(false), paidReplayAllowed: z.literal(false),
}).strict()
export type MiniMaxContinuousStatus = z.infer<typeof minimaxContinuousStatusSchema>
export const MINIMAX_CONTINUOUS_STATUS_PATH = '.tmp/minimax-continuous-pipeline/status.json'
