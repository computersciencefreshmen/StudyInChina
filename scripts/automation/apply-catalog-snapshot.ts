import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle } from '../../src/lib/data/types'

export const catalogSnapshotFilenames = { universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships', cities: 'cities', sources: 'sources' } as const
export const catalogSnapshotLockFilename = '.catalog-snapshot-apply.lock'
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

type BaselineFile = { key: keyof typeof catalogSnapshotFilenames; path: string; bytes: Buffer; sha256: string }
export type CatalogSnapshotBaseline = { directory: string; bundle: DataBundle; files: BaselineFile[] }

/** Reads exactly the bytes assessed later; importing this module never reads content/data. */
export function readCatalogSnapshotBaseline(directory: string): CatalogSnapshotBaseline {
  const absoluteDirectory = resolve(directory)
  const files = Object.entries(catalogSnapshotFilenames).map(([key, filename]) => {
    const path = join(absoluteDirectory, `${filename}.json`)
    const bytes = readFileSync(path)
    return { key: key as keyof typeof catalogSnapshotFilenames, path, bytes, sha256: sha256(bytes) }
  })
  const bundle = bundleSchema.parse(Object.fromEntries(files.map(file => [file.key, JSON.parse(file.bytes.toString('utf8'))])))
  return { directory: absoluteDirectory, bundle, files }
}

function assertUnchanged(file: BaselineFile) {
  let current: Buffer
  try { current = readFileSync(file.path) } catch { throw new Error(`snapshot_baseline_changed:${file.key}`) }
  if (!current.equals(file.bytes) || sha256(current) !== file.sha256) throw new Error(`snapshot_baseline_changed:${file.key}`)
}

function writeStaged(path: string, bytes: Buffer) {
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(descriptor, bytes)
    fsyncSync(descriptor)
  } finally { closeSync(descriptor) }
}

function readIfPresent(path: string): Buffer | undefined {
  try { return readFileSync(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export class CatalogSnapshotApplyError extends Error {
  constructor(cause: unknown, readonly preservedExternalFiles: string[], readonly rollbackFailures: string[]) {
    const reason = cause instanceof Error ? cause.message : 'snapshot_apply_failed'
    super(`${reason}; external_changes_preserved=${preservedExternalFiles.join(',') || 'none'}; rollback_failures=${rollbackFailures.join(',') || 'none'}`, { cause })
    this.name = 'CatalogSnapshotApplyError'
  }
}

/**
 * Apply only after ALL release, identity, field and evidence assessments pass.
 * The exclusive lock coordinates other instances of this writer. Byte/hash checks
 * catch unrelated edits before staging and immediately before each replacement.
 * Each rename is atomic on one filesystem; all six files are NOT a database
 * transaction. Non-cooperating editors can still race between a check and rename.
 * These are local changes only: the workflow's final Git commit publishes them.
 * A crash may leave a lock; never steal or automatically delete an existing lock.
 */
export function applyCatalogSnapshotFiles(
  baseline: CatalogSnapshotBaseline,
  bundle: DataBundle,
  operations: { replaceFile?: (source: string, destination: string) => void } = {},
) {
  const replaceFile = operations.replaceFile ?? renameSync
  const token = randomUUID()
  // Serialize every candidate before acquiring the lock or touching any target.
  const entries = baseline.files.map(file => ({ ...file, next: Buffer.from(`${JSON.stringify(bundle[file.key], null, 2)}\n`), staged: `${file.path}.${token}.snapshot-tmp` }))
  const lockPath = join(baseline.directory, catalogSnapshotLockFilename)
  const lockContents = Buffer.from(JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }))
  let descriptor: number
  try { descriptor = openSync(lockPath, 'wx', 0o600) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('snapshot_apply_locked')
    throw error
  }
  const attempted: typeof entries = []
  const temporaryFiles = new Set<string>()
  try {
    try { writeFileSync(descriptor, lockContents) } finally { closeSync(descriptor) }
    baseline.files.forEach(assertUnchanged)
    for (const entry of entries) {
      temporaryFiles.add(entry.staged)
      writeStaged(entry.staged, entry.next)
    }
    // No target is changed until all six temporary files are complete.
    baseline.files.forEach(assertUnchanged)
    for (const entry of entries) {
      assertUnchanged(entry)
      attempted.push(entry)
      replaceFile(entry.staged, entry.path)
    }
    for (const entry of entries) {
      if (!readIfPresent(entry.path)?.equals(entry.next)) throw new Error(`snapshot_changed_during_apply:${entry.key}`)
    }
    return { filesReplaced: entries.length, atomicity: 'per-file-only' as const, publication: 'local-files-awaiting-git-commit' as const }
  } catch (error) {
    const preservedExternalFiles: string[] = []
    const rollbackFailures: string[] = []
    for (const entry of attempted.toReversed()) {
      try {
        const current = readIfPresent(entry.path)
        if (current?.equals(entry.bytes)) continue
        if (!current?.equals(entry.next)) { preservedExternalFiles.push(entry.key); continue }
        const rollback = `${entry.path}.${token}.rollback-tmp`
        temporaryFiles.add(rollback)
        writeStaged(rollback, entry.bytes)
        // Roll back only our exact bytes; never overwrite a later external edit.
        if (!readIfPresent(entry.path)?.equals(entry.next)) { preservedExternalFiles.push(entry.key); continue }
        replaceFile(rollback, entry.path)
      } catch { rollbackFailures.push(entry.key) }
    }
    throw new CatalogSnapshotApplyError(error, preservedExternalFiles, rollbackFailures)
  } finally {
    for (const path of temporaryFiles) {
      try { unlinkSync(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`snapshot_temp_cleanup_failed:${path}`) }
    }
    // Ownership is checked so another process's replacement lock is retained.
    if (readIfPresent(lockPath)?.equals(lockContents)) unlinkSync(lockPath)
  }
}
