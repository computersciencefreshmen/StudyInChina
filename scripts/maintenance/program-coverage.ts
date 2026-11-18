import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readIdentityAcceptances } from '../../src/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '../../src/lib/data/field-verification-store'
import { getTodayDate } from '../../src/lib/data/freshness'
import { maintenanceScopeSchema, scopeContentSha256 } from './contracts'
import { maintenanceClientFromEnvironment, type MaintenanceClient } from '../automation/catalog-maintenance-client'
import { readMaintenanceScope } from './scope-registry'
import { catalogSha256, loadMaintenanceBundle } from './build-scope'
import type { CoverageSnapshot } from '../../workers/catalog-maintenance/src/coverage'
import { EXISTING_SCHOOLS_V2_SHA256 } from '../../workers/catalog-maintenance/src/scope-config'

import { buildProgramCoverage } from '../../src/lib/data/school-program-coverage'
export { buildProgramCoverage }
export { concreteProgramKeys } from '../../src/lib/data/concrete-majors'

export function coverageSummary(snapshot: CoverageSnapshot) {
  return { schoolCount: snapshot.schools.length, minimumProgramCount: 5,
    bands: Object.fromEntries(['zero', 'one', 'two-to-four', 'five-plus'].map(band => [band, snapshot.schools.filter(school => school.coverageBand === band).length])),
    directoryPrograms: snapshot.schools.reduce((sum, row) => sum + row.directoryProgramCount, 0),
    currentConcretePrograms: snapshot.schools.reduce((sum, row) => sum + row.currentProgramCount, 0),
    currentScholarshipOpportunities: snapshot.schools.reduce((sum, row) => sum + row.currentScholarshipCount, 0),
    schoolsMeetingMinimum: snapshot.schools.filter(row => row.gap === 0).length, totalProgramGap: snapshot.schools.reduce((sum, row) => sum + row.gap, 0) }
}
export function renderCoverageReport(snapshot: CoverageSnapshot): string {
  const summary = coverageSummary(snapshot)
  return `# School programme coverage — ${snapshot.evaluatedOn}\n\nScope: ${snapshot.scopeRegistrySha256}\n\nCatalog: ${snapshot.inputCatalogSha256}\n\n${summary.schoolCount} schools; minimum 5 concrete current programmes per school. Bands 0 / 1 / 2–4 / ≥5: ${Object.values(summary.bands).join(' / ')}.\n\nCurrent means a discoverable, source-backed specific programme with a current admission cycle, application route, teaching language, duration and both language requirements and eligibility. Explicit annual language/round scopes require their own application route and both conditions; absent or unknown facts do not count as complete. Exemptions count only with current official not-applicable leaf evidence. Scholarship opportunities require a current deadline (or an explicit no-deadline receipt), application route, eligibility, and all four funding leaves; unknown benefits do not count. Exact bilingual identities are merged; teaching-language tracks and application rounds do not count separately. Directory identities and raw stored rows are reported separately. No official sites were fetched to generate this report.\n\n| School ID | Raw rows | Directory majors | Current majors | Gap to 5 | Review after |\n|---|---:|---:|---:|---:|---|\n${snapshot.schools.map(row => `| ${row.universityId} | ${row.rawProgramCount} | ${row.directoryProgramCount} | ${row.currentProgramCount} | ${row.gap} | ${row.reviewAfter ?? 'unknown'} |`).join('\n')}\n`
}
export async function refreshCloudProgramCoverage(options: { root: string; client: Pick<MaintenanceClient, 'json'>; today?: string; onSnapshot?: (snapshot: CoverageSnapshot) => void }) {
  const today = options.today ?? getTodayDate(), status = await options.client.json('/status') as {
    format?: string; backend?: { state?: string }; enabled?: boolean;
    control?: { seed_complete?: number; targets_complete?: number; scope_sha256?: string; input_catalog_sha256?: string };
    coverage?: { snapshotSha256?: string; evaluatedOn?: string; inputCatalogSha256?: string; scopeRegistrySha256?: string };
  }
  if (status.format !== 'studyinchina.cloud-maintenance-status') throw new Error('coverage_status_invalid')
  const skipped = (reason: string) => ({ refreshed: false as const, reason })
  if (status.backend?.state !== 'ready') return skipped(status.backend?.state === 'quota_wait' ? 'quota_wait' : 'backend_wait')
  const cfg = status.control
  if (cfg?.seed_complete !== 1 || cfg.targets_complete !== 1 || !cfg.scope_sha256 || !cfg.input_catalog_sha256) return skipped('targets_not_ready')
  if (status.enabled === false) return skipped('operator_pause')
  const scope = readMaintenanceScope(options.root, cfg.scope_sha256), currentScope = readMaintenanceScope(options.root)
  if (scope.sha256 !== await scopeContentSha256(scope)) throw new Error('coverage_scope_checksum_mismatch')
  if (currentScope.sha256 !== await scopeContentSha256(currentScope)) throw new Error('coverage_scope_checksum_mismatch')
  if (scope.sha256 !== currentScope.sha256) {
    // The Worker accepts coverage only after the approved additive upgrade.
    // Leave that upgrade and any prior publication to their existing fences.
    if (currentScope.sha256 === EXISTING_SCHOOLS_V2_SHA256 && currentScope.formatVersion === 2
      && currentScope.expectedSchoolCount === 295 && currentScope.parentScopeSha256 === scope.sha256
      && scope.formatVersion === 1 && scope.expectedSchoolCount === 272) return skipped('scope_upgrade_wait')
    throw new Error('coverage_scope_not_current')
  }
  const bundle = loadMaintenanceBundle(options.root)
  if (await catalogSha256(bundle) !== cfg.input_catalog_sha256) return skipped('head_wait')
  if (status.coverage?.snapshotSha256 && status.coverage.evaluatedOn === today && status.coverage.inputCatalogSha256 === cfg.input_catalog_sha256
    && status.coverage.scopeRegistrySha256 === cfg.scope_sha256) return skipped('coverage_current')
  const data = join(options.root, 'content/data'), snapshot = await buildProgramCoverage(bundle, scope, today,
    readIdentityAcceptances(data, { strictProjection: true }), readFieldVerifications(data))
  options.onSnapshot?.(snapshot)
  await options.client.json('/coverage', 'POST', snapshot)
  return { refreshed: true as const, reason: 'coverage_refreshed', sha256: snapshot.sha256, evaluatedOn: snapshot.evaluatedOn, ...coverageSummary(snapshot) }
}
async function main() {
  const args = process.argv.slice(2), value = (name: string) => args[args.indexOf(name) + 1], root = process.cwd()
  const writeSnapshot = (snapshot: CoverageSnapshot) => {
    if (args.includes('--output')) { const path = resolve(value('--output')); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`) }
    if (args.includes('--markdown')) { const path = resolve(value('--markdown')); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, renderCoverageReport(snapshot)) }
  }
  if (args.includes('--cloud-refresh')) {
    console.log(JSON.stringify(await refreshCloudProgramCoverage({ root, client: maintenanceClientFromEnvironment(process.env), onSnapshot: writeSnapshot }))); return
  }
  if (!args.includes('--scope') || !args.includes('--output')) throw new Error('Usage: program-coverage.ts --scope <registry.json> --output <snapshot.json> [--today YYYY-MM-DD] [--markdown <report.md>]')
  const scope = maintenanceScopeSchema.parse(JSON.parse(readFileSync(resolve(value('--scope')), 'utf8'))), data = join(root, 'content/data')
  if (scope.sha256 !== await scopeContentSha256(scope)) throw new Error('coverage_scope_checksum_mismatch')
  const bundle = loadMaintenanceBundle(root)
  const snapshot = await buildProgramCoverage(bundle, scope, args.includes('--today') ? value('--today') : getTodayDate(),
    readIdentityAcceptances(data, { strictProjection: true }), readFieldVerifications(data))
  writeSnapshot(snapshot)
  if (args.includes('--upload')) await maintenanceClientFromEnvironment(process.env).json('/coverage','POST',snapshot)
  console.log(JSON.stringify({ ...coverageSummary(snapshot), sha256: snapshot.sha256, evaluatedOn: snapshot.evaluatedOn }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error instanceof Error ? error.message : 'coverage_failed'); process.exitCode = 1 })
