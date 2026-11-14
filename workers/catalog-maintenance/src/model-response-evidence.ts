import { readBoundedBody } from '../../ingestion/src/body'
import { IngestionError } from '../../ingestion/src/errors'
import type { MaintenanceEnv, ModelRequest } from './types'
import type { FlashAudit } from './flash-canary'
import { canonical, digest, record } from './util'

export const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024
export type ProviderResponseRef = { objectKey: string; sha256: string; byteLength: number; httpStatus: number;
  body: { objectKey: string; sha256: string; byteLength: number } }
export class ModelResponseEvidenceError extends Error {
  constructor() { super('model_response_evidence_unconfirmed') }
}

async function immutable(env: MaintenanceEnv, key: string, bytes: Uint8Array, sha256: string, contentType: string) {
  const before = await env.SNAPSHOTS_BUCKET.get(key)
  if (before) {
    if (before.size !== undefined && before.size !== bytes.length || await digest(await before.arrayBuffer()) !== sha256) throw new ModelResponseEvidenceError()
  } else await env.SNAPSHOTS_BUCKET.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType } })
  const after = await env.SNAPSHOTS_BUCKET.get(key)
  if (!after || after.size !== undefined && after.size !== bytes.length || await digest(await after.arrayBuffer()) !== sha256) throw new ModelResponseEvidenceError()
}

/** Preserve the exact bounded bytes delivered by fetch, without credentials or
 * request payload. Only a fully consumed body is eligible for known-failure
 * classification. A partial/oversized body remains an ambiguous sent outcome. */
export async function archiveModelResponse(env: MaintenanceEnv, response: Response, input: ModelRequest, attemptId: string,
  requestSha256: string, requestedModel: string, signal: AbortSignal, modelProfile?: FlashAudit) {
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) throw new ModelResponseEvidenceError()
  let buffer: ArrayBuffer
  try { buffer = await readBoundedBody(response, MAX_PROVIDER_RESPONSE_BYTES, signal) }
  catch (error) {
    // A completely observed empty HTTP response is an invalid output, distinct
    // from a body stream/network failure. No partial prefix is called complete.
    if (error instanceof IngestionError && error.code === 'empty_response') buffer = new ArrayBuffer(0)
    else throw error
  }
  const bytes = new Uint8Array(buffer), declared = response.headers.get('content-length'), encoding = response.headers.get('content-encoding')
  if ((!encoding || encoding === 'identity') && declared !== null && /^\d+$/.test(declared) && Number(declared) !== bytes.length) throw new ModelResponseEvidenceError()
  const bodySha256 = await digest(bytes), prefix = `maintenance/provider-responses/${input.reservationKey}`
  const bodyRef = { objectKey: `${prefix}/${bodySha256}.bin`, sha256: bodySha256, byteLength: bytes.length }
  try { await immutable(env, bodyRef.objectKey, bytes, bodySha256, 'application/octet-stream') } catch { throw new ModelResponseEvidenceError() }
  let body: Record<string, unknown> | null = null
  try { body = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) } catch { /* Original bytes remain authoritative. */ }
  const evidence = { format: 'studyinchina.model-provider-response', version: 1, attemptId, reservationKey: input.reservationKey, requestSha256,
    sourceId: input.sourceId, snapshotSha256: input.snapshotSha256, pass: input.pass, requestedModel, httpStatus: response.status,
    receivedAt: new Date().toISOString(), body: bodyRef, complete: true, jsonObject: body !== null,
    reportedModel: typeof body?.model === 'string' && body.model.length <= 160 ? body.model : null,
    stopReason: typeof body?.stop_reason === 'string' && body.stop_reason.length <= 160 ? body.stop_reason : null,
    usage: body?.usage ?? null, ...(modelProfile ? { modelProfile } : {}) }
  const text = canonical(evidence), evidenceBytes = new TextEncoder().encode(text), evidenceSha256 = await digest(evidenceBytes)
  const reference: ProviderResponseRef = { objectKey: `${prefix}/${evidenceSha256}.json`, sha256: evidenceSha256, byteLength: evidenceBytes.length, httpStatus: response.status, body: bodyRef }
  try { await immutable(env, reference.objectKey, evidenceBytes, evidenceSha256, 'application/json') } catch { throw new ModelResponseEvidenceError() }
  // Existing top-level usage metrics remain readable; complete raw usage is
  // also immutable in the evidence/body. Missing usage is never invented as 0.
  const usage = { ...(record(body?.usage) ?? { usage: body?.usage ?? null }), providerResponse: reference }
  return { body, reference, usage }
}
