import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { refreshCloudTargets } from '../../scripts/maintenance/refresh-cloud-targets'
import { readMaintenanceScope } from '../../scripts/maintenance/scope-registry'
import { loadMaintenanceBundle, catalogSha256 } from '../../scripts/maintenance/build-scope'
import { canonicalJson, sha256Text } from '../../scripts/maintenance/contracts'
import { MaintenanceHttpError, type MaintenanceClient } from '../../scripts/automation/catalog-maintenance-client'

const root = process.cwd(), current = readMaintenanceScope(root), previous = readMaintenanceScope(root, current.parentScopeSha256)
const today = '2026-11-12', prefix = join(tmpdir(), 'sic-target-refresh-'), roots: string[] = []
let catalog: string
beforeAll(async () => { catalog = await catalogSha256(loadMaintenanceBundle(root)) })
afterEach(() => { for (const path of roots.splice(0)) { if (!resolve(path).startsWith(resolve(prefix))) throw Error('unsafe_fixture_cleanup'); rmSync(path, { recursive: true, force: true }) } })
const fixture = () => { const path = mkdtempSync(prefix); roots.push(path); return path }
function status(scope = previous.sha256) {
  return { format: 'studyinchina.cloud-maintenance-status', version: 1, backend: { state: 'ready' }, enabled: true, reconciliationGate: { ready: true },
    control: { revision: 7, enabled: 1, models_enabled: 1, seed_complete: 1, targets_complete: 0, scope_sha256: scope, input_catalog_sha256: catalog } }
}
function client(observation = status()) {
  return { json: vi.fn<MaintenanceClient['json']>(async (path, method, value) => {
    if (path === '/status' && !method) return structuredClone(observation)
    if (path !== '/targets' || method !== 'POST') throw Error('unexpected_endpoint')
    const body = value as { inputCatalogSha256: string; recordTargets: unknown[] }
    return { ok: true, recordTargets: body.recordTargets.length, refreshSha256: await sha256Text(canonicalJson({ inputCatalogSha256: body.inputCatalogSha256, recordTargets: body.recordTargets })),
      targetsComplete: false, reused: true, revalidationQueued: true }
  }) }
}

describe('trusted-main target metadata recovery', () => {
  it.each([['old 272', previous], ['current 295', current]] as const)('requeues the exact %s scope once, with same-head targets and current coverage', async (_label, scope) => {
    const cloud = client(status(scope.sha256)), report = await refreshCloudTargets({ root, client: cloud, today })
    expect(report).toMatchObject({ state: 'queued', refreshed: true, schoolCount: scope.schools.length, observedControlRevision: 7,
      inputCatalogSha256: catalog, scopeRegistrySha256: scope.sha256, evaluatedOn: today, modelCallsPerformed: false, operatorFlagsChanged: false })
    if (!report.refreshed) throw new Error('expected_queued_metadata')
    expect(cloud.json.mock.calls).toHaveLength(2); expect(cloud.json.mock.calls[0]).toEqual(['/status'])
    const [path, method, body] = cloud.json.mock.calls[1]
    expect(path).toBe('/targets'); expect(method).toBe('POST')
    const request = body as { inputCatalogSha256: string; recordTargets: { universityId: string }[]; coverageSnapshot: { inputCatalogSha256: string; scopeRegistrySha256: string; evaluatedOn: string; schools: unknown[]; sha256: string } }
    expect(Object.keys(request).sort()).toEqual(['coverageSnapshot', 'inputCatalogSha256', 'recordTargets'])
    expect(request.coverageSnapshot).toMatchObject({ inputCatalogSha256: catalog, scopeRegistrySha256: scope.sha256, evaluatedOn: today })
    expect(request.coverageSnapshot.schools).toHaveLength(scope.schools.length)
    const ids = new Set(scope.schools.map(school => school.universityId))
    expect(request.recordTargets.length).toBeGreaterThan(1000); expect(request.recordTargets.every(target => ids.has(target.universityId))).toBe(true)
    expect(report.refreshSha256).toBe(await sha256Text(canonicalJson({ inputCatalogSha256: catalog, recordTargets: request.recordTargets })))
    expect(report.requestSha256).toBe(await sha256Text(canonicalJson(request)))
    expect(report.responseSha256).toBe(await sha256Text(canonicalJson(report.response)))
    expect(report.response).toMatchObject({ revalidationQueued: true, targetsComplete: false })
  })

  it('skips already current targets without loading registries or catalogues', async () => {
    const observation = status(); observation.control.targets_complete = 1
    const cloud = client(observation)
    await expect(refreshCloudTargets({ root: 'does-not-exist', client: cloud })).resolves.toMatchObject({ refreshed: false, reason: 'targets_current' })
    expect(cloud.json.mock.calls).toEqual([['/status']])
  })

  it.each(['quota', 'seed', 'manual', 'native', 'deployment'] as const)('preserves a %s wait before reading local data or writing metadata', async kind => {
    const observation = status()
    if (kind === 'quota') observation.backend.state = 'quota_wait'
    if (kind === 'seed') observation.control.seed_complete = 0
    if (kind === 'manual') observation.control.enabled = 0
    if (kind === 'native') observation.reconciliationGate.ready = false
    if (kind === 'deployment') observation.enabled = false
    const cloud = client(observation)
    expect(await refreshCloudTargets({ root: 'does-not-exist', client: cloud })).toMatchObject({ refreshed: false,
      reason: { quota: 'quota_wait', seed: 'seed_not_ready', manual: 'operator_or_scope_pause', native: 'native_reconciliation_wait', deployment: 'deployment_activation_wait' }[kind] })
    expect(cloud.json.mock.calls).toEqual([['/status']])
  })

  it('waits for the exact canonical head instead of replacing it or acknowledging another batch', async () => {
    const observation = status(); observation.control.input_catalog_sha256 = '9'.repeat(64)
    const cloud = client(observation)
    await expect(refreshCloudTargets({ root, client: cloud, today })).resolves.toMatchObject({ refreshed: false, reason: 'head_wait' })
    expect(cloud.json.mock.calls).toEqual([['/status']])
  })

  it('rejects unregistered scope, altered pinned registry and altered parent without any POST', async () => {
    const foreign = client(status('f'.repeat(64)))
    await expect(refreshCloudTargets({ root, client: foreign, today })).rejects.toThrow('cloud_targets_scope_not_registered')
    expect(foreign.json.mock.calls).toEqual([['/status']])
    for (const changed of ['current', 'parent']) {
      const directory = fixture(); mkdirSync(join(directory, 'content/maintenance'), { recursive: true })
      writeFileSync(join(directory, 'content/maintenance/scope-295.v2.json'), JSON.stringify(changed === 'current' ? { ...current, scopeId: 'altered' } : current))
      writeFileSync(join(directory, 'content/maintenance/scope-272.v1.json'), JSON.stringify(changed === 'parent' ? { ...previous, scopeId: 'altered' } : previous))
      const cloud = client()
      await expect(refreshCloudTargets({ root: directory, client: cloud, today })).rejects.toThrow(changed === 'current' ? 'cloud_targets_registry_invalid' : 'cloud_targets_parent_registry_invalid')
      expect(cloud.json.mock.calls).toEqual([['/status']])
    }
  })

  it('does not poll, change controls or hide a failed/mismatched acknowledgement', async () => {
    const failure = new MaintenanceHttpError(409), cloud = client()
    cloud.json.mockImplementationOnce(async () => status()).mockRejectedValueOnce(failure)
    await expect(refreshCloudTargets({ root, client: cloud, today })).rejects.toBe(failure)
    expect(cloud.json.mock.calls.map(call => call[0])).toEqual(['/status', '/targets'])
    const wrong = client(); wrong.json.mockImplementationOnce(async () => status()).mockResolvedValueOnce({ ok: true, recordTargets: 0, refreshSha256: 'e'.repeat(64), targetsComplete: true })
    await expect(refreshCloudTargets({ root, client: wrong, today })).rejects.toThrow('cloud_targets_response_binding_invalid')
    expect(wrong.json.mock.calls.map(call => call[0])).toEqual(['/status', '/targets'])
  })

  it('propagates authentication and genuine backend failures without treating them as daily quota', async () => {
    const authentication = new MaintenanceHttpError(401), cloud = client(); cloud.json.mockRejectedValueOnce(authentication)
    await expect(refreshCloudTargets({ root, client: cloud })).rejects.toBe(authentication)
    const observation = status(); observation.backend.state = 'backend_unavailable'
    await expect(refreshCloudTargets({ root, client: client(observation) })).rejects.toThrow('cloud_targets_backend_unavailable')
  })
})

describe('scheduled target recovery ordering and scope intent fence', () => {
  it('reuses the same cadence and lock and runs the helper before scope --auto with its small receipt retained', () => {
    const yaml = readFileSync('.github/workflows/catalog-maintenance-tick.yml', 'utf8')
    expect(yaml).toContain("cron: '11,26,41,56 * * * *'")
    expect(yaml).toContain('group: autonomous-catalog-maintenance-${{ github.repository }}')
    expect(yaml.indexOf('scripts/maintenance/refresh-cloud-targets.ts')).toBeLessThan(yaml.indexOf('scripts/automation/upgrade-maintenance-scope.ts --auto'))
    expect(yaml).toContain('${{ runner.temp }}/catalog-maintenance-tick/target-refresh.json')
    expect(yaml).not.toMatch(/MINIMAX_.*(?:KEY|TOKEN)|CLOUDFLARE_API_TOKEN/u)
  })

  it.each(['none', 'continuing', 'supersedable'] as const)('does not prepare a new scope intent while targets are pending (%s)', pending => {
    const directory = fixture(), preload = join(directory, 'fake-status.mjs'), upgradeSha = 'a'.repeat(64)
    writeFileSync(preload, `globalThis.fetch = async (url, init) => {
      const u = new URL(url); if (init?.method !== 'GET') throw new Error('unexpected_write');
      if (u.pathname === '/status') return Response.json(${JSON.stringify(status())});
      if (u.pathname === '/artifacts') return ${pending === 'none' ? "new Response('', {status:404})" : `Response.json({upgradeSha256:'${upgradeSha}'})`};
      if (u.pathname === '/scope-upgrades') return Response.json({status:'completed',finished:false,canSupersede:${pending === 'supersedable'}});
      throw new Error('unexpected_request');
    };`)
    const require = createRequire(import.meta.url)
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href, '--import', pathToFileURL(preload).href,
      resolve(root, 'scripts/automation/upgrade-maintenance-scope.ts'), '--auto', '--root', directory], { cwd: directory, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, CATALOG_MAINTENANCE_URL: 'https://refresh-fixture.example.workers.dev', CATALOG_MAINTENANCE_TOKEN: 'test-only-secret-not-a-real-credential' } })
    expect(result.error).toBeUndefined(); expect(result.stderr).toBe(''); expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ state: pending === 'continuing' ? 'completed' : 'targets_not_ready', continuation: 'existing_cloud_tick' })
  })
})
