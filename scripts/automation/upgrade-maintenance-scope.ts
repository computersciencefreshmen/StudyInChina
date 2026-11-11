import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalJson, sha256Text, type MaintenanceScope } from '../maintenance/contracts'
import { loadMaintenanceBundle, catalogSha256 } from '../maintenance/build-scope'
import { readMaintenanceScope } from '../maintenance/scope-registry'
import { buildMaintenanceTargets } from './build-maintenance-bootstrap'
import { maintenanceClientFromEnvironment, MaintenanceHttpError, type MaintenanceClient } from './catalog-maintenance-client'
import type { ScopeUpgrade } from '../../workers/catalog-maintenance/src/scope-upgrade'

type Status = { status: string; finished?: boolean; canSupersede?: boolean; completedRevision: number | null; originalEnabled: boolean | null; originalModelsEnabled: boolean | null }
type Observed = { control: { revision: number; scope_sha256: string; input_catalog_sha256: string; targets_complete: number; legacy_guard_sha256: string; canary_json: string; enabled: number; models_enabled: number } | null }

/** Resume only the exact upgrade's own pause; a later operator revision stops recovery. */
export async function finishScopeUpgrade(client: MaintenanceClient, upgrade: ScopeUpgrade, completed: Status,
  targets: ReturnType<typeof buildMaintenanceTargets>, wait: () => Promise<void> = () => new Promise(done => setTimeout(done, 5000))) {
  if (completed.status !== 'completed' || completed.completedRevision === null || completed.originalEnabled === null || completed.originalModelsEnabled === null) throw new Error('scope_upgrade_completion_unproven')
  let observed = await client.json('/status') as Observed, cfg = observed.control
  if (!cfg || cfg.scope_sha256 !== upgrade.nextScope.sha256 || cfg.input_catalog_sha256 !== upgrade.inputCatalogSha256) throw new Error('scope_upgrade_completion_head_changed')
  if (cfg.revision === completed.completedRevision + 2 && cfg.targets_complete === 1
    && Boolean(cfg.enabled) === completed.originalEnabled && Boolean(cfg.models_enabled) === completed.originalModelsEnabled) return { ok: true, reused: true }
  if (cfg.revision !== completed.completedRevision && !(cfg.targets_complete === 1 && cfg.revision === completed.completedRevision + 1)) throw new Error('scope_upgrade_newer_operator_control_preserved')
  if (!cfg.targets_complete) {
    await client.json('/targets', 'POST', { inputCatalogSha256: upgrade.inputCatalogSha256, recordTargets: targets })
    for (let attempt = 0; attempt < 120; attempt++) {
      observed = await client.json('/status') as Observed; cfg = observed.control
      if (!cfg || cfg.scope_sha256 !== upgrade.nextScope.sha256 || cfg.input_catalog_sha256 !== upgrade.inputCatalogSha256
        || cfg.revision > completed.completedRevision + 1) throw new Error('scope_upgrade_newer_operator_control_preserved')
      if (cfg.targets_complete === 1) break
      await wait()
    }
  }
  cfg = observed.control
  if (!cfg || cfg.targets_complete !== 1 || cfg.revision !== completed.completedRevision + 1) throw new Error('scope_upgrade_target_refresh_not_complete')
  return client.json('/controls', 'POST', { expectedRevision: cfg.revision, legacyGuardSha256: cfg.legacy_guard_sha256,
    enabled: completed.originalEnabled, modelsEnabled: completed.originalModelsEnabled, canaryUniversityIds: JSON.parse(cfg.canary_json) })
}

async function main() {
  const args = process.argv.slice(2), command = args[0] ?? 'prepare', value = (name: string) => args[args.indexOf(name) + 1]
  const root = resolve(args.includes('--root') ? value('--root') : process.cwd())
  if (args.includes('--auto')) {
    const client = maintenanceClientFromEnvironment(process.env)
    const status = await client.json('/status') as Observed & { backend?: { state: string }; proposals?: Array<{ status: string; count: number }> }
    if (status.backend?.state === 'quota_wait') { console.log(JSON.stringify({ state: 'quota_wait', continuation: 'existing_cloud_tick' })); return }
    if (status.backend?.state !== 'ready' || !status.control) throw new Error('scope_upgrade_backend_not_observed')
    let pending: { upgradeSha256: string } | null = null
    try { pending = JSON.parse(new TextDecoder().decode(await client.artifact('maintenance/scope-upgrades/pending.json'))) as { upgradeSha256: string } }
    catch (error) { if (!(error instanceof MaintenanceHttpError && error.httpStatus === 404)) throw error }
    let supersedes: string | undefined
    if (pending) {
      if (!/^[a-f0-9]{64}$/u.test(pending.upgradeSha256)) throw new Error('scope_upgrade_pending_pointer_invalid')
      const saved = await client.json(`/scope-upgrades?sha256=${pending.upgradeSha256}`) as Status
      if (!saved.canSupersede) {
        console.log(JSON.stringify({ state: saved.finished ? 'finished' : saved.status, upgradeSha256: pending.upgradeSha256,
          continuation: 'existing_cloud_tick', targetsReady: status.control.targets_complete === 1 })); return
      }
      supersedes = pending.upgradeSha256
    }
    const nextScope = readMaintenanceScope(root), previousScope = readMaintenanceScope(root, nextScope.parentScopeSha256)
    const bundle = loadMaintenanceBundle(root), ids = new Set(bundle.universities.map(school => school.id)), inputCatalogSha256 = await catalogSha256(bundle)
    if (nextScope.formatVersion !== 2 || ids.size !== 295 || nextScope.schools.some(school => !ids.has(school.universityId))) throw new Error('scope_upgrade_current_school_set_changed')
    if (status.control.scope_sha256 !== previousScope.sha256 || status.control.input_catalog_sha256 !== inputCatalogSha256) {
      console.log(JSON.stringify({ state: 'catalogue_head_or_scope_wait', continuation: 'existing_cloud_tick' })); return
    }
    if (status.proposals?.some(row => row.status === 'exported' && row.count > 0)) {
      console.log(JSON.stringify({ state: 'publication_pending', continuation: 'existing_cloud_tick' })); return
    }
    const publications = await client.json('/publications') as { publications?: unknown[] }
    if (!Array.isArray(publications.publications) || publications.publications.length) { console.log(JSON.stringify({ state: 'publication_pending' })); return }
    const upgrade: ScopeUpgrade = { format: 'studyinchina.maintenance-scope-upgrade', version: 1,
      expectedRevision: status.control.revision, legacyGuardSha256: status.control.legacy_guard_sha256, inputCatalogSha256,
      previousScope, nextScope, recordTargets: buildMaintenanceTargets(bundle, nextScope) }
    const bytes = Buffer.from(canonicalJson(upgrade)), hash = await sha256Text(bytes.toString('utf8'))
    await upload(bytes, hash, supersedes)
    console.log(JSON.stringify({ state: 'durably_queued', upgradeSha256: hash, continuation: 'existing_cloud_tick', schools: 295 })); return
  }
  if (command === 'prepare') {
    if (!args.includes('--output') || !args.includes('--expected-revision') || !args.includes('--legacy-guard-sha256')) throw new Error('prepare requires --output --expected-revision --legacy-guard-sha256')
    const previous = readMaintenanceScope(root, JSON.parse(readFileSync(resolve(root, 'content/maintenance/scope-272.v1.json'), 'utf8')).sha256)
    const bundle = loadMaintenanceBundle(root), nextScope = readMaintenanceScope(root)
    if (nextScope.formatVersion !== 2 || nextScope.parentScopeSha256 !== previous.sha256
      || bundle.universities.length !== 295 || nextScope.schools.some(school => !bundle.universities.some(row => row.id === school.universityId))) throw new Error('scope_upgrade_checked_registry_or_catalogue_changed')
    const upgrade: ScopeUpgrade = { format: 'studyinchina.maintenance-scope-upgrade', version: 1,
      expectedRevision: Number(value('--expected-revision')), legacyGuardSha256: value('--legacy-guard-sha256'),
      inputCatalogSha256: await catalogSha256(bundle), previousScope: previous, nextScope }
    upgrade.recordTargets = buildMaintenanceTargets(bundle, nextScope)
    const output = resolve(value('--output')); mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, canonicalJson(upgrade))
    console.log(JSON.stringify({ output, upgradeSha256: await sha256Text(canonicalJson(upgrade)), nextScopeSha256: nextScope.sha256, schools: nextScope.schools.length, modelCallsPerformed: false }))
    return
  }
  if (!args.includes('--input')) throw new Error('upload/status/finish requires --input <immutable-upgrade.json>')
  const bytes = readFileSync(resolve(value('--input'))), upgrade = JSON.parse(bytes.toString('utf8')) as ScopeUpgrade, hash = await sha256Text(bytes.toString('utf8'))
  const client = maintenanceClientFromEnvironment(process.env)
  if (command === 'upload' || command === 'apply') {
    await upload(bytes, hash)
    console.log(JSON.stringify({ upgradeSha256: hash, pendingValidation: true, modelCallsPerformed: false }))
    if (command === 'upload') return
  }
  let status = await client.json(`/scope-upgrades?sha256=${hash}`) as Status
  if (command === 'apply' && status.status === 'quota_wait') {
    console.log(JSON.stringify({ upgradeSha256: hash, durablyQueued: true, state: 'quota_wait', continuation: 'existing_cloud_tick' })); return
  }
  if (command === 'status') { console.log(JSON.stringify(status)); return }
  if (command === 'apply') {
    for (let attempt = 0; status.status !== 'completed' && attempt < 120; attempt++) {
      await new Promise(done => setTimeout(done, 5000))
      status = await client.json(`/scope-upgrades?sha256=${hash}`) as Status
      if (status.status === 'quota_wait') { console.log(JSON.stringify({ upgradeSha256: hash, durablyQueued: true, continuation: 'existing_cloud_tick' })); return }
    }
  }
  if (command !== 'finish' && command !== 'apply') throw new Error('Expected prepare, upload, status, apply or finish')
  const scope: MaintenanceScope = readMaintenanceScope(root, upgrade.nextScope.sha256), bundle = loadMaintenanceBundle(root)
  if (await catalogSha256(bundle) !== upgrade.inputCatalogSha256) throw new Error('scope_upgrade_local_catalogue_changed')
  await finishScopeUpgrade(client, upgrade, status, buildMaintenanceTargets(bundle, scope))
  console.log(JSON.stringify({ upgradeSha256: hash, finished: true, originalOperatorStatePreserved: true }))
}
async function upload(bytes: Buffer, hash: string, supersedes?: string) {
  // Validate origin/token with the established client without querying D1.
  maintenanceClientFromEnvironment(process.env)
  const upgrade = JSON.parse(bytes.toString('utf8')) as ScopeUpgrade
  const response = await fetch(new URL('/scope-upgrades', process.env.CATALOG_MAINTENANCE_URL), { method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${process.env.CATALOG_MAINTENANCE_TOKEN}`, 'Content-Type': 'application/json',
      'Content-Length': String(bytes.byteLength), 'x-maintenance-upgrade-sha256': hash,
      'x-maintenance-expected-revision': String(upgrade.expectedRevision), 'x-maintenance-previous-scope-sha256': upgrade.previousScope.sha256,
      'x-maintenance-input-catalog-sha256': upgrade.inputCatalogSha256, ...(supersedes ? { 'x-maintenance-supersedes-sha256': supersedes } : {}) },
    body: Uint8Array.from(bytes), signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error('scope_upgrade_upload_failed')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
}
