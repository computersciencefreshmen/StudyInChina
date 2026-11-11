import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { maintenanceScopeSchema, type MaintenanceScope } from './contracts'

/** An immutable export is always interpreted using its own original registry. */
export function readMaintenanceScope(root: string, sha256?: string): MaintenanceScope {
  const directory = join(root, 'content/maintenance')
  const names = readdirSync(directory).filter(name => /^scope-\d+\.v\d+\.json$/u.test(name))
  const scopes = names.map(name => maintenanceScopeSchema.parse(JSON.parse(readFileSync(join(directory, name), 'utf8'))))
  if (sha256) {
    const matches = scopes.filter(scope => scope.sha256 === sha256)
    if (matches.length !== 1) throw new Error('maintenance_export_scope_unavailable_or_ambiguous')
    return matches[0]
  }
  return scopes.sort((a, b) => b.formatVersion - a.formatVersion)[0]
    ?? (() => { throw new Error('maintenance_scope_registry_unavailable') })()
}
