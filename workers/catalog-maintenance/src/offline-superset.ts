import { canonicalJson } from '../../../scripts/maintenance/contracts'
import { OFFLINE_TABLES, type OfflineHandoff, type OfflineTableName } from './offline-handoff-contract'
import { MaintenanceError } from './types'

const invalid = () => { throw new MaintenanceError('offline_handoff_superset_invalid') }

function indexBy(rows: readonly unknown[], keys: readonly string[]): Map<string, string> {
  const indexed = new Map<string, string>()
  for (const value of rows) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
    const row = value as Record<string, unknown>
    if (keys.some(key => !Object.hasOwn(row, key))) invalid()
    const key = canonicalJson(keys.map(column => row[column]))
    if (indexed.has(key)) invalid()
    indexed.set(key, canonicalJson(row))
  }
  return indexed
}

function preserveRows(current: readonly unknown[], prior: readonly unknown[], keys: readonly string[]): void {
  const next = indexBy(current, keys), previous = indexBy(prior, keys)
  for (const [key, value] of previous) if (next.get(key) !== value) invalid()
}

/** Reopening a frozen batch can append evidence, never rewrite its paid history or old rows. */
export function assertOfflineSuperset(current: OfflineHandoff, prior: OfflineHandoff): void {
  try {
    for (const key of ['format', 'version', 'batchId', 'scopeRegistrySha256', 'inputCatalogSha256', 'seedSha256', 'legacyGuardSha256'] as const) {
      if (current[key] !== prior[key]) invalid()
    }
    for (const table of Object.keys(OFFLINE_TABLES) as OfflineTableName[]) {
      preserveRows(current.tableRows[table], prior.tableRows[table], OFFLINE_TABLES[table].primaryKeys)
    }
    preserveRows(current.artifacts, prior.artifacts, ['objectKey'])
    preserveRows(current.requestReservations, prior.requestReservations, ['reservationKey'])
  } catch (error) {
    if (error instanceof MaintenanceError && error.code === 'offline_handoff_superset_invalid') throw error
    invalid()
  }
}
