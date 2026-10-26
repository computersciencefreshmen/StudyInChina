import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { activateMaintenanceScopeIntent, type MaintenanceClient } from '../../scripts/automation/catalog-maintenance-client'

const scope = JSON.parse(readFileSync(resolve('content/maintenance/scope-272.v1.json'), 'utf8')) as { schools: Array<{ universityId: string }> }
const previous = ['uni-peking-university','uni-tsinghua-university','uni-zhejiang-university','uni-northwestern-polytechnical-university','uni-beijing-language-and-culture-university']
const desired = [...previous, ...scope.schools.map(school => school.universityId).filter(id => !previous.includes(id)).slice(0, 20)]
const intent = { format: 'studyinchina.maintenance-scope-intent', version: 1, expectedRevision: 1,
  scopeRegistrySha256: 'c1703d2dd6b70ae533e7817e1e11393dbc6319672ba6ab97b01f0d2e66f53316',
  legacyGuardSha256: 'd86ec443468e22aa292235311751d0abcc6de30f4119024b3d8c2582b4198838',
  previousCanaryUniversityIds: previous, desiredCanaryUniversityIds: desired, enabled: true, modelsEnabled: true }
function gate(overrides: Record<string, unknown> = {}) {
  return { format: 'studyinchina.cloud-maintenance-runtime-gate', version: 1, fullHealthChecked: false, enabled: true, scopeMatches: true,
    backend: { state: 'ready' }, control: { scope_sha256: intent.scopeRegistrySha256, legacy_guard_sha256: intent.legacyGuardSha256,
      input_catalog_sha256: 'b'.repeat(64), seed_sha256: 'c'.repeat(64), revision: 1, enabled: 1, models_enabled: 1,
      seed_complete: 1, targets_complete: 1, canary_json: JSON.stringify(previous), ...overrides } }
}
const client = () => ({ json: vi.fn<MaintenanceClient['json']>(), artifact: vi.fn<MaintenanceClient['artifact']>() })

describe('durable source-controlled school scope intent reconciliation', () => {
  it('posts once only from the exact revision and initial five, then confirms the desired scope', async () => {
    const c = client()
    c.json.mockResolvedValueOnce(gate()).mockResolvedValueOnce({ revision: 2 }).mockResolvedValueOnce(gate({ revision: 2, canary_json: JSON.stringify(desired) }))
    expect(await activateMaintenanceScopeIntent(c, intent)).toMatchObject({ state: 'satisfied', observedRevision: 2, postAttempted: true })
    expect(c.json.mock.calls).toEqual([
      ['/runtime-gate'], ['/controls', 'POST', { expectedRevision: 1, legacyGuardSha256: intent.legacyGuardSha256,
        enabled: true, modelsEnabled: true, canaryUniversityIds: desired }], ['/runtime-gate'],
    ])
  })

  it('observes an already applied scope idempotently without any control mutation', async () => {
    const c = client(); c.json.mockResolvedValue(gate({ revision: 2, canary_json: JSON.stringify([...desired].reverse()) }))
    expect(await activateMaintenanceScopeIntent(c, intent)).toMatchObject({ state: 'satisfied', postAttempted: false })
    expect(c.json.mock.calls).toEqual([['/runtime-gate']])
  })

  it('preserves operator pauses, model pauses, changed revisions and a different active scope', async () => {
    for (const [overrides, reason] of [
      [{ enabled: 0 }, 'operator_pause_preserved'], [{ models_enabled: 0 }, 'operator_pause_preserved'],
      [{ revision: 2 }, 'control_revision_changed'], [{ canary_json: JSON.stringify(previous.slice(1)) }, 'previous_scope_changed'],
      [{ revision: 3, enabled: 0, canary_json: JSON.stringify(desired) }, 'operator_pause_preserved'],
    ] as const) {
      const c = client(); c.json.mockResolvedValue(gate(overrides))
      expect(await activateMaintenanceScopeIntent(c, intent)).toMatchObject({ state: 'held', reason, postAttempted: false })
      expect(c.json).toHaveBeenCalledTimes(1)
    }
  })

  it('returns a normal quota wait and refuses wrong scope or guard pins before POST', async () => {
    const c = client(); c.json.mockResolvedValue({ ...gate(), backend: { state: 'quota_wait' }, control: null })
    expect(await activateMaintenanceScopeIntent(c, intent)).toMatchObject({ state: 'pending', reason: 'quota_wait', postAttempted: false })
    for (const [overrides, reason] of [[{ scope_sha256: 'f'.repeat(64) }, 'scope_pin_mismatch'], [{ legacy_guard_sha256: 'f'.repeat(64) }, 'legacy_guard_pin_mismatch']] as const) {
      c.json.mockClear().mockResolvedValue(gate(overrides))
      expect(await activateMaintenanceScopeIntent(c, intent)).toMatchObject({ state: 'held', reason, postAttempted: false })
      expect(c.json).toHaveBeenCalledTimes(1)
    }
  })

  it('never resends after an ambiguous POST and reconciles an eventual application next run', async () => {
    const c = client()
    c.json.mockResolvedValueOnce(gate()).mockRejectedValueOnce(new Error('response lost after send')).mockResolvedValueOnce(gate())
    expect(await activateMaintenanceScopeIntent(c, intent)).toMatchObject({ state: 'pending', reason: 'activation_outcome_unknown', postAttempted: true })
    expect(c.json.mock.calls.filter(call => call[1] === 'POST')).toHaveLength(1)
    expect(c.json).toHaveBeenCalledTimes(3)
    c.json.mockResolvedValue(gate({ revision: 2, canary_json: JSON.stringify(desired) }))
    expect(await activateMaintenanceScopeIntent(c, intent)).toMatchObject({ state: 'satisfied', postAttempted: false })
    expect(c.json.mock.calls.filter(call => call[1] === 'POST')).toHaveLength(1)
  })

  it('retains an unknown outcome if the single reconciliation read also hits quota', async () => {
    const c = client()
    c.json.mockResolvedValueOnce(gate()).mockRejectedValueOnce(new Error('ambiguous controls response'))
      .mockResolvedValueOnce({ ...gate(), backend: { state: 'quota_wait' }, control: null })
    expect(await activateMaintenanceScopeIntent(c, intent)).toMatchObject({ state: 'pending', reason: 'activation_outcome_unknown', postAttempted: true })
    expect(c.json).toHaveBeenCalledTimes(3)
  })

  it('holds a concurrent operator pause discovered after the POST instead of resuming or retrying', async () => {
    const c = client()
    c.json.mockResolvedValueOnce(gate()).mockRejectedValueOnce(new Error('revision conflict')).mockResolvedValueOnce(gate({ revision: 2, enabled: 0 }))
    expect(await activateMaintenanceScopeIntent(c, intent)).toMatchObject({ state: 'held', reason: 'operator_pause_preserved', postAttempted: true })
    expect(c.json.mock.calls.filter(call => call[1] === 'POST')).toHaveLength(1)
  })

  it('validates all school IDs against the immutable local scope and rejects caller changes before reading cloud state', async () => {
    for (const invalid of [{ ...intent, expectedRevision: 2 }, { ...intent, enabled: false },
      { ...intent, desiredCanaryUniversityIds: [...desired.slice(0, 24), desired[0]] },
      { ...intent, desiredCanaryUniversityIds: [...desired.slice(0, 24), 'uni-outside-scope'] }]) {
      const c = client()
      await expect(activateMaintenanceScopeIntent(c, invalid)).rejects.toThrow(/maintenance_scope_intent_/)
      expect(c.json).not.toHaveBeenCalled()
    }
  })

  it('reconciles the checked-in intent before the ordinary tick and retains the decision in workflow artifacts', () => {
    const workflow = readFileSync(resolve('.github/workflows/catalog-maintenance-tick.yml'), 'utf8')
    const activate = workflow.indexOf('activate-scope-intent content/maintenance/expansion-scope-intent.v1.json')
    expect(activate).toBeGreaterThan(0)
    expect(activate).toBeLessThan(workflow.indexOf('catalog-maintenance-client.ts tick'))
    expect(workflow).toContain('${{ runner.temp }}/catalog-maintenance-tick/scope-intent.json')
    expect(workflow).toContain('tick, status, scopeIntent')
  })
})
