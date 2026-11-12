import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { refreshCloudProgramCoverage } from '../../scripts/maintenance/program-coverage'
import { readMaintenanceScope } from '../../scripts/maintenance/scope-registry'
import { scopeContentSha256, type MaintenanceScope } from '../../scripts/maintenance/contracts'
import { catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { MaintenanceHttpError, type MaintenanceClient } from '../../scripts/automation/catalog-maintenance-client'

const repositoryRoot = process.cwd(), currentScope = readMaintenanceScope(repositoryRoot)
const previousScope = readMaintenanceScope(repositoryRoot, currentScope.parentScopeSha256)
const fixturePrefix = join(tmpdir(), 'sic-coverage-refresh-'), fixtureRoots: string[] = []
let inputCatalogSha256: string

beforeAll(async () => { inputCatalogSha256 = await catalogSha256(loadMaintenanceBundle(repositoryRoot)) })
afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    if (!resolve(root).startsWith(resolve(fixturePrefix))) throw new Error('fixture_cleanup_outside_prefix')
    rmSync(root, { recursive: true, force: true })
  }
})

function fixture(scopes: MaintenanceScope[] = [previousScope, currentScope]) {
  const root = mkdtempSync(fixturePrefix), directory = join(root, 'content/maintenance')
  fixtureRoots.push(root); mkdirSync(directory, { recursive: true })
  for (const scope of scopes) writeFileSync(join(directory, `scope-${scope.expectedSchoolCount}.v${scope.formatVersion}.json`), JSON.stringify(scope))
  // Deliberately no catalog files: a normal upgrade wait must stop before loading them.
  return root
}
function status(scopeSha256 = currentScope.sha256) {
  return { format: 'studyinchina.cloud-maintenance-status', backend: { state: 'ready' }, enabled: true,
    control: { seed_complete: 1, targets_complete: 1, scope_sha256: scopeSha256, input_catalog_sha256: inputCatalogSha256 } }
}
function client(observation = status()) {
  return { json: vi.fn<MaintenanceClient['json']>().mockResolvedValueOnce(observation).mockResolvedValue({ ok: true }) }
}

describe('cloud coverage refresh during the approved additive scope upgrade', () => {
  it('waits for the pinned 272-to-295 transition without writing a snapshot or posting coverage', async () => {
    const cloud = client(status(previousScope.sha256)), onSnapshot = vi.fn()
    await expect(refreshCloudProgramCoverage({ root: fixture(), client: cloud, today: '2026-11-12', onSnapshot }))
      .resolves.toEqual({ refreshed: false, reason: 'scope_upgrade_wait' })
    expect(onSnapshot).not.toHaveBeenCalled()
    expect(cloud.json.mock.calls).toEqual([['/status']])
  })

  it('refuses another valid registry that is not the reviewed v2 parent', async () => {
    const foreign = { ...previousScope, scopeId: `${previousScope.scopeId}-unreviewed` }
    foreign.sha256 = await scopeContentSha256(foreign)
    const cloud = client(status(foreign.sha256)), onSnapshot = vi.fn()
    await expect(refreshCloudProgramCoverage({ root: fixture([foreign, currentScope]), client: cloud, onSnapshot }))
      .rejects.toThrow('coverage_scope_not_current')
    expect(onSnapshot).not.toHaveBeenCalled(); expect(cloud.json).toHaveBeenCalledTimes(1)
  })

  it('refuses an unregistered control scope instead of calling it an upgrade wait', async () => {
    const cloud = client(status('a'.repeat(64)))
    await expect(refreshCloudProgramCoverage({ root: fixture(), client: cloud }))
      .rejects.toThrow('maintenance_export_scope_unavailable_or_ambiguous')
    expect(cloud.json).toHaveBeenCalledTimes(1)
  })

  it('checks the pinned destination contents before accepting a transition wait', async () => {
    const altered = { ...currentScope, scopeId: `${currentScope.scopeId}-changed` }
    const cloud = client(status(previousScope.sha256))
    await expect(refreshCloudProgramCoverage({ root: fixture([previousScope, altered]), client: cloud }))
      .rejects.toThrow('coverage_scope_checksum_mismatch')
    expect(cloud.json).toHaveBeenCalledTimes(1)
  })

  it('still publishes a matching 295-school snapshot after the control upgrade', async () => {
    const cloud = client(), onSnapshot = vi.fn()
    const result = await refreshCloudProgramCoverage({ root: repositoryRoot, client: cloud, today: '2026-11-12', onSnapshot })
    expect(result).toMatchObject({ refreshed: true, reason: 'coverage_refreshed', schoolCount: 295 })
    expect(onSnapshot).toHaveBeenCalledTimes(1)
    const snapshot = onSnapshot.mock.calls[0][0]
    expect(snapshot).toMatchObject({ scopeRegistrySha256: currentScope.sha256, inputCatalogSha256, evaluatedOn: '2026-11-12' })
    expect(snapshot.schools).toHaveLength(295)
    expect(cloud.json.mock.calls).toEqual([['/status'], ['/coverage', 'POST', snapshot]])
  })

  it('does not turn authentication or coverage CAS failures into normal waits', async () => {
    const authentication = new MaintenanceHttpError(401), conflict = new MaintenanceHttpError(409)
    const unauthenticated = { json: vi.fn<MaintenanceClient['json']>().mockRejectedValue(authentication) }
    await expect(refreshCloudProgramCoverage({ root: repositoryRoot, client: unauthenticated })).rejects.toBe(authentication)
    const cloud = { json: vi.fn<MaintenanceClient['json']>().mockResolvedValueOnce(status()).mockRejectedValue(conflict) }
    await expect(refreshCloudProgramCoverage({ root: repositoryRoot, client: cloud, today: '2026-11-12' })).rejects.toBe(conflict)
  })

  it('exits the real CLI successfully for a pinned upgrade wait so the workflow can continue to tick', () => {
    const root = fixture(), preload = join(root, 'fake-status.mjs'), output = join(root, 'coverage.json')
    writeFileSync(preload, `globalThis.fetch = async (url, init) => {
      if (new URL(url).pathname !== '/status' || init?.method !== 'GET') throw new Error('unexpected_network_request');
      return Response.json(${JSON.stringify(status(previousScope.sha256))});
    };`)
    const require = createRequire(import.meta.url)
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href, '--import', pathToFileURL(preload).href,
      resolve(repositoryRoot, 'scripts/maintenance/program-coverage.ts'), '--cloud-refresh', '--output', output], {
      cwd: root, encoding: 'utf8', timeout: 10000, env: { ...process.env,
        CATALOG_MAINTENANCE_URL: 'https://coverage-fixture.example.workers.dev', CATALOG_MAINTENANCE_TOKEN: 'test-only-secret-that-is-never-a-real-account-token' },
    })
    expect(result.error).toBeUndefined(); expect(result.stderr).toBe(''); expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ refreshed: false, reason: 'scope_upgrade_wait' })
    expect(existsSync(output)).toBe(false)
  })
})
