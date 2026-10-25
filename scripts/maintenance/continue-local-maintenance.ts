import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { serialize } from 'node:v8'
import { z } from 'zod'
import { canonicalJson, sha256Schema, sourceSeedSchema, type SourceSeed } from './contracts'
import { acquireLocalRuntimeLock } from './local-runtime'
import { offlineHandoffSchema } from '../../workers/catalog-maintenance/src/offline-handoff-contract'
import { record } from '../../workers/catalog-maintenance/src/util'

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const fenceSchema = z.object({ batchId: z.string().min(1), token: sha256Schema, scopeRegistrySha256: sha256Schema,
  inputCatalogSha256: sha256Schema, seedSha256: sha256Schema, legacyGuardSha256: sha256Schema, sourceManifestSha256: sha256Schema }).strict()
export type ContinueLocalMaintenanceOptions = { fromDirectory: string; toDirectory: string; newSourceFile: string; execute: boolean;
  workerUrl?: string; adminToken?: string }

function plainPath(path: string): string {
  const absolute = resolve(path), root = parse(absolute).root
  let cursor = root
  for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
    cursor = join(cursor, part)
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error('continuation_symlink_rejected') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return absolute
}
function insideBuild(path: string): string {
  const absolute = plainPath(path), child = relative(resolve('.pipeline-build'), absolute)
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('continuation_outside_pipeline_build')
  return absolute
}
function noSymlinks(path: string): void {
  const info = lstatSync(path)
  if (info.isSymbolicLink()) throw new Error('continuation_symlink_rejected')
  if (info.isDirectory()) for (const name of readdirSync(path)) noSymlinks(join(path, name))
  else if (!info.isFile()) throw new Error('continuation_special_file_rejected')
}
function privateFile(path: string, bytes: string | Uint8Array): void {
  const fd = openSync(path, 'wx', 0o600)
  try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
}
function json(bytes: Uint8Array): unknown {
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw new Error('continuation_json_invalid') }
}
function sources(bytes: Uint8Array): SourceSeed[] {
  const input = record(json(bytes))
  if (!Array.isArray(input?.sources)) throw new Error('continuation_source_manifest_invalid')
  const values = input.sources.map(value => sourceSeedSchema.safeParse(value))
  if (values.some(value => !value.success)) throw new Error('continuation_source_manifest_invalid')
  return values.map(value => value.data!)
}
const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`
function databaseFingerprint(db: DatabaseSync) {
  const digest = createHash('sha256'), tables: Record<string, number> = {}
  for (const table of db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    const name = String(table.name), columns = db.prepare(`PRAGMA table_info(${identifier(name)})`).all().map(column => identifier(String(column.name)))
    digest.update(serialize({ name, sql: table.sql }))
    let count = 0
    for (const row of db.prepare(`SELECT * FROM ${identifier(name)} ORDER BY ${columns.join(',')}`).iterate()) {
      const bytes = serialize(row); digest.update(`${bytes.length}:`); digest.update(bytes); count++
    }
    tables[name] = count
  }
  return { sha256: digest.digest('hex'), tables }
}
async function backupDatabase(from: string, to: string) {
  if (existsSync(to)) throw new Error('continuation_backup_target_exists')
  const db = new DatabaseSync(from, { readOnly: true })
  try {
    const before = databaseFingerprint(db), pages = await backup(db, to)
    const copied = new DatabaseSync(to, { readOnly: true })
    try {
      if (copied.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok'
        || canonicalJson(databaseFingerprint(copied)) !== canonicalJson(before)
        || canonicalJson(databaseFingerprint(db)) !== canonicalJson(before)) throw new Error('continuation_backup_verification_failed')
    } finally { copied.close() }
    return { pages, ...before, fileSha256: hash(readFileSync(to)) }
  } finally { db.close() }
}
function copyTree(from: string, to: string): void {
  const info = lstatSync(from)
  if (info.isSymbolicLink()) throw new Error('continuation_symlink_rejected')
  if (info.isDirectory()) { mkdirSync(to, { mode: 0o700 }); for (const name of readdirSync(from)) copyTree(join(from, name), join(to, name)) }
  else if (info.isFile()) privateFile(to, readFileSync(from))
  else throw new Error('continuation_special_file_rejected')
}

/** Prepare a reversible local copy only. The cloud must separately authorize a
 * continuation before the runner's paid-request ownership checks can pass. */
export async function continueLocalMaintenance(options: ContinueLocalMaintenanceOptions) {
  const from = insideBuild(options.fromDirectory), to = insideBuild(options.toDirectory)
  if (existsSync(to)) throw new Error('continuation_target_exists')
  const nested = relative(from, to)
  if (!nested.startsWith('..') && !isAbsolute(nested)) throw new Error('continuation_target_inside_parent')
  if (!lstatSync(from).isDirectory()) throw new Error('continuation_parent_directory_invalid')
  const lock = await acquireLocalRuntimeLock(from)
  try {
    noSymlinks(from)
    const fenceBytes = readFileSync(join(from, 'fence-private.json')), parsedFence = fenceSchema.safeParse(json(fenceBytes))
    if (!parsedFence.success) throw new Error('continuation_parent_fence_invalid')
    const fence = parsedFence.data, parentBytes = readFileSync(join(from, 'handoff.json')), parentSha256 = hash(parentBytes)
    const parsedParent = offlineHandoffSchema.safeParse(json(parentBytes))
    if (!parsedParent.success) throw new Error('continuation_parent_handoff_invalid')
    const parent = parsedParent.data
    for (const key of ['batchId', 'scopeRegistrySha256', 'inputCatalogSha256', 'seedSha256', 'legacyGuardSha256'] as const) {
      if (parent[key] !== fence[key]) throw new Error('continuation_parent_pin_mismatch')
    }
    if (canonicalJson(parent) !== parentBytes.toString('utf8')) throw new Error('continuation_parent_not_canonical')
    const metaBytes = readFileSync(join(from, 'handoff-meta.json')), meta = record(json(metaBytes))
    if (meta?.manifestSha256 !== parentSha256 || meta.sourceManifestSha256 !== fence.sourceManifestSha256) throw new Error('continuation_parent_metadata_mismatch')
    const parentSourcePath = [join(from, 'source-manifest.json'), resolve('scripts/maintenance/pilot-sources.json')]
      .find(path => existsSync(path) && hash(readFileSync(plainPath(path))) === fence.sourceManifestSha256)
    if (!parentSourcePath) throw new Error('continuation_parent_source_manifest_unavailable')
    const oldSourceBytes = readFileSync(parentSourcePath), oldSources = sources(oldSourceBytes)
    const sourceBytes = readFileSync(plainPath(options.newSourceFile)), newSources = sources(sourceBytes)
    const newSourceManifestSha256 = hash(sourceBytes)
    if (newSourceManifestSha256 === fence.sourceManifestSha256) throw new Error('continuation_has_no_new_source_manifest')
    for (const old of oldSources) if (!newSources.some(value => canonicalJson(value) === canonicalJson(old))) throw new Error('continuation_removed_or_changed_parent_source')
    const enabled = newSources.filter(source => source.enabled)
    if (!enabled.length || enabled.length > 20 || new Set(newSources.map(source => source.url)).size > 20) throw new Error('continuation_source_limit_exceeded')
    const database = new DatabaseSync(join(from, 'pipeline.sqlite'), { readOnly: true })
    try {
      const cfg = database.prepare('SELECT * FROM maintenance_control WHERE singleton=1').get()
      if (!cfg || cfg.scope_sha256 !== fence.scopeRegistrySha256 || cfg.input_catalog_sha256 !== fence.inputCatalogSha256
        || cfg.seed_sha256 !== fence.seedSha256 || cfg.legacy_guard_sha256 !== fence.legacyGuardSha256) throw new Error('continuation_local_control_pin_mismatch')
      if (database.prepare("SELECT COUNT(*) count FROM maintenance_jobs WHERE status='running' OR lease_token IS NOT NULL OR lease_until IS NOT NULL").get()?.count !== 0) throw new Error('continuation_parent_jobs_running')
      for (const source of enabled) {
        const school = database.prepare('SELECT seed_json FROM maintenance_schools WHERE university_id=? AND scope_sha256=?').get(source.universityId, fence.scopeRegistrySha256)
        if (!school) throw new Error('continuation_source_school_outside_scope')
        const schoolSeed = record(json(Buffer.from(String(school.seed_json))))
        const families = Array.isArray(schoolSeed?.sourceSeeds) ? schoolSeed.sourceSeeds.flatMap(seed => {
          const value = record(seed); return Array.isArray(value?.allowedHosts) ? value.allowedHosts.filter((host): host is string => typeof host === 'string') : []
        }) : []
        const host = new URL(source.url).hostname
        if (!families.some(family => host === family || host.endsWith(`.${family}`))) throw new Error('continuation_source_host_outside_scope')
      }
    } finally { database.close() }
    const plan = { format: 'studyinchina.local-maintenance-continuation', version: 1, parentManifestSha256: parentSha256,
      batchId: fence.batchId, fromDirectory: from, toDirectory: to, oldSourceManifestSha256: fence.sourceManifestSha256,
      newSourceManifestSha256, enabledSourceCount: enabled.length, uniqueUrlCount: new Set(enabled.map(source => source.url)).size,
      cloudReopenRequired: true, networkPerformed: false, modelsExecuted: false }
    if (!options.execute) return { ...plan, prepared: false as const }
    mkdirSync(to, { mode: 0o700 })
    const marker = join(to, 'continuation-incomplete.json'); privateFile(marker, canonicalJson(plan))
    const backups: Record<string, unknown> = {}
    for (const file of ['pipeline.sqlite', 'durable.sqlite', 'outbox.sqlite', 'bucket/objects.sqlite']) {
      if (file.startsWith('bucket/')) mkdirSync(join(to, 'bucket'), { mode: 0o700 })
      backups[file] = await backupDatabase(join(from, file), join(to, file))
    }
    mkdirSync(join(to, 'bucket', 'objects'), { mode: 0o700 })
    let blobCount = 0
    for (const name of readdirSync(join(from, 'bucket', 'objects')).sort()) {
      if (!/^[a-f0-9]{64}\.blob$/u.test(name)) throw new Error('continuation_unexpected_blob_file')
      const bytes = readFileSync(join(from, 'bucket', 'objects', name))
      if (hash(bytes) !== name.slice(0, 64)) throw new Error('continuation_blob_checksum_mismatch')
      privateFile(join(to, 'bucket', 'objects', name), bytes); blobCount++
    }
    const provenance = join(to, 'continuation-parent'); mkdirSync(provenance, { mode: 0o700 })
    privateFile(join(provenance, 'handoff.json'), parentBytes)
    privateFile(join(provenance, 'handoff-meta.json'), metaBytes)
    privateFile(join(provenance, 'source-manifest.json'), oldSourceBytes)
    if (existsSync(join(from, 'handoff-upload'))) copyTree(join(from, 'handoff-upload'), join(provenance, 'handoff-upload'))
    privateFile(join(to, 'source-manifest.json'), sourceBytes)
    // Keep exactly the original seven fence fields. Provenance is separate.
    privateFile(join(to, 'fence-private.json'), canonicalJson({ ...fence, sourceManifestSha256: newSourceManifestSha256 }))
    if (!readFileSync(join(from, 'handoff.json')).equals(parentBytes) || !readFileSync(join(from, 'fence-private.json')).equals(fenceBytes)) throw new Error('continuation_parent_changed')
    const receipt = { ...plan, prepared: true as const, blobCount, backups }
    privateFile(join(to, 'continuation-receipt.json'), canonicalJson(receipt))
    unlinkSync(marker)
    return receipt
  } finally { await lock.release() }
}

async function main() {
  const args = process.argv.slice(2), option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
  const fromDirectory = option('--from'), toDirectory = option('--to'), newSourceFile = option('--sources')
  if (!fromDirectory || !toDirectory || !newSourceFile) throw new Error('continuation_arguments_required')
  console.log(JSON.stringify(await continueLocalMaintenance({ fromDirectory, toDirectory, newSourceFile, execute: args.includes('--execute') })))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  console.error('local_continuation_failed; retain any incomplete copy for inspection and keep the frozen parent')
  process.exitCode = 1
})
