import { realpathSync, statSync } from 'node:fs'

/** JSON-compatible snapshots only; freeze nested objects before sharing across requests. */
export function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child)
    Object.freeze(value)
  }
  return value
}

function fileState(path: string): string {
  try {
    const stat = statSync(path, { bigint: true })
    // Native resolution preserves symlink-change detection without JS walking
    // every ancestor separately for each receipt (especially costly on Windows).
    return [realpathSync.native(path), stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
}

/** Synchronous initialization cannot interleave in one JS isolate. No failure is cached.
 * Vercel deployment files are immutable; mutable local files are checked on every hit.
 * No TTL and no full-data serialization is needed to obtain the key.
 */
export function createFileSnapshotCache<T>(maximumEntries = 4) {
  const snapshots = new Map<string, { dependencies: Map<string, string>; value: T }>()
  const unchanged = (dependencies: Map<string, string>) =>
    [...dependencies].every(([path, state]) => fileState(path) === state)
  return (key: string, load: (depend: (path: string) => void) => T): T => {
    const cached = snapshots.get(key)
    if (cached && unchanged(cached.dependencies)) return cached.value
    snapshots.delete(key)
    for (let attempt = 0; attempt < 3; attempt++) {
      const dependencies = new Map<string, string>()
      const value = load(path => { dependencies.set(path, fileState(path)) })
      // Do not publish a mixed generation if a writer changed evidence while reading it.
      if (!unchanged(dependencies)) continue
      const frozen = freezeSnapshot(value)
      if (snapshots.size >= maximumEntries) snapshots.delete(snapshots.keys().next().value!)
      snapshots.set(key, { dependencies, value: frozen })
      return frozen
    }
    throw Error('catalog_snapshot_changed_during_read')
  }
}
