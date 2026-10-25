import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { maintenanceCandidateExportSchema, exportContentSha256, canonicalJson, type CandidateExport } from '../maintenance/contracts'
import type { CanonicalMaintenanceReceipt } from './prepare-maintenance-catalog'

export type MaintenanceClient = {
  json(path: string, method?: 'GET' | 'POST', body?: unknown): Promise<unknown>
  artifact(key: string): Promise<Uint8Array>
}

/** A known shared-quota or initial-seed wait is normal, not a failed export. */
export async function maintenanceRuntimeGate(client: MaintenanceClient) {
  const status = await client.json('/status') as { format?: string; backend?: { state?: string }; enabled?: boolean;
    control?: { seed_complete?: number; targets_complete?: number } | null }
  if (status.format !== 'studyinchina.cloud-maintenance-status') throw new Error('maintenance_runtime_status_invalid')
  if (status.backend?.state === 'quota_wait') return { canRecover: false, canStart: false, reason: 'quota_wait' }
  if (status.backend?.state !== 'ready') throw new Error('maintenance_backend_unavailable')
  const canRecover = status.control?.seed_complete === 1
  return { canRecover, canStart: canRecover && status.enabled === true && status.control?.targets_complete === 1,
    reason: !canRecover ? 'seed_not_ready' : !status.enabled ? 'operator_pause' : status.control?.targets_complete !== 1 ? 'targets_not_ready' : 'ready' }
}
export function maintenanceClientFromEnvironment(environment: Record<string, string | undefined>, fetcher: typeof fetch = fetch): MaintenanceClient {
  let origin: URL
  try { origin = new URL(environment.CATALOG_MAINTENANCE_URL ?? '') } catch { throw new Error('maintenance_configuration_unavailable') }
  const token = environment.CATALOG_MAINTENANCE_TOKEN
  if (origin.protocol !== 'https:' || !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/u.test(origin.hostname)
    || origin.port || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || !token || token.length < 32 || /[\r\n]/u.test(token)) {
    throw new Error('maintenance_configuration_unavailable')
  }
  const request = async (path: string, method: 'GET' | 'POST', body?: unknown): Promise<Response> => {
    const handoffRead = method === 'GET' && body === undefined
      && /^\/(?:offline-fence|offline-handoff\?batchId=[a-zA-Z0-9_-]{1,101})$/u.test(path)
    if (!handoffRead && !/^\/(?:status|rollout|schools|reconciliations|seed|targets|controls|tick|publications|documents(?:\?limit=[1-5])?|exports(?:\/[a-zA-Z0-9_-]+)?|ack|artifacts\?key=[a-zA-Z0-9%_.-]+)$/u.test(path)) throw new Error('maintenance_endpoint_rejected')
    const url = new URL(path, origin)
    try {
      const response = await fetcher(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(60_000) })
      if (!response.ok || response.redirected || (response.url && new URL(response.url).origin !== origin.origin)) throw new Error('maintenance_http_error')
      return response
    } catch { throw new Error('maintenance_request_failed') }
  }
  const bytes = async (response: Response, maximum: number): Promise<Uint8Array> => {
    if (!response.body || Number(response.headers.get('content-length')) > maximum) throw new Error('maintenance_response_too_large')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength
        if (length > maximum) { await reader.cancel(); throw new Error('maintenance_response_too_large') }; chunks.push(chunk.value) }
    } finally { reader.releaseLock() }
    return Buffer.concat(chunks)
  }
  return {
    async json(path, method = 'GET', body) {
      const response = await request(path, method, body)
      if (response.status === 204) return null
      const data = await bytes(response, 8 * 1024 * 1024)
      try { return JSON.parse(new TextDecoder().decode(data)) } catch { throw new Error('maintenance_json_invalid') }
    },
    async artifact(key) {
      if (!/^maintenance\/[a-zA-Z0-9_./-]+$/u.test(key) || key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('maintenance_artifact_key_rejected')
      return bytes(await request(`/artifacts?key=${encodeURIComponent(key)}`, 'GET'), 10 * 1024 * 1024)
    },
  }
}

export function candidateArtifactKeys(batch: CandidateExport): string[] {
  return [...new Set(batch.proposals.flatMap(proposal => [proposal.source.objectKey,
    proposal.source.textArtifact?.objectKey, ...proposal.fieldEvidence.map(evidence => evidence.objectKey),
    ...['internationalAdmissionsEvidence', 'institutionEvidence'].map(field => proposal.fields[field]
      && typeof proposal.fields[field] === 'object' ? (proposal.fields[field] as Record<string, unknown>).objectKey : undefined),
    proposal.review?.artifactKey].filter((value): value is string => typeof value === 'string')))].sort()
}

/** Resume the exact acknowledged commit, rather than inventing a new commit for an old receipt. */
export async function recoverPendingMaintenancePublication(client: MaintenanceClient, root: string) {
  const response = await client.json('/publications') as { publications?: Array<Record<string, unknown>> }
  if (!Array.isArray(response.publications) || response.publications.length > 100) throw new Error('maintenance_publications_response_invalid')
  const pending = response.publications[0]
  if (!pending) return null
  const ack = pending.acknowledgement as Record<string, unknown> | undefined
  if (pending.status !== 'applied' || typeof pending.batchId !== 'string' || !/^[a-zA-Z0-9_-]{1,140}$/u.test(pending.batchId)
    || !ack || ack.batchId !== pending.batchId || typeof ack.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/u.test(ack.sourceCommit)
    || typeof ack.receiptSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(ack.receiptSha256)) throw new Error('maintenance_publication_binding_invalid')
  const receiptPath = resolve(root, 'quality', 'maintenance', 'batches', pending.batchId, 'canonical-receipt.json')
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as CanonicalMaintenanceReceipt
  const { sha256, ...content } = receipt
  const hash = createHash('sha256').update(canonicalJson(content)).digest('hex')
  if (hash !== sha256 || sha256 !== ack.receiptSha256 || receipt.batchId !== pending.batchId
    || receipt.inputCatalogSha256 !== pending.inputCatalogSha256 || receipt.scopeRegistrySha256 !== pending.scopeRegistrySha256
    || receipt.outputCatalogSha256 !== ack.newInputCatalogSha256
    || canonicalJson([...receipt.acceptedProposalIds].sort()) !== canonicalJson(ack.acceptedProposalIds)
    || canonicalJson(receipt.held.map(entry => entry.proposalId).sort()) !== canonicalJson(ack.heldProposalIds)
    || canonicalJson([...(receipt.unchangedProposalIds ?? [])].sort()) !== canonicalJson(ack.unchangedProposalIds ?? [])) throw new Error('maintenance_publication_receipt_changed')
  return { batchId: pending.batchId, sourceCommit: ack.sourceCommit, receiptPath }
}

export async function downloadMaintenanceExport(client: MaintenanceClient, directory: string, limit = 100): Promise<CandidateExport | null> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('maintenance_export_limit_invalid')
  const reserved = await client.json('/exports', 'POST', { limit }) as Record<string, unknown>
  if (reserved === null) return null
  if (typeof reserved.batchId !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(reserved.batchId)) throw new Error('maintenance_export_identity_invalid')
  const batch = maintenanceCandidateExportSchema.parse(await client.json(`/exports/${reserved.batchId}`))
  if (batch.batchId !== reserved.batchId || batch.sha256 !== reserved.sha256 || batch.sha256 !== await exportContentSha256(batch)
    || batch.proposals.length !== reserved.proposalCount) throw new Error('maintenance_export_binding_invalid')
  const root = resolve(directory), artifacts = resolve(root, 'artifacts')
  await mkdir(artifacts, { recursive: true })
  // An identical immutable download is resumable; different bytes never overwrite a prior receipt.
  const save = async (path: string, value: Uint8Array) => {
    try { await writeFile(path, value, { flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !Buffer.from(await readFile(path)).equals(Buffer.from(value))) throw new Error('maintenance_download_conflict') }
  }
  for (const key of candidateArtifactKeys(batch)) {
    const destination = resolve(artifacts, key), subpath = relative(artifacts, destination)
    if (subpath.startsWith('..') || isAbsolute(subpath)) throw new Error('maintenance_artifact_path_escape')
    await mkdir(dirname(destination), { recursive: true })
    await save(destination, await client.artifact(key))
  }
  await save(resolve(root, 'export.json'), Buffer.from(JSON.stringify(batch, null, 2) + '\n'))
  await save(resolve(root, 'download-receipt.json'), Buffer.from(JSON.stringify({ batchId: batch.batchId, batchSha256: batch.sha256,
    artifacts: candidateArtifactKeys(batch), exportFileSha256: createHash('sha256').update(JSON.stringify(batch, null, 2) + '\n').digest('hex') }, null, 2) + '\n'))
  return batch
}

async function main() {
  const [action, value] = process.argv.slice(2), client = maintenanceClientFromEnvironment(process.env)
  if (action === 'recover-publication' && !value) {
    const pending = await recoverPendingMaintenancePublication(client, process.cwd())
    if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT,
      `pending_publication=${Boolean(pending)}\n${pending ? `source_commit=${pending.sourceCommit}\nreceipt=${pending.receiptPath}\n` : ''}`, { flag: 'a' })
    console.log(JSON.stringify({ pendingPublication: Boolean(pending), batchId: pending?.batchId ?? null })); return
  }
  if (['status', 'schools', 'rollout'].includes(action) && !value) { console.log(JSON.stringify(await client.json(`/${action}`))); return }
  if (action === 'runtime-gate' && !value) {
    const gate = await maintenanceRuntimeGate(client)
    if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT,
      `can_recover=${gate.canRecover}\ncan_start=${gate.canStart}\nreason=${gate.reason}\n`, { flag: 'a' })
    console.log(JSON.stringify(gate)); return
  }
  if (action === 'advance-rollout' && !value) {
    const state = await client.json('/rollout') as { format?: string; backendState?: string; state?: string; expectedRevision?: number; reasons?: string[] }
    if (state.format !== 'studyinchina.maintenance-rollout') throw new Error('maintenance_rollout_status_invalid')
    if (state.backendState !== 'ready' || state.state !== 'eligible' || !Number.isSafeInteger(state.expectedRevision)) {
      console.log(JSON.stringify({ advanced: false, reasons: state.reasons ?? ['rollout_not_ready'] })); return
    }
    console.log(JSON.stringify(await client.json('/rollout', 'POST', { expectedRevision: state.expectedRevision }))); return
  }
  if (action === 'download' && value) {
    const batch = await downloadMaintenanceExport(client, value)
    if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `has_export=${Boolean(batch)}\n`, { flag: 'a' })
    console.log(JSON.stringify({ batchId: batch?.batchId ?? null, proposals: batch?.proposals.length ?? 0 })); return
  }
  if (['seed', 'targets', 'controls', 'ack', 'reconciliations'].includes(action) && value) {
    const body = JSON.parse(await readFile(resolve(value), 'utf8'))
    const result = await client.json(`/${action}`, 'POST', body)
    console.log(JSON.stringify(result)); return
  }
  if (action === 'tick' && !value) { console.log(JSON.stringify(await client.json('/tick', 'POST', {}))); return }
  throw new Error('Usage: catalog-maintenance-client.ts status | schools | tick | recover-publication | download <directory> | seed|targets|controls|ack|reconciliations <body.json>')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error instanceof Error && error.message.startsWith('maintenance_') ? error.message : 'maintenance_command_failed'); process.exitCode = 1 })
