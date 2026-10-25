import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { deserialize } from 'node:v8'
import { ProxyAgent, setGlobalDispatcher } from 'undici'
import { z } from 'zod'
import { canonicalJson, sha256Schema, sourceSeedSchema } from './contracts'
import { openLocalRuntime } from './local-runtime'
import { OFFLINE_TABLES, offlineArtifactKeySchema, offlineHandoffSchema, offlineRequestReservationSchema,
  type OfflineHandoff, type OfflineTableName } from '../../workers/catalog-maintenance/src/offline-handoff-contract'
import { digest, record } from '../../workers/catalog-maintenance/src/util'

const SERVICE = 'https://studyinchina-catalog-maintenance.13022037121.workers.dev'
const MAX_MANIFEST = 8 * 1024 * 1024
const fenceSchema = z.object({ batchId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/u), token: sha256Schema,
  scopeRegistrySha256: sha256Schema, inputCatalogSha256: sha256Schema, seedSha256: sha256Schema,
  legacyGuardSha256: sha256Schema, sourceManifestSha256: sha256Schema }).strict()
type Fence = z.infer<typeof fenceSchema>
type Runtime = Awaited<ReturnType<typeof openLocalRuntime>>
export type StageLocalHandoffOptions = { directory: string; sourceFile: string; workerUrl: string; adminToken: string; upload: boolean }

function readJson(path: string): unknown {
  if (lstatSync(path).isSymbolicLink()) throw new Error('handoff_symlink_rejected')
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error('handoff_json_invalid') }
}
function immutableFile(path: string, text: string): void {
  if (existsSync(path)) {
    if (lstatSync(path).isSymbolicLink() || readFileSync(path, 'utf8') !== text) throw new Error('handoff_file_immutable_conflict')
    return
  }
  const file = openSync(path, 'wx', 0o600)
  try { writeFileSync(file, text); fsyncSync(file) } finally { closeSync(file) }
}
function assertPins(manifest: OfflineHandoff, fence: Fence): void {
  for (const key of ['batchId', 'scopeRegistrySha256', 'inputCatalogSha256', 'seedSha256', 'legacyGuardSha256'] as const) {
    if (manifest[key] !== fence[key]) throw new Error('handoff_fence_pin_mismatch')
  }
}
async function pack(runtime: Runtime, directory: string, fence: Fence, sourceFile: string): Promise<OfflineHandoff> {
  const sourceBytes = readFileSync(resolve(sourceFile), 'utf8')
  if (await digest(sourceBytes) !== fence.sourceManifestSha256) throw new Error('handoff_source_manifest_changed')
  const input = record(JSON.parse(sourceBytes))
  if (!Array.isArray(input?.sources)) throw new Error('handoff_source_manifest_invalid')
  const sources = input.sources.map(value => sourceSeedSchema.parse(value)).filter(value => value.enabled)
  const ids = [...new Set(await Promise.all(sources.map(source => digest(source.url))))].sort()
  if (!ids.length || ids.length > 20) throw new Error('handoff_source_count_invalid')
  const cfg = runtime.db.sqlite.prepare('SELECT * FROM maintenance_control WHERE singleton=1').get()
  if (!cfg || cfg.seed_complete !== 1 || cfg.targets_complete !== 1 || cfg.scope_sha256 !== fence.scopeRegistrySha256
    || cfg.input_catalog_sha256 !== fence.inputCatalogSha256 || cfg.seed_sha256 !== fence.seedSha256
    || cfg.legacy_guard_sha256 !== fence.legacyGuardSha256) throw new Error('handoff_local_control_pin_mismatch')
  const frozenPath = join(directory, 'handoff.json')
  if (existsSync(frozenPath)) {
    const frozen = offlineHandoffSchema.parse(readJson(frozenPath)); assertPins(frozen, fence)
    if (canonicalJson(frozen) !== readFileSync(frozenPath, 'utf8')) throw new Error('handoff_manifest_not_canonical')
    if (frozen.tableRows.maintenance_sources.some(source => !ids.includes(source.source_id))
      || ids.some(id => !frozen.tableRows.maintenance_sources.some(source => source.source_id === id))) throw new Error('handoff_frozen_source_scope_changed')
    return frozen
  }
  // SQL identifiers come only from the production contract. Source IDs are bound.
  const rows = Object.fromEntries(Object.keys(OFFLINE_TABLES).map(table => [table, []])) as unknown as OfflineHandoff['tableRows']
  const placeholders = ids.map(() => '?').join(',')
  for (const table of Object.keys(OFFLINE_TABLES) as OfflineTableName[]) {
    if (table === 'maintenance_exports') continue
    const shape = OFFLINE_TABLES[table]
    const selected = runtime.db.sqlite.prepare(`SELECT ${shape.columns.join(',')} FROM ${table} WHERE source_id IN(${placeholders}) ORDER BY ${shape.primaryKeys.join(',')}`).all(...ids)
    ;(rows as Record<string, unknown[]>)[table] = selected
  }
  if (rows.maintenance_sources.length !== ids.length) throw new Error('handoff_selected_source_missing')
  if (rows.maintenance_jobs.some(job => (job.status as string) === 'running' || job.lease_token !== null || job.lease_until !== null)) throw new Error('handoff_local_jobs_still_running')
  const exports = [...new Set(rows.maintenance_proposals.flatMap(proposal => proposal.export_id ? [proposal.export_id] : []))].sort()
  for (const batchId of exports) {
    const outside = runtime.db.sqlite.prepare(`SELECT COUNT(*) count FROM maintenance_proposals WHERE export_id=? AND source_id NOT IN(${placeholders})`).get(batchId, ...ids)
    if (outside?.count !== 0) throw new Error('handoff_export_crosses_source_scope')
    const row = runtime.db.sqlite.prepare(`SELECT ${OFFLINE_TABLES.maintenance_exports.columns.join(',')} FROM maintenance_exports WHERE batch_id=? AND status='prepared'`).get(batchId)
    if (!row) throw new Error('handoff_prepared_export_missing')
    rows.maintenance_exports.push(row as OfflineHandoff['tableRows']['maintenance_exports'][number])
  }
  const artifacts: OfflineHandoff['artifacts'] = []
  for (const artifact of await runtime.bucket.list()) {
    if (/^maintenance\/bootstrap\/[a-f0-9]{64}\.json$/u.test(artifact.key)) continue
    if (!offlineArtifactKeySchema.safeParse(artifact.key).success) throw new Error('handoff_unexpected_artifact_namespace')
    if (artifact.byteLength < 1 || artifact.byteLength > 10 * 1024 * 1024) throw new Error('handoff_artifact_size_invalid')
    const object = await runtime.bucket.get(artifact.key)
    if (!object || object.size !== artifact.byteLength || await digest(await object.arrayBuffer()) !== artifact.sha256) throw new Error('handoff_artifact_checksum_mismatch')
    artifacts.push({ objectKey: artifact.key, sha256: artifact.sha256, byteLength: artifact.byteLength })
  }
  const durable = new DatabaseSync(join(directory, 'durable.sqlite'), { readOnly: true })
  const requestReservations: OfflineHandoff['requestReservations'] = []
  try {
    const keys = new Set(rows.maintenance_model_attempts.map(attempt => attempt.reservation_key))
    for (const stored of durable.prepare("SELECT namespace,key,value FROM local_durable_values WHERE key LIKE 'request:%' ORDER BY key").all()) {
      const reservationKey = String(stored.key).slice(8)
      if (stored.namespace !== 'subscription-account-v1' || !keys.has(reservationKey)) throw new Error('handoff_unassociated_durable_reservation')
      const value = record(deserialize(Buffer.from(stored.value as Uint8Array)))
      if (!value) throw new Error('handoff_durable_reservation_invalid')
      // Completed output is already an immutable artifact. Never copy its
      // in-memory result, credentials, permits or unrelated durable gate state.
      requestReservations.push(offlineRequestReservationSchema.parse({ reservationKey, state: value.state,
        attemptId: value.attemptId, requestSha256: value.requestSha256,
        ...(value.retryable !== undefined ? { retryable: value.retryable } : {}),
        ...(value.notBefore !== undefined ? { notBefore: value.notBefore } : {}),
        ...(value.attemptCount !== undefined ? { attemptCount: value.attemptCount } : {}) }))
    }
  } finally { durable.close() }
  const manifest = offlineHandoffSchema.parse({ format: 'studyinchina.offline-maintenance-handoff', version: 1,
    batchId: fence.batchId, scopeRegistrySha256: fence.scopeRegistrySha256, inputCatalogSha256: fence.inputCatalogSha256,
    seedSha256: fence.seedSha256, legacyGuardSha256: fence.legacyGuardSha256, artifacts, tableRows: rows, requestReservations })
  const text = canonicalJson(manifest)
  if (Buffer.byteLength(text) > MAX_MANIFEST) throw new Error('handoff_manifest_too_large')
  // This is also the runner's freeze marker. It exists before the first upload.
  immutableFile(frozenPath, text)
  return manifest
}

/** Packs durable evidence only. Uploads stage bytes for cloud validation; they
 * never execute a model, accept a fact, release a fence or publish the catalogue. */
export async function stageLocalHandoff(options: StageLocalHandoffOptions) {
  const directory = resolve(options.directory)
  const parsedFence = fenceSchema.safeParse(readJson(join(directory, 'fence-private.json')))
  if (!parsedFence.success) throw new Error('handoff_private_fence_invalid')
  const fence = parsedFence.data
  let remote: URL | undefined
  if (options.upload) {
    remote = new URL(options.workerUrl)
    if (remote.origin !== SERVICE || remote.pathname !== '/' || remote.username || remote.password || remote.search || remote.hash) throw new Error('unexpected_maintenance_service')
    if (options.adminToken.length < 24) throw new Error('maintenance_admin_credential_unavailable')
  }
  const runtime = await openLocalRuntime({ directory })
  try {
    const manifest = await pack(runtime, directory, fence, options.sourceFile), text = canonicalJson(manifest)
    const manifestSha256 = await digest(text), byteLength = Buffer.byteLength(text)
    const metadata = { format: 'studyinchina.local-handoff-freeze', version: 1, batchId: fence.batchId,
      manifestSha256, byteLength, sourceManifestSha256: fence.sourceManifestSha256,
      artifactCount: manifest.artifacts.length, rowCount: Object.values(manifest.tableRows).reduce((sum, rows) => sum + rows.length, 0),
      requestReservationCount: manifest.requestReservations.length }
    immutableFile(join(directory, 'handoff-meta.json'), canonicalJson(metadata))
    let artifactsUploaded = 0, artifactsReused = 0, manifestUploaded = false
    if (options.upload) {
      const checkpoint = join(directory, 'handoff-upload'); mkdirSync(checkpoint, { recursive: true, mode: 0o700 })
      const send = async (url: URL, body: Uint8Array, hashHeader: string, expected: Record<string, unknown>) => {
        const response = await fetch(url, { method: 'POST', redirect: 'error', headers: {
          authorization: `Bearer ${options.adminToken}`, 'x-offline-token': fence.token,
          // Fixed bytes let native fetch supply Content-Length. Setting that
          // header explicitly is incompatible with the current Node/ProxyAgent transport.
          [hashHeader]: await digest(body), 'content-type': 'application/octet-stream',
        }, body: body as BodyInit, signal: AbortSignal.timeout(60000) })
        if (!response.ok) throw new Error(`handoff_upload_http_${response.status}`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length > 128 * 1024) throw new Error('handoff_upload_receipt_too_large')
        let receipt: Record<string, unknown> | null
        try { receipt = record(JSON.parse(new TextDecoder().decode(bytes))) } catch { throw new Error('handoff_upload_receipt_invalid') }
        if (!receipt || Object.entries(expected).some(([key, value]) => receipt[key] !== value)) throw new Error('handoff_upload_receipt_mismatch')
      }
      for (const artifact of manifest.artifacts) {
        const path = join(checkpoint, `${await digest(artifact.objectKey)}.json`)
        const receipt = canonicalJson({ batchId: fence.batchId, manifestSha256, ...artifact, transportStaged: true, verified: false })
        if (existsSync(path)) { immutableFile(path, receipt); artifactsReused++; continue }
        const object = await runtime.bucket.get(artifact.objectKey)
        if (!object) throw new Error('handoff_frozen_artifact_missing')
        const bytes = new Uint8Array(await object.arrayBuffer())
        if (bytes.length !== artifact.byteLength || await digest(bytes) !== artifact.sha256) throw new Error('handoff_frozen_artifact_changed')
        const url = new URL('/offline-handoff/artifact', remote); url.searchParams.set('batchId', fence.batchId); url.searchParams.set('key', artifact.objectKey)
        await send(url, bytes, 'x-artifact-sha256', { ok: true, staged: true, verified: false, objectKey: artifact.objectKey, sha256: artifact.sha256 })
        immutableFile(path, receipt); artifactsUploaded++
      }
      const path = join(checkpoint, 'manifest.json'), receipt = canonicalJson({ batchId: fence.batchId, manifestSha256, transportStaged: true, validation: 'pending-queue', released: false })
      if (existsSync(path)) immutableFile(path, receipt)
      else {
        const url = new URL('/offline-handoff/manifest', remote); url.searchParams.set('batchId', fence.batchId)
        await send(url, new TextEncoder().encode(text), 'x-manifest-sha256', { ok: true, staged: true, validation: 'pending-queue', released: false, batchId: fence.batchId, manifestSha256 })
        immutableFile(path, receipt); manifestUploaded = true
      }
    }
    return { ...metadata, manifestPath: join(directory, 'handoff.json'), uploadRequested: options.upload,
      artifactsUploaded, artifactsReused, manifestUploaded, cloudValidationComplete: false, canonicalPublished: false }
  } finally { await runtime.close() }
}

async function main() {
  const args = process.argv.slice(2), option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
  if (process.env.HTTPS_PROXY) setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY))
  console.log(JSON.stringify(await stageLocalHandoff({ directory: option('--directory') ?? '.pipeline-build/maintenance-private/local-pilot',
    sourceFile: option('--sources') ?? 'scripts/maintenance/pilot-sources.json', workerUrl: process.env.CATALOG_MAINTENANCE_URL ?? '',
    adminToken: process.env.CATALOG_MAINTENANCE_TOKEN ?? '', upload: args.includes('--upload') })))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  console.error('local_handoff_failed; keep the frozen manifest and private journal for reconciliation')
  process.exitCode = 1
})
