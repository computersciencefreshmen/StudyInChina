import type { MaintenanceEnv } from './types'
import { canonical, digest, HASH, record } from './util'

/** Checked registry pin; changing it requires a new reviewed additive scope version. */
export const EXISTING_SCHOOLS_V2_SHA256 = '1481aee8a203ca4819eb3ccca17b6a76824f2d1521d6afdb98aaf2075e4710a4'
export function isPinnedScopeTransition(env: MaintenanceEnv, previous: string): boolean {
  return previous === 'c1703d2dd6b70ae533e7817e1e11393dbc6319672ba6ab97b01f0d2e66f53316'
    && env.SCOPE_REGISTRY_SHA256 === EXISTING_SCHOOLS_V2_SHA256 && expectedScopeSchoolCount(env) === 295
}

export function expectedScopeSchoolCount(env: Pick<MaintenanceEnv, 'SCOPE_SCHOOL_COUNT'>): 272 | 295 {
  if (env.SCOPE_SCHOOL_COUNT === undefined || env.SCOPE_SCHOOL_COUNT === '272') return 272
  if (env.SCOPE_SCHOOL_COUNT === '295') return 295
  throw new Error('maintenance_scope_school_count_invalid')
}

/** Old immutable seed/resume receipts remain valid only through a committed CAS upgrade. */
export async function scopeUpgradeLineage(env: MaintenanceEnv, previous: string, next: string): Promise<boolean> {
  if (previous === next) return true
  if (!HASH.test(previous) || !HASH.test(next)) return false
  let row: { receipt_key: string; receipt_sha256: string } | null
  try { row = await env.PIPELINE_DB.prepare("SELECT receipt_key,receipt_sha256 FROM maintenance_scope_upgrades WHERE previous_scope_sha256=? AND next_scope_sha256=? AND status='completed'")
    .bind(previous, next).first<{ receipt_key: string; receipt_sha256: string }>() }
  catch (error) {
    if (/(?:^|\b)no such table: (?:main\.)?maintenance_scope_upgrades(?:\b|$)/u.test(error instanceof Error ? error.message : String(error))) return false
    throw error
  }
  if (!row || !HASH.test(row.receipt_sha256)) return false
  const object = await env.SNAPSHOTS_BUCKET.get(row.receipt_key)
  if (!object || object.size !== undefined && object.size > 32768) return false
  const text = await object.text(), receipt = record(JSON.parse(text))
  return await digest(text) === row.receipt_sha256 && canonical(receipt) === text
    && receipt?.previousScopeSha256 === previous && receipt.nextScopeSha256 === next
    && receipt.outcome === 'completed' && receipt.legacyGuardsPreserved === true
}
