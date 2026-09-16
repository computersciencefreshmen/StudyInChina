import assert from 'node:assert/strict'
import test from 'node:test'
import { registerAutomaticSourceBindings } from '../src/automatic-source-bindings'
import { sha256Hex, snapshotObjectKey } from '../src/hash'
import type { R2ObjectBody, SourceManifestV1 } from '../src/types'
import { discoveryDatabase, discoveryEnvironment, NOW, seedDiscoverySource } from './discovery-fixtures'

async function fixture(overrides: Partial<SourceManifestV1> = {}) {
  const db = discoveryDatabase()
  const source = seedDiscoverySource(db, { id: `auto-seed-${'a'.repeat(24)}`, allowedRedirectHosts: [], ...overrides })
  db.prepare("UPDATE records SET workflow_status = 'validated' WHERE id = ?").run(source.institutionId)
  const body = new TextEncoder().encode('<html><title>Official admissions</title><body>Programmes</body></html>')
  const hash = await sha256Hex(body)
  const snapshotId = await sha256Hex(`${source.id}:${hash}`)
  const key = snapshotObjectKey(source.id, hash, 'text/html')
  const metadata = { sourceId: source.id, rawSha256: hash, canonicalSha256: hash, fetchedAt: NOW }
  const env = discoveryEnvironment(db)
  env.SNAPSHOTS_BUCKET.get = async (requested): Promise<R2ObjectBody | null> => requested === key ? {
    arrayBuffer: async () => body.slice().buffer,
    customMetadata: metadata,
  } : null
  db.prepare(`INSERT INTO ingestion_snapshots
    (snapshot_id, source_id, r2_key, raw_sha256, canonical_sha256, content_type, byte_length, final_url, fetched_at)
    VALUES (?,?,?,?,?,'text/html',?,?,?)`).run(snapshotId, source.id, key, hash, hash, body.byteLength, source.officialUrl, NOW)
  return { db, env, source, key, body, metadata }
}
function count(db: ReturnType<typeof discoveryDatabase>, table: string) {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
}

test('snapshot-backed official source binding is idempotent and never publishes canonical facts', async () => {
  const { db, env, source } = await fixture()
  try {
    const before = db.prepare('SELECT * FROM records ORDER BY id').all()
    const result = await registerAutomaticSourceBindings(env, NOW)
    assert.equal(result.registered, 1)
    assert.equal(result.deferred, 0)
    const document = db.prepare('SELECT * FROM source_documents').get()
    assert.equal(document?.publisher_organization_id, source.institutionId)
    assert.equal(document?.canonical_url, source.officialUrl)
    assert.equal(document?.official, 1)
    assert.equal(document?.language_code, 'other')
    const metadata = db.prepare('SELECT * FROM publication_source_metadata').get()
    assert.equal(metadata?.reviewed_at, NOW)
    assert.equal(metadata?.reviewed_by, 'automatic-official-source-binding-v1')
    assert.equal((await registerAutomaticSourceBindings(env, NOW)).examined, 0)
    assert.deepEqual(db.prepare('SELECT * FROM records ORDER BY id').all(), before)
    for (const table of ['claims', 'canonical_fields', 'change_sets', 'promotion_field_mappings']) assert.equal(count(db, table), 0)
  } finally { db.close() }
})

test('seed registration and database-only snapshots never suffice without an authentic stored body', async () => {
  for (const mode of ['no-snapshot', 'no-body', 'wrong-body', 'wrong-source', 'wrong-size', 'wrong-key', 'future'] as const) {
    const { db, env, metadata } = await fixture()
    try {
      if (mode === 'no-snapshot') db.exec('DELETE FROM ingestion_snapshots')
      if (mode === 'no-body') env.SNAPSHOTS_BUCKET.get = async () => null
      if (mode === 'wrong-body') env.SNAPSHOTS_BUCKET.get = async () => ({ arrayBuffer: async () => new ArrayBuffer(1), customMetadata: metadata })
      if (mode === 'wrong-source') metadata.sourceId = 'different-source'
      if (mode === 'wrong-size') db.exec('UPDATE ingestion_snapshots SET byte_length = 1')
      if (mode === 'wrong-key') db.exec("UPDATE ingestion_snapshots SET r2_key = 'some-other-snapshot'")
      if (mode === 'future') db.exec("UPDATE ingestion_snapshots SET fetched_at = '2027-01-01T00:00:00.000Z'")
      assert.equal((await registerAutomaticSourceBindings(env, NOW)).registered, 0, mode)
      assert.equal(count(db, 'source_documents'), 0, mode)
    } finally { db.close() }
  }
})

test('contacts, shared scholarship, manual, disabled and blocked sources are never automatically bound', async () => {
  for (const change of [
    { sourceCategory: 'contacts' }, { sourceCategory: 'government_scholarship' }, { id: 'manual-source' },
    { enabled: false }, { robots: { mode: 'blocked' } },
  ] as Partial<SourceManifestV1>[]) {
    const { db, env } = await fixture(change)
    try {
      assert.equal((await registerAutomaticSourceBindings(env, NOW)).registered, 0)
      assert.equal(count(db, 'source_documents'), 0)
    } finally { db.close() }
  }
})

test('same institutional suffix does not authorize an unregistered host or redirect host', async () => {
  for (const redirect of [false, true]) {
    const { db, env } = await fixture(redirect ? { allowedRedirectHosts: ['unregistered.example.edu.cn'] } : {
      officialUrl: 'https://unregistered.example.edu.cn/program', allowedHosts: ['unregistered.example.edu.cn'],
    })
    try {
      if (redirect) db.exec("UPDATE ingestion_snapshots SET final_url = 'https://unregistered.example.edu.cn/program'")
      const result = await registerAutomaticSourceBindings(env, NOW)
      assert.equal(result.registered, 0)
      assert.equal(result.reasons.host_not_registered_to_school, 1)
    } finally { db.close() }
  }
})

test('a separately registered exact official host can bind a discovered page', async () => {
  const { db, env, source } = await fixture({ id: `auto-discovery-d1-${'b'.repeat(40)}`,
    officialUrl: 'https://programs.example.edu.cn/guide', allowedHosts: ['programs.example.edu.cn'] })
  try {
    db.prepare('INSERT INTO organization_domains (organization_id,domain,verified_at) VALUES (?,?,?)').run(source.institutionId, 'programs.example.edu.cn', NOW)
    assert.equal((await registerAutomaticSourceBindings(env, NOW)).registered, 1)
  } finally { db.close() }
})

test('existing publisher ownership, document policies and manually disabled bindings are never overwritten', async () => {
  for (const mode of ['publisher', 'inactive', 'not-official', 'binding-disabled', 'metadata'] as const) {
    const { db, env, source } = await fixture()
    try {
      if (mode === 'publisher') {
        seedDiscoverySource(db, { id: 'other-school-source', institutionId: 'other-school', officialUrl: 'https://other.example.edu.cn/' })
      }
      db.prepare(`INSERT INTO source_documents (id,public_id,canonical_url,publisher_organization_id,source_kind,authority_level,official,active,robots_policy)
        VALUES ('existing','existing',?,?,'program',?,?,?,'enforce')`).run(source.officialUrl,
        mode === 'publisher' ? 'other-school' : source.institutionId,
        mode === 'not-official' ? 'discovery_only' : 'primary_official', mode === 'not-official' ? 0 : 1, mode === 'inactive' ? 0 : 1)
      if (mode === 'binding-disabled') db.prepare("INSERT INTO promotion_source_bindings(source_id,source_document_id,enabled) VALUES (?,'existing',0)").run(source.id)
      if (mode === 'metadata') db.prepare("INSERT INTO publication_source_metadata(source_id,title,publisher,reviewed_by,reviewed_at) VALUES ('existing','Manual title','Manual publisher','human',?)").run(NOW)
      const before = db.prepare('SELECT * FROM source_documents').get()
      const result = await registerAutomaticSourceBindings(env, NOW)
      assert.equal(result.registered, mode === 'metadata' ? 1 : 0, mode)
      assert.deepEqual(db.prepare('SELECT * FROM source_documents').get(), before, mode)
      if (mode === 'binding-disabled') assert.equal(db.prepare('SELECT enabled FROM promotion_source_bindings').get()?.enabled, 0)
      if (mode === 'metadata') assert.equal(db.prepare('SELECT reviewed_by FROM publication_source_metadata').get()?.reviewed_by, 'human')
    } finally { db.close() }
  }
})

test('the same official URL claimed by a second school cannot create or overwrite a publisher', async () => {
  const { db, env, source } = await fixture()
  try {
    seedDiscoverySource(db, { id: 'another-school-source', institutionId: 'different-school', officialUrl: source.officialUrl })
    assert.equal((await registerAutomaticSourceBindings(env, NOW)).registered, 0)
    assert.equal(count(db, 'source_documents'), 0)
  } finally { db.close() }
})

test('source disable or ownership mutation during body verification is caught again in the write transaction', async () => {
  for (const mutation of ['disable', 'manifest', 'owner']) {
    const { db, env, source } = await fixture()
    try {
      const originalGet = env.SNAPSHOTS_BUCKET.get
      env.SNAPSHOTS_BUCKET.get = async key => {
        if (mutation === 'disable') db.prepare('UPDATE ingestion_sources SET enabled=0 WHERE source_id=?').run(source.id)
        if (mutation === 'manifest') db.prepare("UPDATE ingestion_sources SET manifest_json=json_set(manifest_json,'$.enabled',json('false')) WHERE source_id=?").run(source.id)
        if (mutation === 'owner') db.prepare("UPDATE organizations SET official_url='https://changed.example.edu.cn' WHERE record_id=?").run(source.institutionId)
        return originalGet(key)
      }
      assert.equal((await registerAutomaticSourceBindings(env, NOW)).registered, 0, mutation)
      assert.equal(count(db, 'source_documents'), 0, mutation)
    } finally { db.close() }
  }
})

test('an R2 outage surfaces as a failed operation instead of an empty successful backfill', async () => {
  const { db, env } = await fixture()
  try {
    env.SNAPSHOTS_BUCKET.get = async () => { throw new Error('outage') }
    await assert.rejects(registerAutomaticSourceBindings(env, NOW), /Some automatic source bindings/)
    assert.equal(count(db, 'source_documents'), 0)
  } finally { db.close() }
})

test('an independently registered domain revoked during body verification cannot grant a binding', async () => {
  const { db, env, source } = await fixture({ officialUrl: 'https://programs.example.edu.cn/guide', allowedHosts: ['programs.example.edu.cn'] })
  try {
    db.prepare('INSERT INTO organization_domains (organization_id,domain,verified_at) VALUES (?,?,?)').run(source.institutionId, 'programs.example.edu.cn', NOW)
    const get = env.SNAPSHOTS_BUCKET.get
    env.SNAPSHOTS_BUCKET.get = async key => {
      db.prepare('DELETE FROM organization_domains WHERE organization_id=?').run(source.institutionId)
      return get(key)
    }
    assert.equal((await registerAutomaticSourceBindings(env, NOW)).registered, 0)
    assert.equal(count(db, 'source_documents'), 0)
  } finally { db.close() }
})
