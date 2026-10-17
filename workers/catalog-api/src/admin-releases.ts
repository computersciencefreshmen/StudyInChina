import { rollbackReleaseSchema, rollbackReceiptSchema, type AdminReleaseHistory, type RollbackReleaseReceipt, type RollbackReleaseRequest } from '../../../src/lib/admin/release-contract'
import { deploymentMachineRequestSchema, deploymentRollbackSchema } from '../../../src/lib/admin/deployment-release-contract'
import { ADMIN_RELEASE_MAX_BYTES, readReleaseWriter, releaseDigest, ReleaseControlError, reserveDeploymentWriter, updateDeploymentWriter } from './admin-release-writer'
import type { CatalogApiEnv } from './types'

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
function authorized(request: Request, token: string | undefined) {
  if (!token || token.length < 32) return false
  const actual = request.headers.get('authorization') || '', expected = `Bearer ${token}`
  let mismatch = actual.length ^ expected.length
  for (let index = 0; index < Math.max(actual.length, expected.length); index++) mismatch |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0)
  return mismatch === 0
}
async function readBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json') || !request.body || Number(request.headers.get('content-length')) > ADMIN_RELEASE_MAX_BYTES) throw new ReleaseControlError('invalid_request', 400)
  const reader = request.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > ADMIN_RELEASE_MAX_BYTES) { await reader.cancel(); throw new ReleaseControlError('invalid_request', 400) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new ReleaseControlError('invalid_request', 400) }
}
type ReleaseRow = { release_id: string; data_version: number; generated_at: string; activated_at: string | null; release_status: 'active' | 'retired' | 'purged'; content_sha256: string; compatibility_content_sha256: string | null }
type RollbackRow = { command_id: string; previous_release_id: string; target_release_id: string; expected_revision: number; reason: string; actor: string; completed_at: string; expected_content_sha256: string; expected_compatibility_sha256: string }
function receipt(row: RollbackRow): RollbackReleaseReceipt {
  return rollbackReceiptSchema.parse({ commandId: row.command_id, kind: 'catalog', previousId: row.previous_release_id,
    targetId: row.target_release_id, revision: row.expected_revision + 1, reason: row.reason, actor: row.actor, completedAt: row.completed_at })
}
export async function readAdminReleaseHistory(env: CatalogApiEnv, now = Date.now()): Promise<AdminReleaseHistory> {
  let catalog: AdminReleaseHistory['catalog'] = { backend: 'd1', currentId: null, revision: null,
    available: false, reason: 'release_backend_unavailable', versions: [] }
  let auditRows: RollbackReleaseReceipt[] = []
  try {
    const pointer = await env.CATALOG_DB.prepare('SELECT p.current_release_id, r.revision FROM release_pointer p JOIN release_pointer_revision r ON r.singleton_id = p.singleton_id WHERE p.singleton_id = 1').first<{ current_release_id: string | null; revision: number }>()
    const versions = await env.CATALOG_DB.prepare(`SELECT r.release_id, r.data_version, r.generated_at, r.activated_at, r.release_status, r.content_sha256, a.content_sha256 AS compatibility_content_sha256
    FROM catalog_releases r LEFT JOIN release_compatibility_artifacts a ON a.release_id = r.release_id
    WHERE r.release_status IN ('active', 'retired') ORDER BY r.data_version DESC LIMIT 30`).all<ReleaseRow>()
  const tombstones = await env.CATALOG_DB.prepare(`SELECT release_id, data_version, purged_at AS generated_at, activated_at, 'purged' AS release_status, content_sha256, NULL AS compatibility_content_sha256 FROM release_retention_audit ORDER BY data_version DESC LIMIT 20`).all<ReleaseRow>()
  const audit = await env.CATALOG_DB.prepare('SELECT * FROM admin_release_rollbacks ORDER BY completed_at DESC LIMIT 50').all<RollbackRow>()
    if (!versions.success || !tombstones.success || !audit.success) throw new Error('catalog_unavailable')
    catalog = { backend: 'd1', currentId: pointer?.current_release_id ?? null, revision: pointer?.revision ?? null,
      available: Boolean(pointer?.current_release_id && env.ADMIN_RELEASE_CONTROL_ENABLED === 'true'), reason: env.ADMIN_RELEASE_CONTROL_ENABLED === 'true' ? null : 'release_control_disabled',
      versions: [...versions.results ?? [], ...tombstones.results ?? []].map(row => ({ id: row.release_id, dataVersion: row.data_version,
        generatedAt: row.generated_at, activatedAt: row.activated_at, status: row.release_status,
        contentSha256: row.content_sha256, compatibilitySha256: row.compatibility_content_sha256,
        rollbackAvailable: row.release_status === 'retired' && Boolean(row.compatibility_content_sha256) })) }
    auditRows = (audit.results ?? []).map(receipt)
  } catch { /* A missing catalog migration must not pretend to offer data rollback or hide real deployment control. */ }
  const writer = await readReleaseWriter(env)
  const registry = writer?.state.registry
  const age = registry ? now - Date.parse(registry.observedAt) : Infinity
  const blocked = writer?.state.command && ['pending', 'claimed', 'uncertain'].includes(writer.state.command.status)
  return {
    observedAt: new Date(now).toISOString(),
    catalog,
    interface: { currentId: registry?.currentId ?? null, available: Boolean(registry), alias: registry?.alias ?? null,
      revision: registry?.revision ?? null, registrySha256: registry ? await releaseDigest(JSON.stringify(registry)) : null,
      rollbackAvailable: Boolean(registry && age >= -5_000 && age <= 30_000 && !blocked && env.ADMIN_RELEASE_CONTROL_ENABLED === 'true'),
      reason: !registry ? 'deployment_registry_unavailable' : blocked ? writer?.state.command?.status === 'uncertain' ? 'deployment_outcome_uncertain' : 'release_writer_busy' : age < -5_000 || age > 30_000 ? 'release_registry_stale' : env.ADMIN_RELEASE_CONTROL_ENABLED !== 'true' ? 'release_control_disabled' : 'deployment_guarded_writer',
      command: writer?.state.command ?? null,
      history: writer?.state.recentCommands ?? [],
      versions: registry?.versions.map(version => ({ id: version.id, createdAt: version.createdAt,
        deploymentUrl: version.deploymentUrl, commitSha: version.commitSha, current: version.id === registry.currentId })) ?? [] },
    audit: auditRows,
  }
}
export async function rollbackCatalogRelease(env: CatalogApiEnv, input: RollbackReleaseRequest, now = Date.now()) {
  const request = rollbackReleaseSchema.parse(input)
  if (env.ADMIN_RELEASE_CONTROL_ENABLED !== 'true') throw new ReleaseControlError('release_control_disabled', 503)
  const existing = await env.CATALOG_DB.prepare('SELECT * FROM admin_release_rollbacks WHERE command_id = ?1').bind(request.commandId).first<RollbackRow>()
  if (existing) {
    if (existing.previous_release_id !== request.expectedCurrentId || existing.target_release_id !== request.targetId || existing.expected_revision !== request.expectedRevision || existing.reason !== request.reason || existing.expected_content_sha256 !== request.expectedTargetSha256 || existing.expected_compatibility_sha256 !== request.expectedCompatibilitySha256) throw new ReleaseControlError('release_conflict')
    return receipt(existing)
  }
  const target = await env.CATALOG_DB.prepare(`SELECT r.content_sha256, r.release_status, a.artifact_key, a.content_sha256 AS artifact_sha256, a.byte_length FROM catalog_releases r JOIN release_compatibility_artifacts a ON a.release_id = r.release_id WHERE r.release_id = ?1`).bind(request.targetId).first<{ content_sha256: string; release_status: string; artifact_key: string; artifact_sha256: string; byte_length: number }>()
  if (!target || target.release_status !== 'retired' || target.content_sha256 !== request.expectedTargetSha256 || target.artifact_sha256 !== request.expectedCompatibilitySha256 || target.artifact_key !== `releases/${request.targetId}/compat-envelope.json`) throw new ReleaseControlError('release_not_available', 400)
  const object = await env.RELEASES_BUCKET.get(target.artifact_key)
  if (!object?.body || object.size !== target.byte_length || object.size > 20 * 1024 * 1024) throw new ReleaseControlError('release_artifact_invalid', 503)
  const reader = object.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > target.byte_length) { await reader.cancel(); throw new ReleaseControlError('release_artifact_invalid', 503) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  if (length !== target.byte_length || await releaseDigest(bytes) !== target.artifact_sha256) throw new ReleaseControlError('release_artifact_invalid', 503)
  try {
    const result = await env.CATALOG_DB.prepare(`INSERT INTO admin_release_rollbacks (command_id, previous_release_id, target_release_id, expected_revision, expected_content_sha256, expected_compatibility_sha256, reason, actor, completed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'admin-workbench', ?8)`)
      .bind(request.commandId, request.expectedCurrentId, request.targetId, request.expectedRevision, request.expectedTargetSha256, request.expectedCompatibilitySha256, request.reason, new Date(now).toISOString()).all()
    if (!result.success) throw new Error(result.error)
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('release_conflict')) throw new ReleaseControlError('release_conflict')
    if (cause instanceof Error && /release_not_available|release_counts_invalid/.test(cause.message)) throw new ReleaseControlError('release_not_available', 400)
    throw new ReleaseControlError('release_backend_unavailable', 503)
  }
  const saved = await env.CATALOG_DB.prepare('SELECT * FROM admin_release_rollbacks WHERE command_id = ?1').bind(request.commandId).first<RollbackRow>()
  if (!saved) throw new ReleaseControlError('release_backend_unavailable', 503)
  return receipt(saved)
}
export async function handleAdminReleases(request: Request, env: CatalogApiEnv, now = Date.now()) {
  if (!authorized(request, env.ADMIN_TELEMETRY_TOKEN)) return json({ error: 'forbidden' }, 403)
  try {
    if (request.method === 'GET') {
      if (new URL(request.url).searchParams.get('writer') === '1') {
        const writer = await readReleaseWriter(env)
        return json({ state: writer?.state ?? null, registrySha256: writer ? await releaseDigest(JSON.stringify(writer.state.registry)) : null, controlEnabled: env.ADMIN_RELEASE_CONTROL_ENABLED === 'true' })
      }
      return json(await readAdminReleaseHistory(env, now))
    }
    if (request.method === 'PUT') {
      const parsed = deploymentMachineRequestSchema.safeParse(await readBody(request))
      if (!parsed.success) return json({ error: 'invalid_request' }, 400)
      return json({ ok: true, result: await updateDeploymentWriter(env, parsed.data, now) })
    }
    if (request.method === 'POST') {
      const body = await readBody(request)
      const data = rollbackReleaseSchema.safeParse(body)
      if (data.success) return json({ accepted: true, receipt: await rollbackCatalogRelease(env, data.data, now) })
      const deployment = deploymentRollbackSchema.safeParse(body)
      if (deployment.success) return json({ accepted: true, command: await reserveDeploymentWriter(env, deployment.data, 'deployment-rollback', now) }, 202)
      return json({ error: 'invalid_request' }, 400)
    }
    return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, POST, PUT' } })
  } catch (cause) {
    if (cause instanceof ReleaseControlError) return json({ error: cause.code }, cause.status)
    return json({ error: 'release_backend_unavailable' }, 503)
  }
}
