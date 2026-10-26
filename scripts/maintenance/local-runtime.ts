import { createHash, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { constants, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { link, open, readFile, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { deserialize, serialize } from 'node:v8'
import type { D1Database, D1PreparedStatement, D1Result, QueueMessageBatch, QueueProducer } from '../../workers/publisher/src/types'
import type { Bucket, DurableStorage, MaintenanceMessage } from '../../workers/catalog-maintenance/src/types'

const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const DEFAULT_MIGRATION = import.meta.url.startsWith('file:')
  ? resolve(dirname(fileURLToPath(import.meta.url)), '../../infra/d1/pipeline/migrations/0019_catalog_maintenance.sql')
  : resolve(process.cwd(), 'infra/d1/pipeline/migrations/0019_catalog_maintenance.sql')

/** Local state paths are operator-selected; object keys never become filesystem paths. */
function safePath(path: string, directory = false): string {
  const absolute = resolve(path), root = parse(absolute).root
  let cursor = root
  for (const segment of relative(root, absolute).split(sep).filter(Boolean)) {
    cursor = join(cursor, segment)
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('local_runtime_symlink_rejected')
  }
  if (directory) {
    mkdirSync(absolute, { recursive: true, mode: 0o700 })
    if (!lstatSync(absolute).isDirectory()) throw new Error('local_runtime_directory_invalid')
    return realpathSync(absolute)
  }
  return join(safePath(dirname(absolute), true), basename(absolute))
}

function database(path: string): DatabaseSync {
  const db = new DatabaseSync(safePath(path), { timeout: 5000, enableForeignKeyConstraints: true, allowExtension: false })
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;')
  return db
}
function transaction<T>(db: DatabaseSync, body: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try { const result = body(); db.exec('COMMIT'); return result }
  catch (error) { db.exec('ROLLBACK'); throw error }
}
function bindings(values: unknown[]): SQLInputValue[] {
  return values.map(value => {
    if (value === null || typeof value === 'string' || typeof value === 'bigint' || typeof value === 'number' && Number.isFinite(value)) return value
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    throw new Error('local_d1_binding_invalid')
  })
}

class SqliteStatement implements D1PreparedStatement {
  constructor(readonly owner: SqliteD1, private readonly sql: string, private readonly values: SQLInputValue[] = []) {}
  bind(...values: unknown[]): SqliteStatement { return new SqliteStatement(this.owner, this.sql, bindings(values)) }
  async first<T>(): Promise<T | null> { return this.owner.sqlite.prepare(this.sql).get(...this.values) as T ?? null }
  async all<T>(): Promise<D1Result<T>> { return { success: true, results: this.owner.sqlite.prepare(this.sql).all(...this.values) as T[] } }
  runSync<T>(): D1Result<T> { return { success: true, meta: { changes: Number(this.owner.sqlite.prepare(this.sql).run(...this.values).changes) } } }
  async run<T>(): Promise<D1Result<T>> { return this.runSync<T>() }
}

/** The production Worker migration is applied once, atomically and pinned to its exact bytes. */
export class SqliteD1 implements D1Database {
  readonly sqlite: DatabaseSync
  constructor(filename: string, migrationFile = DEFAULT_MIGRATION) {
    this.sqlite = database(filename)
    try {
      this.sqlite.exec('CREATE TABLE IF NOT EXISTS local_runtime_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)')
      const sql = readFileSync(migrationFile, 'utf8'), hash = sha256(sql), name = 'catalog-maintenance-0019'
      const prior = this.sqlite.prepare('SELECT sha256 FROM local_runtime_migrations WHERE name=?').get(name)
      if (prior && prior.sha256 !== hash) throw new Error('local_runtime_migration_changed')
      if (!prior) transaction(this.sqlite, () => {
        this.sqlite.exec(sql)
        this.sqlite.prepare('INSERT INTO local_runtime_migrations VALUES(?,?,?)').run(name, hash, new Date().toISOString())
      })
    } catch (error) { this.sqlite.close(); throw error }
  }
  prepare(sql: string): D1PreparedStatement { return new SqliteStatement(this, sql) }
  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    if (statements.some(statement => !(statement instanceof SqliteStatement) || statement.owner !== this)) throw new Error('local_d1_foreign_statement')
    return transaction(this.sqlite, () => statements.map(statement => (statement as SqliteStatement).runSync<T>()))
  }
  close(): void { this.sqlite.close() }
}

function objectKey(key: string): void {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,1023}$/u.test(key)
    || key.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw new Error('local_bucket_key_invalid')
}
type BucketRow = { key: string; sha256: string; byte_length: number; etag: string }

/** Blobs are immutable and fsynced before one atomic SQLite CAS publishes their pointer. */
export class DiskBucket implements Bucket {
  private readonly sqlite: DatabaseSync
  private readonly root: string
  constructor(directory: string, private readonly maxObjectBytes = 32 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxObjectBytes) || maxObjectBytes < 1) throw new Error('local_bucket_size_limit_invalid')
    this.root = safePath(directory, true)
    safePath(join(this.root, 'objects'), true)
    this.sqlite = database(join(this.root, 'objects.sqlite'))
    this.sqlite.exec('CREATE TABLE IF NOT EXISTS local_bucket_objects(key TEXT PRIMARY KEY,sha256 TEXT NOT NULL,byte_length INTEGER NOT NULL,etag TEXT NOT NULL,content_type TEXT)')
  }
  private blobPath(hash: string): string {
    if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error('local_bucket_hash_invalid')
    const path = safePath(join(this.root, 'objects', `${hash}.blob`)), inside = relative(this.root, path)
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('local_bucket_path_invalid')
    return path
  }
  async get(key: string) {
    objectKey(key)
    const row = this.sqlite.prepare('SELECT * FROM local_bucket_objects WHERE key=?').get(key) as BucketRow | undefined
    if (!row) return null
    const bytes = await readFile(this.blobPath(row.sha256))
    if (bytes.length !== row.byte_length || sha256(bytes) !== row.sha256) throw new Error('local_bucket_checksum_mismatch')
    return { etag: row.etag, size: bytes.length, text: async () => bytes.toString('utf8'), arrayBuffer: async () => Uint8Array.from(bytes).buffer }
  }
  async put(key: string, body: string | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>, options?: { onlyIf?: { etagDoesNotMatch?: string; etagMatches?: string }; httpMetadata?: { contentType?: string } }) {
    objectKey(key)
    const chunks: Uint8Array[] = []
    let length = 0
    const append = (chunk: Uint8Array) => { length += chunk.byteLength; if (length > this.maxObjectBytes) throw new Error('local_bucket_object_too_large'); chunks.push(Uint8Array.from(chunk)) }
    if (typeof body === 'string') append(Buffer.from(body))
    else if (body instanceof ReadableStream) {
      const reader = body.getReader()
      try { for (;;) { const part = await reader.read(); if (part.done) break; append(part.value) } }
      catch (error) { await reader.cancel().catch(() => {}); throw error }
      finally { reader.releaseLock() }
    } else append(body instanceof ArrayBuffer ? new Uint8Array(body) : body)
    const bytes = Buffer.concat(chunks), hash = sha256(bytes), path = this.blobPath(hash)
    const temporary = safePath(join(dirname(path), `.${hash}.${randomUUID()}.tmp`))
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    try {
      try { await link(temporary, path) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const existing = await readFile(this.blobPath(hash))
        if (existing.length !== bytes.length || sha256(existing) !== hash) throw new Error('local_bucket_checksum_mismatch')
      }
      if (process.platform !== 'win32') {
        const directory = await open(dirname(path), 'r')
        try { await directory.sync() } finally { await directory.close() }
      }
    } finally { await unlink(temporary) }
    return transaction(this.sqlite, () => {
      const old = this.sqlite.prepare('SELECT etag FROM local_bucket_objects WHERE key=?').get(key)
      const condition = options?.onlyIf
      if (condition?.etagMatches !== undefined && old?.etag !== condition.etagMatches
        || condition?.etagDoesNotMatch !== undefined && old && (condition.etagDoesNotMatch === '*' || old.etag === condition.etagDoesNotMatch)) return null
      this.sqlite.prepare('INSERT INTO local_bucket_objects VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET sha256=excluded.sha256,byte_length=excluded.byte_length,etag=excluded.etag,content_type=excluded.content_type')
        .run(key, hash, bytes.length, hash, options?.httpMetadata?.contentType ?? null)
      return { key, etag: hash }
    })
  }
  async list(): Promise<Array<{ key: string; sha256: string; byteLength: number }>> {
    return (this.sqlite.prepare('SELECT key,sha256,byte_length FROM local_bucket_objects ORDER BY key').all() as Array<Omit<BucketRow, 'etag'>>)
      .map(row => ({ key: row.key, sha256: row.sha256, byteLength: row.byte_length }))
  }
  close(): void { this.sqlite.close() }
}

class Serial {
  private tail: Promise<void> = Promise.resolve()
  async run<T>(body: () => Promise<T> | T): Promise<T> {
    const before = this.tail
    let release = () => {}
    this.tail = new Promise<void>(done => { release = done })
    await before
    try { return await body() } finally { release() }
  }
}
const storageLocks = new Map<string, Serial>()

/** Independent connection: an awaited DO transaction cannot include unrelated D1 writes. */
export class SqliteDurableStorage implements DurableStorage {
  private readonly sqlite: DatabaseSync
  private readonly serial: Serial
  private readonly context = new AsyncLocalStorage<boolean>()
  private savepoint = 0
  constructor(filename: string, private readonly namespace = 'subscription-account-v1') {
    if (!namespace || namespace.length > 256) throw new Error('local_storage_namespace_invalid')
    const path = safePath(filename)
    this.sqlite = database(path)
    this.sqlite.exec('CREATE TABLE IF NOT EXISTS local_durable_values(namespace TEXT NOT NULL,key TEXT NOT NULL,value BLOB NOT NULL,PRIMARY KEY(namespace,key))')
    this.serial = storageLocks.get(path) ?? new Serial()
    storageLocks.set(path, this.serial)
  }
  private async isolated<T>(body: () => T): Promise<T> { return this.context.getStore() ? body() : this.serial.run(body) }
  async get<T>(key: string): Promise<T | undefined> {
    return this.isolated(() => {
      const row = this.sqlite.prepare('SELECT value FROM local_durable_values WHERE namespace=? AND key=?').get(this.namespace, key)
      return row ? deserialize(Buffer.from(row.value as Uint8Array)) as T : undefined
    })
  }
  async put<T>(key: string, value: T): Promise<void> {
    const bytes = serialize(value)
    await this.isolated(() => { this.sqlite.prepare('INSERT INTO local_durable_values VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value').run(this.namespace, key, bytes) })
  }
  async delete(key: string): Promise<boolean> {
    return this.isolated(() => Number(this.sqlite.prepare('DELETE FROM local_durable_values WHERE namespace=? AND key=?').run(this.namespace, key).changes) > 0)
  }
  async transaction<T>(body: (txn: DurableStorage) => Promise<T>): Promise<T> {
    const execute = async (nested: boolean) => {
      const point = `local_storage_${++this.savepoint}`
      this.sqlite.exec(nested ? `SAVEPOINT ${point}` : 'BEGIN IMMEDIATE')
      try { const result = await this.context.run(true, () => body(this)); this.sqlite.exec(nested ? `RELEASE SAVEPOINT ${point}` : 'COMMIT'); return result }
      catch (error) { this.sqlite.exec(nested ? `ROLLBACK TO SAVEPOINT ${point}` : 'ROLLBACK'); if (nested) this.sqlite.exec(`RELEASE SAVEPOINT ${point}`); throw error }
    }
    return this.context.getStore() ? execute(true) : this.serial.run(() => execute(false))
  }
  close(): void { this.sqlite.close() }
}

/** At-least-once queue delivery, with persisted due times and token-bound acknowledgements. */
export class SqliteOutbox<T = MaintenanceMessage> implements QueueProducer<T> {
  private readonly sqlite: DatabaseSync
  constructor(filename: string) {
    this.sqlite = database(filename)
    this.sqlite.exec("CREATE TABLE IF NOT EXISTS local_queue_outbox(id TEXT PRIMARY KEY,body BLOB NOT NULL,status TEXT NOT NULL CHECK(status IN('ready','leased','acked')),due_at INTEGER NOT NULL,attempts INTEGER NOT NULL,lease_token TEXT,lease_until INTEGER,created_at INTEGER NOT NULL)")
    this.sqlite.exec('CREATE INDEX IF NOT EXISTS local_queue_due ON local_queue_outbox(status,due_at,lease_until)')
  }
  private delay(seconds = 0): number {
    if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 43200) throw new Error('local_queue_delay_invalid')
    return seconds * 1000
  }
  async send(body: T, options?: { delaySeconds?: number }): Promise<void> {
    const now = Date.now()
    this.sqlite.prepare("INSERT INTO local_queue_outbox VALUES(?,?,'ready',?,0,NULL,NULL,?)").run(randomUUID(), serialize(body), now + this.delay(options?.delaySeconds), now)
  }
  async claim(options: { limit?: number; leaseMs?: number; now?: number } = {}): Promise<QueueMessageBatch<T>> {
    const { limit = 1, leaseMs = 120000, now = Date.now() } = options
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 3600000 || !Number.isSafeInteger(now) || now < 0) throw new Error('local_queue_claim_invalid')
    const rows = transaction(this.sqlite, () => {
      const selected = this.sqlite.prepare("SELECT id,body,attempts FROM local_queue_outbox WHERE (status='ready' AND due_at<=?) OR (status='leased' AND lease_until<=?) ORDER BY due_at,created_at,id LIMIT ?").all(now, now, limit)
      return selected.map(row => {
        const token = randomUUID()
        this.sqlite.prepare("UPDATE local_queue_outbox SET status='leased',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=?").run(token, now + leaseMs, String(row.id))
        return { id: String(row.id), body: row.body as Uint8Array, attempts: Number(row.attempts), token }
      })
    })
    return { messages: rows.map(row => {
      let settled = false
      const settle = (retry: boolean, delaySeconds = 0) => {
        if (settled) return
        const delay = this.delay(delaySeconds)
        const changed = this.sqlite.prepare("UPDATE local_queue_outbox SET status=?,due_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND status='leased' AND lease_token=?")
          .run(retry ? 'ready' : 'acked', Date.now() + delay, String(row.id), row.token)
        if (Number(changed.changes) !== 1) throw new Error('local_queue_lease_lost')
        settled = true
      }
      return { id: String(row.id), body: deserialize(Buffer.from(row.body as Uint8Array)) as T, attempts: Number(row.attempts) + 1,
        ack: () => settle(false), retry: (retryOptions?: { delaySeconds?: number }) => settle(true, retryOptions?.delaySeconds) }
    }) }
  }
  count(): number { return Number(this.sqlite.prepare("SELECT COUNT(*) count FROM local_queue_outbox WHERE status!='acked'").get()!.count) }
  close(): void { this.sqlite.close() }
}

/** A crash leaves a visible lock; paid-request uncertainty is never cleared from a PID guess. */
export async function acquireLocalRuntimeLock(directory: string): Promise<{ release(): Promise<void> }> {
  const root = safePath(directory, true), path = safePath(join(root, '.local-runtime.lock')), token = randomUUID()
  let file
  try { file = await open(path, 'wx', 0o600) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('local_runtime_already_locked'); throw error }
  try { await file.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() })); await file.sync() }
  catch (error) { await file.close(); throw error }
  let released = false
  return { async release() {
    if (released) return
    const current = JSON.parse(await readFile(safePath(path), 'utf8')) as { token?: unknown }
    if (current.token !== token) throw new Error('local_runtime_lock_changed')
    await file.close(); await unlink(path); released = true
  } }
}

export async function openLocalRuntime(options: { directory: string; migrationFile?: string; maxObjectBytes?: number }) {
  const root = safePath(options.directory, true), lock = await acquireLocalRuntimeLock(root)
  const opened: Array<{ close(): void }> = []
  try {
    const db = new SqliteD1(join(root, 'pipeline.sqlite'), options.migrationFile); opened.push(db)
    const bucket = new DiskBucket(join(root, 'bucket'), options.maxObjectBytes); opened.push(bucket)
    const storage = new SqliteDurableStorage(join(root, 'durable.sqlite')); opened.push(storage)
    const queue = new SqliteOutbox<MaintenanceMessage>(join(root, 'outbox.sqlite')); opened.push(queue)
    let closed = false
    return { db, bucket, storage, queue, async close() {
      if (closed) return
      for (const resource of [...opened].reverse()) resource.close()
      await lock.release(); closed = true
    } }
  } catch (error) { for (const resource of opened.reverse()) resource.close(); await lock.release(); throw error }
}
