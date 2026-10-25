import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { openLocalRuntime } from '../../scripts/maintenance/local-runtime'

const roots: string[] = [], runtimes: Array<Awaited<ReturnType<typeof openLocalRuntime>>> = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'maintenance-local-runtime-')); roots.push(root)
  const runtime = await openLocalRuntime({ directory: root }); runtimes.push(runtime)
  return { root, ...runtime }
}
afterEach(async () => {
  for (const runtime of runtimes.splice(0).reverse()) await runtime.close()
  for (const root of roots.splice(0)) {
    const absolute = resolve(root)
    if (dirname(absolute) !== resolve(tmpdir()) || !basename(absolute).startsWith('maintenance-local-runtime-')) throw new Error('Unexpected cleanup target')
    await rm(absolute, { recursive: true, force: true })
  }
})

describe('persistent production maintenance adapters', () => {
  it('preserves real Worker tables, object bytes, durable reservations and queued messages across reopening', async () => {
    const first = await fixture()
    await first.db.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind('event-one', 'fixture', '2026-10-25T00:00:00.000Z', '{}').run()
    await first.bucket.put('maintenance/proof.json', 'immutable official proof', { onlyIf: { etagDoesNotMatch: '*' } })
    await first.storage.put('request:reserved', { state: 'send_started', attemptId: 'reserved-before-network' })
    await first.queue.send({ version: 1, jobId: 'durable-work' })
    await expect(openLocalRuntime({ directory: first.root })).rejects.toThrow('local_runtime_already_locked')
    await first.close()
    const next = await openLocalRuntime({ directory: first.root }); runtimes.push(next)
    expect(await next.db.prepare('SELECT event_id FROM maintenance_events').first()).toEqual({ event_id: 'event-one' })
    expect(await (await next.bucket.get('maintenance/proof.json'))!.text()).toBe('immutable official proof')
    expect(await next.storage.get('request:reserved')).toEqual({ state: 'send_started', attemptId: 'reserved-before-network' })
    expect(next.queue.count()).toBe(1)
    expect((await next.queue.claim()).messages[0].body.jobId).toBe('durable-work')
  })
  it('rolls back an entire D1 batch instead of applying an earlier mutation on failure', async () => {
    const f = await fixture()
    await expect(f.db.batch([
      f.db.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind('duplicate', 'fixture', '2026-10-25T00:00:00.000Z', '{}'),
      f.db.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind('duplicate', 'fixture', '2026-10-25T00:00:00.000Z', '{}'),
    ])).rejects.toThrow()
    expect(await f.db.prepare('SELECT COUNT(*) count FROM maintenance_events').first()).toEqual({ count: 0 })
  })
  it('atomically admits one concurrent create/CAS and exports only committed object versions', async () => {
    const f = await fixture(), key = 'maintenance/same.json'
    const created = await Promise.all([f.bucket.put(key, 'same bytes', { onlyIf: { etagDoesNotMatch: '*' } }), f.bucket.put(key, 'same bytes', { onlyIf: { etagDoesNotMatch: '*' } })])
    expect(created.filter(Boolean)).toHaveLength(1)
    const original = (await f.bucket.get(key))!
    const replacements = await Promise.all([f.bucket.put(key, 'next-one', { onlyIf: { etagMatches: original.etag } }), f.bucket.put(key, 'next-two', { onlyIf: { etagMatches: original.etag } })])
    expect(replacements.filter(Boolean)).toHaveLength(1)
    const current = (await f.bucket.get(key))!, entries = await f.bucket.list()
    expect(entries).toEqual([{ key, sha256: current.etag, byteLength: current.size }])
    expect(await original.text()).toBe('same bytes')
    expect(await f.bucket.put(key, 'never', { onlyIf: { etagMatches: 'wrong' } })).toBeNull()
  })
  it('rejects traversal, symlinked storage and changed artifact bytes', async () => {
    const f = await fixture()
    for (const key of ['../outside', '/absolute', 'maintenance/../outside', 'maintenance\\outside', 'maintenance/%2e%2e/escape']) {
      await expect(f.bucket.put(key, 'blocked')).rejects.toThrow('local_bucket_key_invalid')
    }
    await f.bucket.put('maintenance/check.json', 'checked')
    const [entry] = await f.bucket.list()
    await writeFile(join(f.root, 'bucket/objects', `${entry.sha256}.blob`), 'tampered')
    await expect(f.bucket.get(entry.key)).rejects.toThrow('local_bucket_checksum_mismatch')
    const target = await mkdtemp(join(tmpdir(), 'maintenance-local-runtime-')); roots.push(target)
    const link = join(f.root, 'unsafe-link')
    await symlink(target, link, 'junction')
    await expect(openLocalRuntime({ directory: link })).rejects.toThrow('local_runtime_symlink_rejected')
    const broken = join(f.root, 'broken-link')
    await symlink(join(target, 'not-yet-created'), broken, 'junction')
    await expect(openLocalRuntime({ directory: broken })).rejects.toThrow('local_runtime_symlink_rejected')
    expect(await readFile(join(f.root, '.local-runtime.lock'), 'utf8')).toContain('token')
  })
  it('serializes awaited durable transactions, rolls them back, and leaves send_started intact', async () => {
    const f = await fixture()
    await f.storage.put('counter', 0)
    await Promise.all(Array.from({ length: 10 }, () => f.storage.transaction(async txn => {
      const value = (await txn.get<number>('counter'))!; await Promise.resolve(); await txn.put('counter', value + 1)
    })))
    expect(await f.storage.get('counter')).toBe(10)
    await f.storage.put('request:one', { state: 'send_started' })
    await expect(f.storage.transaction(async txn => { await txn.put('request:one', { state: 'completed' }); throw new Error('response lost') })).rejects.toThrow('response lost')
    expect(await f.storage.get('request:one')).toEqual({ state: 'send_started' })
    await f.storage.transaction(async txn => {
      await txn.put('outer', 1)
      await expect(txn.transaction(async nested => { await nested.put('outer', 2); throw new Error('nested rollback') })).rejects.toThrow('nested rollback')
      expect(await txn.get('outer')).toBe(1)
    })
  })
  it('reclaims expired queue leases while rejecting acknowledgements from the old consumer', async () => {
    const f = await fixture(), now = Date.now()
    await f.queue.send({ version: 1, jobId: 'durable-work' })
    const first = (await f.queue.claim({ now: now + 100, leaseMs: 1000 })).messages[0]
    expect((await f.queue.claim({ now: now + 200 })).messages).toHaveLength(0)
    const second = (await f.queue.claim({ now: now + 1200 })).messages[0]
    expect(second.attempts).toBe(2)
    expect(() => first.ack()).toThrow('local_queue_lease_lost')
    second.ack(); second.ack()
    expect(f.queue.count()).toBe(0)
  })
  it('rejects changed migration bytes without overwriting persisted Worker state', async () => {
    const first = await fixture()
    await first.db.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind('retained', 'fixture', '2026-10-25T00:00:00.000Z', '{}').run()
    await first.close()
    const migration = join(first.root, 'different-migration.sql')
    await writeFile(migration, 'CREATE TABLE IF NOT EXISTS should_never_run(value TEXT);')
    await expect(openLocalRuntime({ directory: first.root, migrationFile: migration })).rejects.toThrow('local_runtime_migration_changed')
    const next = await openLocalRuntime({ directory: first.root }); runtimes.push(next)
    expect(await next.db.prepare('SELECT COUNT(*) count FROM maintenance_events').first()).toEqual({ count: 1 })
    expect(await next.db.prepare("SELECT name FROM sqlite_master WHERE name='should_never_run'").first()).toBeNull()
  })
  it('isolates an outside durable write from an awaited transaction that subsequently rolls back', async () => {
    const f = await fixture()
    let enter = () => {}, finish = () => {}
    const entered = new Promise<void>(done => { enter = done }), gate = new Promise<void>(done => { finish = done })
    const pending = f.storage.transaction(async txn => { await txn.put('inside', 'rollback'); enter(); await gate; throw new Error('abort') })
    await entered
    const outside = f.storage.put('outside', 'retain')
    finish()
    await expect(pending).rejects.toThrow('abort'); await outside
    expect(await f.storage.get('inside')).toBeUndefined()
    expect(await f.storage.get('outside')).toBe('retain')
  })
})
