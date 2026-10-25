import { deploymentMachineRequestSchema, deploymentRollbackSchema, deploymentWriterStateSchema, type DeploymentMachineRequest, type DeploymentRollbackRequest, type DeploymentWriterCommand, type DeploymentWriterState } from '../../../src/lib/admin/deployment-release-contract'
import type { CatalogApiEnv } from './types'

export const ADMIN_RELEASE_WRITER_OBJECT = 'admin-releases/writer.v1.json'
export const ADMIN_RELEASE_MAX_BYTES = 256 * 1024
// This withdrawn deployment removed public facts and must never enter a rollback registry.
export const WITHDRAWN_DEPLOYMENTS = new Set(['dpl_CJMi3PjUjKSeL7oRFRgNvDyC5vqf'])
export class ReleaseControlError extends Error {
  constructor(public code: string, public status = 409) { super(code) }
}
export async function releaseDigest(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function readReleaseWriter(env: CatalogApiEnv) {
  const object = await env.RELEASES_BUCKET.get(ADMIN_RELEASE_WRITER_OBJECT)
  if (!object) return null
  if (!object.text || !object.etag || object.size === undefined || object.size > ADMIN_RELEASE_MAX_BYTES) throw new ReleaseControlError('release_backend_unavailable', 503)
  const text = await object.text()
  if (new TextEncoder().encode(text).byteLength > ADMIN_RELEASE_MAX_BYTES) throw new ReleaseControlError('release_backend_unavailable', 503)
  return { state: deploymentWriterStateSchema.parse(JSON.parse(text)), etag: object.etag }
}
const blocking = (command: DeploymentWriterCommand | null) => command && ['pending', 'claimed', 'uncertain'].includes(command.status)
const COMPACT_PROJECT = 'prj_AgYJcsuat4kmLiinlvcBbZsYY3cg', COMPACT_ALIAS = 'studyinchina.vercel.app'
async function immutableReceipt(env: CatalogApiEnv, key: string, value: unknown) {
  if (!env.RELEASES_BUCKET.put) throw new ReleaseControlError('release_backend_unavailable', 503)
  const content = JSON.stringify(value)
  const existing = await env.RELEASES_BUCKET.get(key)
  if (existing) {
    if (!existing.text || existing.size === undefined || existing.size > ADMIN_RELEASE_MAX_BYTES || await existing.text() !== content) throw new ReleaseControlError('release_receipt_conflict')
    return
  }
  const written = await env.RELEASES_BUCKET.put(key, content, { onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' } })
  if (!written) {
    const raced = await env.RELEASES_BUCKET.get(key)
    if (!raced?.text || await raced.text() !== content) throw new ReleaseControlError('release_receipt_conflict')
  }
}
async function saveWriter(env: CatalogApiEnv, previous: Awaited<ReturnType<typeof readReleaseWriter>>, state: DeploymentWriterState) {
  if (!env.RELEASES_BUCKET.put) throw new ReleaseControlError('release_backend_unavailable', 503)
  const content = JSON.stringify(deploymentWriterStateSchema.parse(state))
  if (new TextEncoder().encode(content).byteLength > ADMIN_RELEASE_MAX_BYTES) throw new ReleaseControlError('release_backend_unavailable', 503)
  const saved = await env.RELEASES_BUCKET.put(ADMIN_RELEASE_WRITER_OBJECT, content, { onlyIf: previous ? { etagMatches: previous.etag } : new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' } })
  if (!saved) throw new ReleaseControlError('release_conflict')
}
export async function reserveDeploymentWriter(env: CatalogApiEnv, raw: DeploymentRollbackRequest, action: DeploymentWriterCommand['action'] = 'deployment-rollback', now = Date.now()) {
  const request = deploymentRollbackSchema.parse(raw)
  if (env.ADMIN_RELEASE_CONTROL_ENABLED !== 'true') throw new ReleaseControlError('release_control_disabled', 503)
  const previous = await readReleaseWriter(env)
  if (!previous) throw new ReleaseControlError('release_backend_unavailable', 503)
  const { registry } = previous.state
  const existing = previous.state.command?.commandId === request.commandId ? previous.state.command : previous.state.recentCommands.find(value => value.commandId === request.commandId)
  if (existing) {
    if (existing.action !== action || existing.targetId !== request.targetId || existing.expectedCurrentId !== request.expectedCurrentId || existing.expectedRevision !== request.expectedRevision || existing.expectedRegistrySha256 !== request.expectedRegistrySha256 || existing.reason !== request.reason) throw new ReleaseControlError('release_conflict')
    return existing
  }
  // Permanent command identities prevent a reused UUID from reopening an older operation.
  if (await env.RELEASES_BUCKET.get(`admin-releases/commands/${request.commandId}/pending.json`)) throw new ReleaseControlError('release_command_closed')
  if (blocking(previous.state.command)) throw new ReleaseControlError('release_writer_busy')
  if (registry.currentId !== request.expectedCurrentId || registry.revision !== request.expectedRevision || await releaseDigest(JSON.stringify(registry)) !== request.expectedRegistrySha256) throw new ReleaseControlError('release_conflict')
  const age = now - Date.parse(registry.observedAt)
  if (age < -5_000 || age > 30_000) throw new ReleaseControlError('release_registry_stale')
  if (!registry.versions.some(value => value.id === request.targetId && value.projectId === registry.projectId && value.ready)) throw new ReleaseControlError('release_not_available', 400)
  if (WITHDRAWN_DEPLOYMENTS.has(request.targetId)) throw new ReleaseControlError('release_not_available', 400)
  const stamp = new Date(now).toISOString()
  const command: DeploymentWriterCommand = { commandId: request.commandId, action, targetId: request.targetId,
    expectedCurrentId: request.expectedCurrentId, expectedRevision: request.expectedRevision,
    expectedRegistrySha256: request.expectedRegistrySha256, reason: request.reason, requestedAt: stamp,
    updatedAt: stamp, status: 'pending', result: null }
  const recentCommands = previous.state.command ? [previous.state.command, ...previous.state.recentCommands].slice(0, 50) : previous.state.recentCommands
  await saveWriter(env, previous, { ...previous.state, command, recentCommands })
  // A claim checks this receipt. A failed append leaves the writer blocked, never executable.
  await immutableReceipt(env, `admin-releases/commands/${command.commandId}/pending.json`, command)
  return command
}
export async function updateDeploymentWriter(env: CatalogApiEnv, raw: DeploymentMachineRequest, now = Date.now()) {
  const request = deploymentMachineRequestSchema.parse(raw)
  if (request.action === 'reserve-promotion') return reserveDeploymentWriter(env, request.request, 'deployment-promotion', now)
  const previous = await readReleaseWriter(env)
  if(request.action==='compact-registry'){
    if(env.ADMIN_RELEASE_CONTROL_ENABLED!=='true')throw new ReleaseControlError('release_control_disabled',503)
    if(!previous)throw new ReleaseControlError('release_backend_unavailable',503)
    const {registry}=previous.state
    if(registry.projectId!==COMPACT_PROJECT||registry.alias!==COMPACT_ALIAS)throw new ReleaseControlError('release_conflict')
    if(blocking(previous.state.command)||previous.state.recentCommands.some(blocking))throw new ReleaseControlError('release_writer_busy')
    const previousRegistrySha256=await releaseDigest(JSON.stringify(registry))
    if(registry.currentId!==request.expectedCurrentId||registry.revision!==request.expectedRevision||previousRegistrySha256!==request.expectedRegistrySha256||registry.revision>=Number.MAX_SAFE_INTEGER)throw new ReleaseControlError('release_conflict')
    if(registry.versions.length!==20)throw new ReleaseControlError('release_compaction_not_required')
    // Archiving must never turn an unproved registration into a trusted history.
    // Every immutable version receipt remains at its original key, unchanged.
    await Promise.all(registry.versions.map(async version=>{
      const receipt=await env.RELEASES_BUCKET.get(`admin-releases/versions/${version.id}.json`)
      if(!receipt?.text||receipt.size===undefined||receipt.size>ADMIN_RELEASE_MAX_BYTES||await receipt.text()!==JSON.stringify(version))throw new ReleaseControlError('release_receipt_conflict')
    }))
    const archived=registry.versions.filter(version=>version.id!==registry.currentId).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||Date.parse(a.registeredAt)-Date.parse(b.registeredAt)||(a.id<b.id?-1:a.id>b.id?1:0))[0]
    if(!archived)throw new ReleaseControlError('release_compaction_not_required')
    // Keep observedAt: changing an index is not a fresh observation of Vercel.
    const revised={...registry,revision:registry.revision+1,versions:registry.versions.filter(version=>version.id!==archived.id)}
    const registrySha256=await releaseDigest(JSON.stringify(revised)),operationId=await releaseDigest(JSON.stringify(request)),prefix=`admin-releases/archives/${operationId}`
    const proposedKey=`${prefix}/proposed.json`,completedKey=`${prefix}/completed.json`
    const proposed={version:1,action:'compact-registry',operationId,previousRegistrySha256,registrySha256,expectedCurrentId:registry.currentId,previousRevision:registry.revision,nextRevision:revised.revision,archivedVersion:archived,versionReceiptKey:`admin-releases/versions/${archived.id}.json`,sourceObservedAt:registry.observedAt,status:'proposed'}
    await immutableReceipt(env,proposedKey,proposed)
    await saveWriter(env,previous,{...previous.state,registry:revised})
    // A proposed receipt alone proves no change. Only the successful state CAS
    // permits a completed record. A lost completion may be reconciled by GET19;
    // retrying the original revision cannot remove a second version.
    await immutableReceipt(env,`admin-releases/registry/${registrySha256}.json`,revised)
    await immutableReceipt(env,completedKey,{...proposed,status:'completed',completedAt:new Date(now).toISOString()})
    return{compacted:true,archivedVersionId:archived.id,previousRegistrySha256,registrySha256,state:{...previous.state,registry:revised},archive:{operationId,proposedKey,completedKey}}
  }
  if (request.action === 'sync-registry') {
    const registry = request.registry
    if (registry.versions.some(version => WITHDRAWN_DEPLOYMENTS.has(version.id))) throw new ReleaseControlError('release_not_available', 400)
    const age = now - Date.parse(registry.observedAt)
    if (age < -5_000 || age > 30_000) throw new ReleaseControlError('release_registry_stale')
    if (blocking(previous?.state.command ?? null)) throw new ReleaseControlError('release_writer_busy')
    if (previous) {
      if (registry.projectId !== previous.state.registry.projectId || registry.alias !== previous.state.registry.alias || registry.revision !== previous.state.registry.revision) throw new ReleaseControlError('release_conflict')
      if (previous.state.registry.versions.some(version => !registry.versions.some(next => next.id === version.id))) throw new ReleaseControlError('release_registration_missing')
      for (const version of registry.versions) {
        const old = previous.state.registry.versions.find(value => value.id === version.id)
        if (old && JSON.stringify(old) !== JSON.stringify(version)) throw new ReleaseControlError('release_receipt_conflict')
      }
    } else if (registry.revision !== 0) throw new ReleaseControlError('release_conflict')
    for (const version of registry.versions) await immutableReceipt(env, `admin-releases/versions/${version.id}.json`, version)
    const revised = { ...registry, revision: previous ? previous.state.registry.revision + 1 : 0 }
    const state: DeploymentWriterState = { version: 1, registry: revised, command: previous?.state.command ?? null, recentCommands: previous?.state.recentCommands ?? [] }
    await saveWriter(env, previous, state)
    await immutableReceipt(env, `admin-releases/registry/${await releaseDigest(JSON.stringify(revised))}.json`, revised)
    return state
  }
  if (!previous?.state.command || previous.state.command.commandId !== request.commandId) throw new ReleaseControlError('release_command_not_found', 404)
  const command = previous.state.command
  if (request.action === 'claim') {
    if (env.ADMIN_RELEASE_CONTROL_ENABLED !== 'true') throw new ReleaseControlError('release_control_disabled', 503)
    if (command.status !== 'pending') throw new ReleaseControlError('release_command_closed')
    const pending = await env.RELEASES_BUCKET.get(`admin-releases/commands/${command.commandId}/pending.json`)
    if (!pending?.text || await pending.text() !== JSON.stringify(command)) throw new ReleaseControlError('release_receipt_conflict')
    const claimed = { ...command, status: 'claimed' as const, updatedAt: new Date(now).toISOString() }
    await saveWriter(env, previous, { ...previous.state, command: claimed })
    await immutableReceipt(env, `admin-releases/commands/${command.commandId}/claimed.json`, claimed)
    return claimed
  }
  if (command.status !== 'claimed') throw new ReleaseControlError('release_command_closed')
  const result = request.result
  if (Date.parse(result.readbackAt) < Date.parse(command.requestedAt) || Date.parse(result.readbackAt) > now + 5_000) throw new ReleaseControlError('release_receipt_conflict')
  if (result.outcome === 'completed' && (result.actualPreviousId !== command.expectedCurrentId || result.actualCurrentId !== command.targetId || result.error !== null)) throw new ReleaseControlError('release_receipt_conflict')
  if (result.outcome === 'failed' && result.actualCurrentId !== command.expectedCurrentId) throw new ReleaseControlError('release_receipt_conflict')
  const finished = { ...command, status: result.outcome, result, updatedAt: new Date(now).toISOString() }
  // Persist proof before unlocking the writer. On failure the claimed writer stays blocked.
  await immutableReceipt(env, `admin-releases/commands/${command.commandId}/${result.outcome}.json`, finished)
  const registry = result.outcome === 'uncertain' ? previous.state.registry : {
    ...previous.state.registry, currentId: result.actualCurrentId!, observedAt: result.readbackAt, revision: previous.state.registry.revision + 1,
  }
  await saveWriter(env, previous, { ...previous.state, command: finished, registry })
  return finished
}
