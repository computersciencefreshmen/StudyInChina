import { readBackgroundBudgetGate } from '../../shared/background-budget'
import type { MaintenanceEnv } from './types'
import { digest, HASH, json } from './util'

const MAX_BYTES = 4 * 1024 * 1024

/** Called only behind the maintenance authorization and account-migration gates.
 * The caller supplies the source digest, never an arbitrary bucket key. */
export async function storeSicasEvidence(request: Request, env: MaintenanceEnv, sha256: string) {
  if (!HASH.test(sha256) || request.headers.get('content-type') !== 'application/octet-stream') return json({ error: 'invalid_evidence' }, 400)
  const source = request.headers.get('x-source-url') ?? ''
  if (source.length > 2048 || !/^https:\/\/www\.sicas\.com\.cn\/School\/\d+\/[^/?#\\\s]+\/\d+\/[^/?#\\\s]+$/u.test(source)
    || /%2f|%5c|%00/iu.test(source) || new URL(source).href !== source) return json({ error: 'invalid_source' }, 400)
  if (Number(request.headers.get('content-length')) > MAX_BYTES) return json({ error: 'evidence_too_large' }, 413)
  const gate = await readBackgroundBudgetGate(env.SNAPSHOTS_BUCKET)
  if (!gate.allowed) return json({ error: 'budget_wait' }, 503)
  const reader = request.body?.getReader()
  if (!reader) return json({ error: 'missing_evidence' }, 400)
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.length
      if (bytes > MAX_BYTES) { await reader.cancel(); return json({ error: 'evidence_too_large' }, 413) }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
  if (!bytes || await digest(body) !== sha256) return json({ error: 'evidence_hash_mismatch' }, 422)
  const key = `maintenance/provider-evidence/sicas/${sha256.slice(0, 2)}/${sha256}.bin`
  await env.SNAPSHOTS_BUCKET.put(key, body, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/octet-stream' } })
  return json({ stored: true, sourceUrl: source, sha256, bytes })
}
