import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { maintenanceClientFromEnvironment, type MaintenanceClient } from '../automation/catalog-maintenance-client'
import { buildMaintenanceTargets } from '../automation/build-maintenance-bootstrap'
import { catalogSha256, loadMaintenanceBundle } from './build-scope'
import { canonicalJson, scopeContentSha256, sha256Text } from './contracts'
import { readMaintenanceScope } from './scope-registry'
import { buildProgramCoverage } from './program-coverage'
import { readIdentityAcceptances } from '../../src/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '../../src/lib/data/field-verification-store'
import { getTodayDate } from '../../src/lib/data/freshness'
import { EXISTING_SCHOOLS_V2_SHA256 } from '../../workers/catalog-maintenance/src/scope-config'

type Row = Record<string, unknown>
const row = (value: unknown): Row | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)

/** Re-enqueue one exact metadata plan. Only the existing Worker may validate and finish it. */
export async function refreshCloudTargets(options: { root: string; client: Pick<MaintenanceClient, 'json'>; today?: string }) {
  const status = row(await options.client.json('/status'))
  if (status?.format !== 'studyinchina.cloud-maintenance-status' || status.version !== 1) throw new Error('cloud_targets_status_invalid')
  const backend = row(status.backend), cfg = row(status.control)
  const skipped = (reason: string) => ({ format: 'studyinchina.cloud-target-refresh', version: 1, state: 'waiting', refreshed: false as const,
    reason, modelCallsPerformed: false, operatorFlagsChanged: false })
  if (backend?.state === 'quota_wait') return skipped('quota_wait')
  if (backend?.state !== 'ready') throw new Error('cloud_targets_backend_unavailable')
  if (cfg?.seed_complete !== 1) return skipped('seed_not_ready')
  if (cfg.targets_complete === 1) return skipped('targets_current')
  if (cfg.targets_complete !== 0) throw new Error('cloud_targets_control_invalid')
  if (cfg.enabled === 0) return skipped('operator_or_scope_pause')
  if (cfg.enabled !== 1) throw new Error('cloud_targets_control_invalid')
  if (row(status.reconciliationGate)?.ready === false) return skipped('native_reconciliation_wait')
  if (status.enabled !== true) return skipped('deployment_activation_wait')
  if (!isHash(cfg.scope_sha256) || !isHash(cfg.input_catalog_sha256) || !Number.isSafeInteger(cfg.revision) || Number(cfg.revision) < 0) {
    throw new Error('cloud_targets_control_invalid')
  }

  const current = readMaintenanceScope(options.root)
  if (current.sha256 !== EXISTING_SCHOOLS_V2_SHA256 || current.formatVersion !== 2 || current.expectedSchoolCount !== 295
    || current.sha256 !== await scopeContentSha256(current) || !current.parentScopeSha256) throw new Error('cloud_targets_registry_invalid')
  const previous = readMaintenanceScope(options.root, current.parentScopeSha256)
  if (previous.formatVersion !== 1 || previous.expectedSchoolCount !== 272 || previous.sha256 !== await scopeContentSha256(previous)
    || previous.schools.some(school => canonicalJson(current.schools.find(value => value.universityId === school.universityId)) !== canonicalJson(school))) {
    throw new Error('cloud_targets_parent_registry_invalid')
  }
  const scope = cfg.scope_sha256 === current.sha256 ? current : cfg.scope_sha256 === previous.sha256 ? previous : null
  if (!scope) throw new Error('cloud_targets_scope_not_registered')
  const bundle = loadMaintenanceBundle(options.root), inputCatalogSha256 = await catalogSha256(bundle)
  if (inputCatalogSha256 !== cfg.input_catalog_sha256) return skipped('head_wait')
  const data = join(options.root, 'content/data'), today = options.today ?? getTodayDate()
  const recordTargets = buildMaintenanceTargets(bundle, scope)
  const coverageSnapshot = await buildProgramCoverage(bundle, scope, today,
    readIdentityAcceptances(data, { strictProjection: true }), readFieldVerifications(data))
  const request = { inputCatalogSha256, recordTargets, coverageSnapshot }
  const refreshSha256 = await sha256Text(canonicalJson({ inputCatalogSha256, recordTargets }))
  const response = await options.client.json('/targets', 'POST', request), acknowledgement = row(response)
  if (acknowledgement?.ok !== true || acknowledgement.recordTargets !== recordTargets.length
    || acknowledgement.refreshSha256 !== refreshSha256 || typeof acknowledgement.targetsComplete !== 'boolean') {
    throw new Error('cloud_targets_response_binding_invalid')
  }
  const responseText = canonicalJson(response)
  if (Buffer.byteLength(responseText) > 32768) throw new Error('cloud_targets_response_too_large')
  return { format: 'studyinchina.cloud-target-refresh', version: 1, state: acknowledgement.targetsComplete ? 'completed' : 'queued',
    refreshed: true as const, reason: 'exact_metadata_submitted', inputCatalogSha256, scopeRegistrySha256: scope.sha256,
    observedControlRevision: cfg.revision, schoolCount: scope.schools.length, recordTargets: recordTargets.length,
    evaluatedOn: today, refreshSha256, requestSha256: await sha256Text(canonicalJson(request)), coverageSnapshotSha256: coverageSnapshot.sha256,
    response, responseSha256: await sha256Text(responseText), modelCallsPerformed: false, operatorFlagsChanged: false }
}

async function main() {
  const args = process.argv.slice(2), values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1]
    if (!['--root', '--output'].includes(flag) || !value || value.startsWith('--') || values.has(flag)) throw new Error('cloud_targets_arguments_invalid')
    values.set(flag, value)
  }
  if (!values.has('--output')) throw new Error('cloud_targets_output_required')
  const report = await refreshCloudTargets({ root: resolve(values.get('--root') ?? process.cwd()), client: maintenanceClientFromEnvironment(process.env) })
  const output = resolve(values.get('--output')!); mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report))
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  console.error(error instanceof Error && /^(?:cloud_targets_|maintenance_)/u.test(error.message) ? error.message : 'cloud_targets_refresh_failed')
  process.exitCode = 1
})
