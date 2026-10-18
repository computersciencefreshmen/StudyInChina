import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, realpath } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deploymentWriterStateSchema, deploymentWriterCommandSchema, deploymentOutcomeSchema, type DeploymentRegistry, type DeploymentWriterCommand, type DeploymentMachineRequest } from '../../src/lib/admin/deployment-release-contract'

const PROJECT = 'prj_AgYJcsuat4kmLiinlvcBbZsYY3cg', OWNER = 'team_o5qghzfTOk24QwoYANzJ8hNH', ALIAS = 'studyinchina.vercel.app'
const WITHDRAWN = 'dpl_CJMi3PjUjKSeL7oRFRgNvDyC5vqf'
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export type PromotionMetadata = { id: string; projectId: string; ownerId: string; readyState: string; target: string; url: string; createdAt: number; commitSha: string | null }
export type PromotionAlias = { projectId: string; deploymentId: string }
export type GithubWriterClients = {
  writer: (method: 'GET' | 'PUT', payload?: DeploymentMachineRequest) => Promise<unknown>
  metadata: (idOrHost: string) => Promise<PromotionMetadata>
  alias: () => Promise<PromotionAlias>
}
export type PromotionOperation = { command: DeploymentWriterCommand; registry: DeploymentRegistry; target: PromotionMetadata; previous: PromotionMetadata }
function qualify(metadata: PromotionMetadata, idOrHost: string) {
  if (!/^dpl_[a-zA-Z0-9]{8,100}$/.test(metadata.id) || metadata.id === WITHDRAWN || metadata.projectId !== PROJECT || metadata.ownerId !== OWNER || !/^studyinchina-[a-z0-9-]+\.vercel\.app$/.test(metadata.url) || metadata.id !== idOrHost && metadata.url !== idOrHost) throw new Error('release_ownership_invalid')
  if (metadata.readyState !== 'READY' || metadata.target !== 'production' || !Number.isSafeInteger(metadata.createdAt) || metadata.createdAt <= 0) throw new Error('release_not_ready')
}
async function currentWriter(clients: GithubWriterClients) {
  const raw = await clients.writer('GET') as { state?: unknown; controlEnabled?: unknown; registrySha256?: unknown }
  if (raw.controlEnabled !== true || typeof raw.registrySha256 !== 'string') throw new Error('release_writer_unavailable')
  const state = deploymentWriterStateSchema.parse(raw.state)
  if (digest(state.registry) !== raw.registrySha256 || state.registry.projectId !== PROJECT || state.registry.alias !== ALIAS) throw new Error('release_registry_invalid')
  return { state, registrySha256: raw.registrySha256 }
}
export async function reserveGithubPromotion(clients: GithubWriterClients, deploymentUrl: string, deploymentSha: string, now = Date.now()): Promise<PromotionOperation> {
  if (!/^https:\/\/studyinchina-[a-z0-9-]+\.vercel\.app\/?$/.test(deploymentUrl) || !/^[a-f0-9]{40}$/.test(deploymentSha)) throw new Error('release_input_invalid')
  const initial = await currentWriter(clients)
  if (initial.state.command && ['pending', 'claimed', 'uncertain'].includes(initial.state.command.status)) throw new Error('release_writer_busy')
  const target = await clients.metadata(new URL(deploymentUrl).hostname)
  qualify(target, new URL(deploymentUrl).hostname)
  if (target.commitSha !== deploymentSha) throw new Error('release_commit_mismatch')
  const before = await clients.alias()
  if (before.projectId !== PROJECT || before.deploymentId !== initial.state.registry.currentId || target.id === before.deploymentId) throw new Error('release_current_changed')
  const previous = await clients.metadata(before.deploymentId); qualify(previous, before.deploymentId)
  if (!initial.state.registry.versions.some(version => version.id === previous.id && version.deploymentUrl === `https://${previous.url}/`)) throw new Error('release_previous_unregistered')
  const version = initial.state.registry.versions.find(value => value.id === target.id)
  if (version && (version.deploymentUrl !== `https://${target.url}/` || version.commitSha !== target.commitSha || version.createdAt !== new Date(target.createdAt).toISOString())) throw new Error('release_registration_conflict')
  const stamp = new Date(now).toISOString()
  const proofSha256 = digest({ operation: 'github-ready-production-registration-v1', target, deploymentSha })
  const versions = version ? initial.state.registry.versions : [...initial.state.registry.versions, { id: target.id, projectId: PROJECT, ready: true as const,
    deploymentUrl: `https://${target.url}/`, createdAt: new Date(target.createdAt).toISOString(), registeredAt: stamp, commitSha: target.commitSha, proofSha256 }]
  if (versions.length > 20) throw new Error('release_registration_limit')
  // This updates metadata only. A competing writer invalidates the following CAS;
  // no alias mutation is admitted until this exact promotion is claimed.
  await clients.writer('PUT', { action: 'sync-registry', registry: { ...initial.state.registry, versions, observedAt: stamp } })
  const latest = await currentWriter(clients)
  if (latest.state.registry.currentId !== previous.id || latest.state.command && ['pending', 'claimed', 'uncertain'].includes(latest.state.command.status)) throw new Error('release_current_changed')
  const reservedRaw = await clients.writer('PUT', { action: 'reserve-promotion', request: { commandId: randomUUID(), kind: 'deployment', targetId: target.id,
    expectedCurrentId: previous.id, expectedRevision: latest.state.registry.revision, expectedRegistrySha256: latest.registrySha256, reason: `GitHub production promotion of exact source commit ${deploymentSha}` } }) as { ok?: unknown; result?: unknown }
  if (reservedRaw.ok !== true) throw new Error('release_reservation_invalid')
  const reserved = deploymentWriterCommandSchema.parse(reservedRaw.result)
  if (reserved.action !== 'deployment-promotion' || reserved.status !== 'pending' || reserved.targetId !== target.id || reserved.expectedCurrentId !== previous.id || reserved.expectedRegistrySha256 !== latest.registrySha256) throw new Error('release_reservation_invalid')
  const claimedRaw = await clients.writer('PUT', { action: 'claim', commandId: reserved.commandId }) as { ok?: unknown; result?: unknown }
  if (claimedRaw.ok !== true) throw new Error('release_claim_invalid')
  const command = deploymentWriterCommandSchema.parse(claimedRaw.result)
  if (command.commandId !== reserved.commandId || command.status !== 'claimed' || command.targetId !== target.id || command.expectedCurrentId !== previous.id) throw new Error('release_claim_invalid')
  return { command, registry: latest.state.registry, target, previous }
}
export async function guardGithubAliasMutation(clients: GithubWriterClients, operation: PromotionOperation, mode: 'promote' | 'compensate') {
  const writer = await currentWriter(clients)
  if (writer.state.command?.commandId !== operation.command.commandId || writer.state.command.status !== 'claimed' || digest(writer.state.command) !== digest(operation.command) || digest(writer.state.registry) !== operation.command.expectedRegistrySha256) throw new Error('release_claim_lost')
  const actual = await clients.alias()
  if (actual.projectId !== PROJECT) throw new Error('release_current_changed')
  if (mode === 'promote') {
    if (actual.deploymentId !== operation.previous.id) throw new Error('release_current_changed')
    return { mutationRequired: true, actual }
  }
  if (actual.deploymentId === operation.previous.id) return { mutationRequired: false, actual }
  if (actual.deploymentId !== operation.target.id) throw new Error('release_current_changed')
  return { mutationRequired: true, actual }
}
export async function finishGithubPromotion(clients: GithubWriterClients, operation: PromotionOperation, requestedOutcome: 'completed' | 'failed' | 'uncertain', now = Date.now()) {
  let actual: PromotionAlias | null = null
  try { actual = await clients.alias() } catch { /* Keep the writer blocked when readback is unavailable. */ }
  const outcome = actual?.projectId === PROJECT && requestedOutcome === 'completed' && actual.deploymentId === operation.target.id ? 'completed'
    : actual?.projectId === PROJECT && requestedOutcome === 'failed' && actual.deploymentId === operation.previous.id ? 'failed' : 'uncertain'
  const result = deploymentOutcomeSchema.parse({ outcome, actualPreviousId: operation.previous.id,
    actualCurrentId: actual?.projectId === PROJECT ? actual.deploymentId : null, readbackAt: new Date(now).toISOString(),
    error: outcome === 'completed' ? null : outcome === 'failed' ? 'assignment_failed' : 'outcome_unknown',
    proofSha256: digest({ commandId: operation.command.commandId, expectedPrevious: operation.previous.id, target: operation.target.id, actual, requestedOutcome, outcome, readbackAt: new Date(now).toISOString() }) })
  const response = await clients.writer('PUT', { action: 'result', commandId: operation.command.commandId, result }) as { ok?: unknown; result?: unknown }
  if (response.ok !== true || deploymentWriterCommandSchema.parse(response.result).status !== outcome) throw new Error('release_acknowledgment_invalid')
  return result
}
async function boundedJson(response: Response) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 512 * 1024) throw new Error('release_transport_unavailable')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 512 * 1024) { await reader.cancel(); throw new Error('release_transport_unavailable') } chunks.push(value) }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
function environmentClients(): GithubWriterClients {
  const token = process.env.ADMIN_TELEMETRY_TOKEN, vercelToken = process.env.VERCEL_TOKEN
  const telemetry = new URL(process.env.ADMIN_TELEMETRY_URL || '')
  if (!token || token.length < 32 || !vercelToken || telemetry.protocol !== 'https:' || !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(telemetry.hostname) || telemetry.pathname !== '/internal/v1/admin-telemetry' || telemetry.username || telemetry.password || telemetry.search || telemetry.hash) throw new Error('release_credentials_unavailable')
  const endpoint = new URL('/internal/v1/admin-releases', telemetry)
  const read = async (url: URL, bearer: string, method: 'GET' | 'PUT' = 'GET', body?: unknown) => boundedJson(await fetch(url, { method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) }))
  const vercel = (path: string) => { const url = new URL(path, 'https://api.vercel.com'); url.searchParams.set('teamId', OWNER); return url }
  return { writer: (method, body) => { const url = new URL(endpoint); if (method === 'GET') url.searchParams.set('writer', '1'); return read(url, token, method, body) },
    alias: async () => { const raw = await read(vercel(`/v4/aliases/${ALIAS}`), vercelToken); return { projectId: String(raw.projectId || ''), deploymentId: String(raw.deploymentId || '') } },
    metadata: async id => {
      if (!/^(?:dpl_[a-zA-Z0-9]{8,100}|studyinchina-[a-z0-9-]+\.vercel\.app)$/.test(id)) throw new Error('release_input_invalid')
      const raw = await read(vercel(`/v13/deployments/${id}`), vercelToken)
      return { id: String(raw.id || ''), projectId: String(raw.projectId || ''), ownerId: String(raw.ownerId || ''), readyState: String(raw.readyState || ''), target: String(raw.target || ''), url: String(raw.url || ''), createdAt: Number(raw.createdAt ?? raw.created), commitSha: typeof raw.meta?.githubCommitSha === 'string' ? raw.meta.githubCommitSha : null }
    } }
}
async function saveImmutable(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const file = await open(path, 'wx')
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync() } finally { await file.close() }
}
async function main() {
  const args = process.argv.slice(2), action = args[0], parameter = args[1]
  if (args.length > 2 || !['reserve', 'guard', 'finish'].includes(action) || action === 'reserve' && parameter || action === 'guard' && !['promote', 'compensate'].includes(parameter) || action === 'finish' && !['completed', 'failed', 'uncertain'].includes(parameter)) throw new Error('release_arguments_invalid')
  const root = await realpath(process.cwd()), directory = resolve(root, '.github-release-writer'), clients = environmentClients()
  if (action === 'reserve') {
    const operation = await reserveGithubPromotion(clients, process.env.DEPLOYMENT_URL || '', process.env.DEPLOYMENT_SHA || '')
    await saveImmutable(resolve(directory, 'operation.json'), operation)
    return
  }
  const operation: PromotionOperation = JSON.parse(await readFile(resolve(directory, 'operation.json'), 'utf8'))
  if (action === 'guard') {
    const mode = parameter as 'promote' | 'compensate'
    const guard = await guardGithubAliasMutation(clients, operation, mode)
    await saveImmutable(resolve(directory, `guard-${mode}.json`), { commandId: operation.command.commandId, checkedAt: new Date().toISOString(), ...guard })
    return
  }
  const result = await finishGithubPromotion(clients, operation, parameter as 'completed' | 'failed' | 'uncertain')
  await saveImmutable(resolve(directory, 'result.json'), result)
  if (result.outcome === 'uncertain') throw new Error('release_outcome_uncertain')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('Release writer blocked: credentials, registry, ownership or current-version check failed. No unguarded retry is allowed; inspect the private writer command and immutable receipt.'); process.exitCode = 1 })
