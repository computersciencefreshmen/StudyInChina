import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getTodayDate } from '../../src/lib/data/freshness'
import { directoryRevision } from '../../src/lib/catalog/directory-revision'
import { readIdentityAcceptances } from '../../src/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '../../src/lib/data/field-verification-store'
import { observeCoverageRelease } from '../../workers/catalog-maintenance/src/public-coverage'
import { EXISTING_SCHOOLS_V2_SHA256 } from '../../workers/catalog-maintenance/src/scope-config'
import { MaintenanceHttpError, maintenanceClientFromEnvironment, type MaintenanceClient } from '../automation/catalog-maintenance-client'
import { loadMaintenanceBundle } from './build-scope'
import { scopeContentSha256 } from './contracts'
import { buildProgramCoverage, coverageSummary } from './program-coverage'
import { readMaintenanceScope } from './scope-registry'

export async function refreshPublishedCoverage(options: { root: string; commit: string; client: Pick<MaintenanceClient, 'json'>;
  fetcher?: typeof fetch; today?: string }) {
  if (!/^[a-f0-9]{40}$/u.test(options.commit)) throw new Error('public_coverage_commit_invalid')
  const release = await observeCoverageRelease(options.fetcher), today = options.today ?? getTodayDate()
  if (release.deploymentSha !== options.commit || today !== release.evaluatedForDate)
    return { refreshed: false as const, reason: 'deployment_wait', deployedCommit: release.deploymentSha, checkoutCommit: options.commit }
  const scope = readMaintenanceScope(options.root)
  if (scope.sha256 !== EXISTING_SCHOOLS_V2_SHA256 || scope.sha256 !== await scopeContentSha256(scope) || scope.expectedSchoolCount !== 295)
    throw new Error('public_coverage_scope_invalid')
  const data = join(options.root,'content/data'), bundle = loadMaintenanceBundle(options.root)
  const identities = readIdentityAcceptances(data,{strictProjection:true}), fields = readFieldVerifications(data)
  if (directoryRevision(bundle,today,identities,fields) !== release.directoryRevision) throw new Error('public_coverage_directory_revision_changed')
  const coverage = await buildProgramCoverage(bundle,scope,today,identities,fields)
  if (release.coverage?.sha256 !== coverage.sha256 || release.coverage.scopeRegistrySha256 !== scope.sha256
    || release.coverage.inputCatalogSha256 !== coverage.inputCatalogSha256) throw new Error('public_coverage_projection_hash_mismatch')
  const result = await options.client.json('/coverage/published','POST',{ release, coverage }) as Record<string,unknown>
  if (result?.ok !== true || typeof result.reused !== 'boolean' || result.coverageSha256 !== coverage.sha256
    || result.deploymentSha !== release.deploymentSha || result.directoryRevision !== release.directoryRevision
    || result.inputCatalogSha256 !== coverage.inputCatalogSha256 || result.evaluatedOn !== today || result.schoolCount !== scope.schools.length)
    throw new Error('public_coverage_registration_receipt_invalid')
  return { refreshed: true as const, reused: result.reused, ...release, coverageSha256: coverage.sha256, inputCatalogSha256: coverage.inputCatalogSha256,
    scopeRegistrySha256: scope.sha256, ...coverageSummary(coverage) }
}

async function main() {
  const [flag,out,...extra] = process.argv.slice(2)
  if (flag !== '--output' || !out || extra.length || process.env.GITHUB_REF !== 'refs/heads/main'
    || process.env.GITHUB_REPOSITORY !== 'computersciencefreshmen/StudyInChina') throw new Error('public_coverage_trusted_main_required')
  const commit = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
  try {
    const result = await refreshPublishedCoverage({ root: process.cwd(), commit, client: maintenanceClientFromEnvironment(process.env) })
    writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result))
  } catch (error) {
    if (!(error instanceof MaintenanceHttpError)) throw error
    const failure = {
      refreshed: false,
      reason: error.coverageCode ?? 'maintenance_request_failed',
      httpStatus: error.httpStatus,
      backendUnavailable: error.backendUnavailable,
      checkoutCommit: commit,
    }
    writeFileSync(out, JSON.stringify(failure, null, 2) + '\n')
    console.error(JSON.stringify(failure))
    process.exitCode = 1
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  console.error(error instanceof Error ? error.message : 'public_coverage_refresh_failed')
  process.exitCode = 1
})
