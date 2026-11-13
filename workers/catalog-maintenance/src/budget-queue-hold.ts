import pin from '../../../content/maintenance/head-reconciliation-2026-11-10.v1.json'
import type { MaintenanceEnv, MaintenanceMessage } from './types'
import { MaintenanceError } from './types'
import { canonical, digest, HASH, nowIso, record } from './util'

export const BUDGET_QUEUE_HOLD_PREFIX = 'maintenance/runtime/budget-queue-holds/pending/'
export const BUDGET_QUEUE_HOLD_DONE_PREFIX = 'maintenance/runtime/budget-queue-holds/done/'
const MAX_MARKER_BYTES = 4096
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
const options = { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } }
type Hold = { format: 'studyinchina.maintenance-budget-queue-hold'; version: 1; holdId: string;
  heldAt: string; messageSha256: string; message: MaintenanceMessage }
export type BudgetHoldDrain = { supported: boolean; sent: number; failed: number; code: string }

function keys(value: Record<string, unknown>, allowed: string[], required = allowed) {
  return Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key))
}

/** These continuations lack another durable scheduler pointer. Ordinary jobs
 * and model reservations must keep their existing recovery and unknown rules. */
export function isBudgetHoldMessage(value: unknown): value is MaintenanceMessage {
  const raw = record(value)
  if (!raw || raw.version !== 1 || typeof raw.jobId !== 'string' || !HASH.test(raw.jobId)) return false
  if (keys(raw, ['version', 'jobId', 'discoveryManifestSha256', 'discoveryOffset'], ['version', 'jobId', 'discoveryManifestSha256'])) {
    return raw.discoveryManifestSha256 === raw.jobId && (raw.discoveryOffset === undefined || Number.isSafeInteger(raw.discoveryOffset) && Number(raw.discoveryOffset) >= 0)
  }
  if (!keys(raw, ['version', 'jobId', 'reconciliationTargetsUpload'])) return false
  const upload = record(raw.reconciliationTargetsUpload)
  const prefix = `maintenance/reconciliation/${pin.operationId}/target-uploads/${pin.targetUpload.sha256}/`
  return Boolean(upload && keys(upload, ['manifestSha256', 'bodySha256', 'byteLength', 'expectedRevision', 'uploadKey'])
    && upload.manifestSha256 === pin.sha256 && upload.bodySha256 === pin.targetUpload.sha256 && raw.jobId === upload.bodySha256
    && upload.byteLength === pin.targetUpload.byteLength && Number.isSafeInteger(upload.expectedRevision) && Number(upload.expectedRevision) >= 0
    && typeof upload.uploadKey === 'string' && upload.uploadKey.startsWith(prefix) && UUID.test(upload.uploadKey.slice(prefix.length, -5)) && upload.uploadKey.endsWith('.json'))
}

async function readMarker(env: MaintenanceEnv, key: string) {
  const saved = await env.SNAPSHOTS_BUCKET.get(key)
  if (!saved) return null
  if (saved.size !== undefined && saved.size > MAX_MARKER_BYTES) throw new MaintenanceError('budget_held_marker_invalid_requires_review')
  const text = await saved.text()
  if (new TextEncoder().encode(text).byteLength > MAX_MARKER_BYTES) throw new MaintenanceError('budget_held_marker_invalid_requires_review')
  return text
}

async function writeConfirmed(env: MaintenanceEnv, key: string, text: string) {
  await env.SNAPSHOTS_BUCKET.put(key, text, options)
  if (await readMarker(env, key) !== text) throw new MaintenanceError('budget_held_marker_unconfirmed')
}

/** Unique epochs prevent an older drain from deleting a later hold of the same
 * message. Done receipts are audit evidence, never an execution/seen gate. */
export async function holdBudgetQueueMessage(env: MaintenanceEnv, message: unknown, now = Date.now()): Promise<boolean> {
  if (!isBudgetHoldMessage(message) || !env.SNAPSHOTS_BUCKET.list || !env.SNAPSHOTS_BUCKET.delete) return false
  const messageSha256 = await digest(canonical(message)), holdId = crypto.randomUUID()
  const marker: Hold = { format: 'studyinchina.maintenance-budget-queue-hold', version: 1, holdId, heldAt: nowIso(now), messageSha256, message }
  await writeConfirmed(env, `${BUDGET_QUEUE_HOLD_PREFIX}${messageSha256}-${holdId}.json`, canonical(marker))
  return true
}

async function parseMarker(env: MaintenanceEnv, key: string): Promise<Hold> {
  const text = await readMarker(env, key), raw = text === null ? null : record(JSON.parse(text))
  if (!raw || !keys(raw, ['format', 'version', 'holdId', 'heldAt', 'messageSha256', 'message'])
    || raw.format !== 'studyinchina.maintenance-budget-queue-hold' || raw.version !== 1
    || typeof raw.holdId !== 'string' || !UUID.test(raw.holdId) || typeof raw.heldAt !== 'string' || !Number.isFinite(Date.parse(raw.heldAt))
    || typeof raw.messageSha256 !== 'string' || !HASH.test(raw.messageSha256) || !isBudgetHoldMessage(raw.message)
    || key !== `${BUDGET_QUEUE_HOLD_PREFIX}${raw.messageSha256}-${raw.holdId}.json`
    || await digest(canonical(raw.message)) !== raw.messageSha256) throw new MaintenanceError('budget_held_marker_invalid_requires_review')
  return raw as unknown as Hold
}

async function confirmDone(env: MaintenanceEnv, key: string, hold: Hold, pendingKey: string) {
  const receipt = canonical({ format: 'studyinchina.maintenance-budget-queue-requeued', version: 1,
    holdId: hold.holdId, messageSha256: hold.messageSha256, pendingKey, requeuedAt: nowIso() })
  // Concurrent/repeated drains may have already confirmed the same send epoch.
  // Validate that receipt rather than overwriting its original timestamp.
  if (await readMarker(env, key) === null) await env.SNAPSHOTS_BUCKET.put(key, receipt, options)
  const saved = await readMarker(env, key), raw = saved === null ? null : record(JSON.parse(saved))
  if (!raw || !keys(raw, ['format', 'version', 'holdId', 'messageSha256', 'pendingKey', 'requeuedAt'])
    || raw.format !== 'studyinchina.maintenance-budget-queue-requeued' || raw.version !== 1 || raw.holdId !== hold.holdId
    || raw.messageSha256 !== hold.messageSha256 || raw.pendingKey !== pendingKey
    || typeof raw.requeuedAt !== 'string' || !Number.isFinite(Date.parse(raw.requeuedAt))) throw new MaintenanceError('budget_held_receipt_unconfirmed')
}

/** One bounded list and at most eight sends. Queue acceptance precedes a
 * confirmed done receipt and deletion; a crash may replay, but never loses the
 * original cursor or marks a model attempt complete. */
export async function drainBudgetQueueHolds(env: MaintenanceEnv): Promise<BudgetHoldDrain> {
  const bucket = env.SNAPSHOTS_BUCKET
  if (!bucket.list || !bucket.delete) return { supported: false, sent: 0, failed: 0, code: 'budget_held_drain_unavailable' }
  const page = await bucket.list({ prefix: BUDGET_QUEUE_HOLD_PREFIX, limit: 8 })
  let sent = 0, failed = 0
  for (const object of page.objects.slice(0, 8)) {
    try {
      const hold = await parseMarker(env, object.key)
      await env.MAINTENANCE_QUEUE.send(hold.message)
      sent++
      const receiptKey = `${BUDGET_QUEUE_HOLD_DONE_PREFIX}${hold.messageSha256}-${hold.holdId}.json`
      await confirmDone(env, receiptKey, hold, object.key)
      await bucket.delete(object.key)
      if (await bucket.get(object.key) !== null) throw new MaintenanceError('budget_held_marker_delete_unconfirmed')
    } catch { failed++ }
  }
  return { supported: true, sent, failed, code: failed ? 'budget_held_messages_require_review' : sent ? 'budget_held_messages_requeued' : 'budget_held_messages_empty' }
}
