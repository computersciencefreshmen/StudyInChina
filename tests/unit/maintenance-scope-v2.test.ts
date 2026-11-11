import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readMaintenanceScope } from '../../scripts/maintenance/scope-registry'
import { canonicalJson, scopeContentSha256 } from '../../scripts/maintenance/contracts'
import { finishScopeUpgrade } from '../../scripts/automation/upgrade-maintenance-scope'
import type { ScopeUpgrade } from '../../workers/catalog-maintenance/src/scope-upgrade'
import type { MaintenanceClient } from '../../scripts/automation/catalog-maintenance-client'
import { EXISTING_SCHOOLS_V2_SHA256 } from '../../workers/catalog-maintenance/src/scope-config'

describe('versioned existing-school maintenance scope', () => {
  it('freezes precisely the existing 295 identities while preserving every original school and source definition', async () => {
    const previous = JSON.parse(readFileSync(resolve('content/maintenance/scope-272.v1.json'), 'utf8'))
    const next = readMaintenanceScope(process.cwd())
    const universities = JSON.parse(readFileSync(resolve('content/data/universities.json'), 'utf8')) as Array<{ id: string }>
    expect(next.formatVersion).toBe(2); expect(next.expectedSchoolCount).toBe(295)
    expect(next.sha256).toBe(await scopeContentSha256(next)); expect(next.parentScopeSha256).toBe(previous.sha256)
    expect(next.sha256).toBe(EXISTING_SCHOOLS_V2_SHA256)
    expect(next.schools.map(school => school.universityId).sort()).toEqual(universities.map(school => school.id).sort())
    for (const school of previous.schools) expect(canonicalJson(next.schools.find(row => row.universityId === school.universityId))).toBe(canonicalJson(school))
    expect(readMaintenanceScope(process.cwd(), previous.sha256)).toEqual(previous)
    expect(() => readMaintenanceScope(process.cwd(), 'f'.repeat(64))).toThrow('scope_unavailable')
  })

  it('CLI recovery refreshes the exact targets and restores only the original control under its expected revision', async () => {
    const nextScope = readMaintenanceScope(process.cwd()), previousScope = readMaintenanceScope(process.cwd(), nextScope.parentScopeSha256)
    const upgrade: ScopeUpgrade = { format: 'studyinchina.maintenance-scope-upgrade', version: 1, previousScope, nextScope,
      expectedRevision: 3, legacyGuardSha256: 'c'.repeat(64), inputCatalogSha256: 'b'.repeat(64) }
    const cfg = { revision: 5, scope_sha256: nextScope.sha256, input_catalog_sha256: upgrade.inputCatalogSha256,
      targets_complete: 0, legacy_guard_sha256: upgrade.legacyGuardSha256, canary_json: '["school"]', enabled: 0, models_enabled: 0 }
    const writes: Array<{ path: string; body: unknown }> = []
    const client: MaintenanceClient = { artifact: async () => new Uint8Array(), json: async (path, method, body) => {
      if (method === 'POST') { writes.push({ path, body }); if (path === '/targets') { cfg.targets_complete = 1; cfg.revision++ }; return { ok: true } }
      return { control: { ...cfg } }
    } }
    await finishScopeUpgrade(client, upgrade, { status: 'completed', completedRevision: 5, originalEnabled: false, originalModelsEnabled: false }, [], async () => undefined)
    expect(writes.map(write => write.path)).toEqual(['/targets', '/controls'])
    expect(writes[1].body).toMatchObject({ expectedRevision: 6, enabled: false, modelsEnabled: false })
    cfg.revision = 8
    await expect(finishScopeUpgrade(client, upgrade, { status: 'completed', completedRevision: 5, originalEnabled: true, originalModelsEnabled: true }, [])).rejects.toThrow('newer_operator_control_preserved')
    expect(writes).toHaveLength(2)
  })
})
