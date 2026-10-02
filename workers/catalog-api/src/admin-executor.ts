import { z } from 'zod'
import { executorCommandSchema, verificationOptionsSchema } from '../../../src/lib/admin/executor-contract'
import type { ExecutorCommand } from '../../../src/lib/admin/types'
import type { CatalogApiEnv, R2Bucket, R2ObjectBody } from './types'

export const ADMIN_EXECUTOR_OBJECT = 'admin-executor/queue.v1.json'
export const ADMIN_EXECUTOR_ID = 'studyinchina-local-minimax'
export const ADMIN_COMMAND_TTL_MS = 5 * 60_000
export const ADMIN_COMMAND_LEASE_MS = 60_000
export const ADMIN_EXECUTOR_MAX_BYTES = 128 * 1_024
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const timestamp = z.string().datetime({ offset: false })
const executorId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)
const errorCode = z.enum(['execution_failed', 'execution_outcome_unknown', 'command_expired'])
const entrySchema = z.object({
  commandId: z.string().uuid(), action: z.enum(['pause', 'resume', 'start']), options: verificationOptionsSchema.optional(),
  status: z.enum(['pending', 'claimed', 'completed', 'failed', 'expired']),
  createdAt: timestamp, expiresAt: timestamp, updatedAt: timestamp,
  executorId: executorId.nullable(), attemptId: z.string().uuid().nullable(), leaseExpiresAt: timestamp.nullable(), error: errorCode.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.action === 'start') !== Boolean(value.options)) context.addIssue({ code: 'custom', message: 'Only start requires options' })
  if (Date.parse(value.expiresAt) - Date.parse(value.createdAt) !== ADMIN_COMMAND_TTL_MS) context.addIssue({ code: 'custom', message: 'Invalid command expiry' })
  if (value.status === 'claimed' && (!value.executorId || !value.attemptId || !value.leaseExpiresAt)) context.addIssue({ code: 'custom', message: 'Claim identity required' })
})
export type ExecutorQueueEntry = z.infer<typeof entrySchema>
export const executorQueueSchema = z.object({ version: z.literal(1), observedAt: timestamp, commands: z.array(entrySchema).max(100) }).strict().superRefine((value, context) => {
  if (new Set(value.commands.map(command => command.commandId)).size !== value.commands.length) context.addIssue({ code: 'custom', message: 'Duplicate command ID' })
})
type Queue = z.infer<typeof executorQueueSchema>
const reservationSchema = z.object({ version: z.literal(1), command: executorCommandSchema, createdAt: timestamp, expiresAt: timestamp }).strict()
const patchSchema = z.object({
  operation: z.enum(['claim', 'renew', 'complete']), commandId: z.string().uuid(), executorId, attemptId: z.string().uuid(),
  result: z.enum(['completed', 'failed']).optional(), error: z.enum(['execution_failed', 'execution_outcome_unknown']).optional(),
}).strict().superRefine((value, context) => {
  if ((value.operation === 'complete') !== Boolean(value.result)) context.addIssue({ code: 'custom', message: 'Only completion has a result' })
  if (value.error && (value.operation !== 'complete' || value.result !== 'failed')) context.addIssue({ code: 'custom', message: 'Only failed completion has an error' })
})
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers })
class QueueFailure extends Error { constructor(readonly code: string, readonly status = 409) { super(code) } }

function authorized(request: Request, configured: string | undefined) {
  if (!configured || configured.length < 32) return false
  const supplied = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${configured}`
  let mismatch = supplied.length ^ expected.length
  for (let index = 0; index < Math.max(supplied.length, expected.length); index++) mismatch |= (supplied.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0)
  return mismatch === 0
}
async function boundedObject(object: R2ObjectBody): Promise<unknown> {
  if (!object.text || object.size === undefined || object.size > ADMIN_EXECUTOR_MAX_BYTES) throw new QueueFailure('executor_unavailable', 503)
  const value = await object.text()
  if (new TextEncoder().encode(value).length > ADMIN_EXECUTOR_MAX_BYTES) throw new QueueFailure('executor_unavailable', 503)
  return JSON.parse(value)
}
async function boundedBody(request: Request): Promise<unknown> {
  if (!request.body || Number(request.headers.get('content-length')) > 8 * 1_024) throw new QueueFailure('invalid_command', 400)
  const reader = request.body.getReader()
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const value = await reader.read()
      if (value.done) break
      size += value.value.byteLength
      if (size > 8 * 1_024) { await reader.cancel(); throw new QueueFailure('invalid_command', 400) }
      chunks.push(value.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new QueueFailure('invalid_command', 400) }
}
function expire(queue: Queue, now: number): Queue {
  return { ...queue, commands: queue.commands.map(command => {
    if (command.status === 'pending' && Date.parse(command.expiresAt) <= now) return { ...command, status: 'expired', updatedAt: new Date(now).toISOString(), error: 'command_expired' }
    // A crashed worker may have acted before losing its acknowledgement. Never redispatch it.
    if (command.status === 'claimed' && Date.parse(command.leaseExpiresAt!) <= now) return { ...command, status: 'failed', updatedAt: new Date(now).toISOString(), error: 'execution_outcome_unknown' }
    return command
  }) }
}
async function mutate<T>(bucket: R2Bucket, now: number, update: (queue: Queue) => { queue: Queue; result: T }): Promise<T> {
  if (!bucket.put) throw new QueueFailure('executor_unavailable', 503)
  for (let attempt = 0; attempt < 5; attempt++) {
    const saved = await bucket.get(ADMIN_EXECUTOR_OBJECT)
    const initial = saved ? executorQueueSchema.parse(await boundedObject(saved)) : { version: 1 as const, observedAt: new Date(now).toISOString(), commands: [] }
    const changed = update(expire(initial, now))
    const active = changed.queue.commands.filter(command => command.status === 'pending' || command.status === 'claimed')
    const terminal = changed.queue.commands.filter(command => command.status !== 'pending' && command.status !== 'claimed').slice(-(100 - active.length))
    const queue = executorQueueSchema.parse({ ...changed.queue, observedAt: new Date(now).toISOString(), commands: [...terminal, ...active] })
    if (saved && !saved.etag) throw new QueueFailure('executor_unavailable', 503)
    const onlyIf = saved ? { etagMatches: saved.etag! } : new Headers({ 'If-None-Match': '*' })
    const result = await bucket.put(ADMIN_EXECUTOR_OBJECT, JSON.stringify(queue), { onlyIf, httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' } })
    if (result) return changed.result
  }
  throw new QueueFailure('executor_busy', 503)
}
async function reserve(bucket: R2Bucket, command: ExecutorCommand, now: number) {
  if (!bucket.put) throw new QueueFailure('executor_unavailable', 503)
  // UUID tombstones remain separate from bounded queue history, preventing later replay.
  const key = `admin-executor/command-ids/${command.commandId}.v1.json`
  const existing = await bucket.get(key)
  if (existing) {
    const saved = reservationSchema.parse(await boundedObject(existing))
    if (JSON.stringify(saved.command) !== JSON.stringify(command)) throw new QueueFailure('command_id_conflict')
    return { value: saved, duplicate: true }
  }
  const value = { version: 1 as const, command, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ADMIN_COMMAND_TTL_MS).toISOString() }
  const saved = await bucket.put(key, JSON.stringify(value), { onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' } })
  if (saved) return { value, duplicate: false }
  const raced = await bucket.get(key)
  if (!raced) throw new QueueFailure('executor_busy', 503)
  const result = reservationSchema.parse(await boundedObject(raced))
  if (JSON.stringify(result.command) !== JSON.stringify(command)) throw new QueueFailure('command_id_conflict')
  return { value: result, duplicate: true }
}

/** Private queue contains typed tasks, never arbitrary executables, paths or shell strings. */
export async function handleAdminExecutor(request: Request, env: CatalogApiEnv, now = Date.now()): Promise<Response> {
  if (!authorized(request, env.ADMIN_TELEMETRY_TOKEN)) return reply({ error: 'forbidden' }, 403)
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, POST, PATCH' } })
  try {
    if (request.method === 'GET') {
      const saved = await env.RELEASES_BUCKET.get(ADMIN_EXECUTOR_OBJECT)
      const queue = saved ? executorQueueSchema.parse(await boundedObject(saved)) : { version: 1 as const, observedAt: new Date(now).toISOString(), commands: [] }
      return reply(expire(queue, now))
    }
    if (request.method === 'POST') {
      const parsed = executorCommandSchema.safeParse(await boundedBody(request))
      if (!parsed.success) return reply({ error: 'invalid_command' }, 400)
      const reservation = await reserve(env.RELEASES_BUCKET, parsed.data, now)
      return reply(await mutate(env.RELEASES_BUCKET, now, queue => {
        const prior = queue.commands.find(command => command.commandId === parsed.data.commandId)
        if (prior) return { queue, result: { ok: true, duplicate: true, command: prior } }
        const expired = Date.parse(reservation.value.expiresAt) <= now
        // A permanent reservation outlives bounded history. An ambiguous lost enqueue is
        // surfaced for review instead of reconstructing a command that may already have run.
        const uncertain = reservation.duplicate && !expired
        if (!expired && !uncertain && queue.commands.filter(command => command.status === 'pending' || command.status === 'claimed').length >= 10) throw new QueueFailure('executor_queue_full')
        const command: ExecutorQueueEntry = { ...parsed.data, status: expired ? 'expired' : uncertain ? 'failed' : 'pending', createdAt: reservation.value.createdAt, expiresAt: reservation.value.expiresAt,
          updatedAt: new Date(now).toISOString(), executorId: null, attemptId: null, leaseExpiresAt: null, error: expired ? 'command_expired' : uncertain ? 'execution_outcome_unknown' : null }
        return { queue: { ...queue, commands: [...queue.commands, command] }, result: { ok: true, duplicate: reservation.duplicate, command } }
      }), 202)
    }
    const parsed = patchSchema.safeParse(await boundedBody(request))
    if (!parsed.success) return reply({ error: 'invalid_command' }, 400)
    const patch = parsed.data
    if (patch.executorId !== (env.ADMIN_EXECUTOR_ID || ADMIN_EXECUTOR_ID)) return reply({ error: 'wrong_executor' }, 403)
    return reply(await mutate(env.RELEASES_BUCKET, now, queue => {
      const prior = queue.commands.find(command => command.commandId === patch.commandId)
      if (!prior) throw new QueueFailure('command_unavailable', 404)
      let command: ExecutorQueueEntry
      if (patch.operation === 'claim') {
        if (prior.status === 'claimed' && prior.executorId === patch.executorId && prior.attemptId === patch.attemptId) return { queue, result: { ok: true, command: prior } }
        if (prior.status !== 'pending') throw new QueueFailure('command_not_pending')
        if (queue.commands.some(value => value.status === 'claimed')) throw new QueueFailure('executor_busy')
        command = { ...prior, status: 'claimed', executorId: patch.executorId, attemptId: patch.attemptId, updatedAt: new Date(now).toISOString(), leaseExpiresAt: new Date(now + ADMIN_COMMAND_LEASE_MS).toISOString() }
      } else {
        if (prior.executorId !== patch.executorId || prior.attemptId !== patch.attemptId) throw new QueueFailure('command_claim_mismatch')
        if (patch.operation === 'complete' && (prior.status === 'completed' || prior.status === 'failed') && prior.status === patch.result) return { queue, result: { ok: true, command: prior } }
        if (prior.status !== 'claimed') throw new QueueFailure('command_not_claimed')
        command = patch.operation === 'renew' ? { ...prior, updatedAt: new Date(now).toISOString(), leaseExpiresAt: new Date(now + ADMIN_COMMAND_LEASE_MS).toISOString() }
          : { ...prior, status: patch.result!, updatedAt: new Date(now).toISOString(), error: patch.result === 'failed' ? patch.error || 'execution_failed' : null }
      }
      return { queue: { ...queue, commands: queue.commands.map(value => value.commandId === command.commandId ? command : value) }, result: { ok: true, command } }
    }))
  } catch (error) {
    return error instanceof QueueFailure ? reply({ error: error.code }, error.status) : reply({ error: 'executor_unavailable' }, 503)
  }
}
