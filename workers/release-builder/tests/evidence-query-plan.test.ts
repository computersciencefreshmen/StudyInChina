import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { buildArtifactFromPipeline } from '../src/snapshot'

async function evidenceQuery(): Promise<string> {
  const queries: string[] = []
  const database = {
    prepare(sql: string) { return { sql } },
    async batch(statements: Array<{ sql: string }>) {
      return statements.map(statement => { queries.push(statement.sql); return { success: true, results: [] } })
    },
  }
  await assert.rejects(buildArtifactFromPipeline(database as never, {
    version: 1, outboxEventId: 'outbox-plan-test', publicationJobId: 'job-plan-test',
    catalogReleaseId: 'release-plan-test', requestedAt: '2026-10-25T00:00:00.000Z',
  }, new Date('2026-10-25T00:00:00.000Z')), (error: Error & { code?: string }) => error.code === 'empty_release')
  const query = queries.find(query => query.includes('SELECT DISTINCT') && query.includes('evidence.evidence_role'))
  assert.ok(query)
  return query
}

function fixture() {
  const database = new DatabaseSync(':memory:')
  const directory = join(process.cwd(), 'infra/d1/pipeline/migrations')
  for (const migration of readdirSync(directory).filter(name => name.endsWith('.sql')).sort())
    database.exec(readFileSync(join(directory, migration), 'utf8'))
  const at = '2026-10-25T00:00:00.000Z', sha = 'a'.repeat(64)
  const addSource = database.prepare(`INSERT INTO source_documents(id,public_id,canonical_url,source_kind,authority_level,official,language_code)
    VALUES(?,?,?,'program','primary_official',1,'en')`)
  const addFetch = database.prepare(`INSERT INTO source_fetches(id,source_id,status,requested_at,completed_at,sha256,artifact_uri)
    VALUES(?,?,'succeeded',?,?,?,?)`)
  const addFragment = database.prepare(`INSERT INTO source_fragments(id,fetch_id,locator_type,locator,text_excerpt,sha256)
    VALUES(?,?,'manual','document','Official programme evidence',?)`)
  for (const name of ['a', 'b']) {
    addSource.run(`source-${name}`, `public-source-${name}`, `https://example.edu.cn/${name}`)
    addFetch.run(`fetch-${name}`, `source-${name}`, at, at, sha, `r2://fixture/${name}`)
    addFragment.run(`fragment-${name}`, `fetch-${name}`, sha)
  }
  // Two fragments on the same source/role must still collapse under DISTINCT.
  addFragment.run('fragment-a-duplicate', 'fetch-a', sha)
  database.prepare(`INSERT INTO publication_source_metadata(source_id,title,publisher,reviewed_by,reviewed_at)
    VALUES('source-a','Official catalogue','Example University','human-fixture',?)`).run(at)
  const addRecord = database.prepare(`INSERT INTO records(id,public_id,kind,workflow_status) VALUES(?,?,'program',?)`)
  const addClaim = database.prepare(`INSERT INTO claims(id,subject_record_id,field_path,value_type,normalized_value_json,
    confidence,extraction_method,extractor_version,claim_status) VALUES(?,?,?,'string','"value"',1,'manual','fixture',?)`)
  const addField = database.prepare(`INSERT INTO canonical_fields(subject_record_id,field_path,field_status,claim_id,value_json,verified_at,review_after)
    VALUES(?,?,?,?,?,?,?)`)
  const addEvidence = database.prepare('INSERT INTO claim_evidence(claim_id,fragment_id,evidence_role) VALUES(?,?,?)')
  for (let record = 0; record < 6; record++) {
    const recordId = `record-${record}`
    addRecord.run(recordId, `public-${recordId}`, record === 2 ? 'quarantined' : record % 2 ? 'published' : 'applied')
    for (const field of ['name', 'tuition', 'unknown', 'rejected-claim']) {
      const claimId = `claim-${record}-${field}`
      addClaim.run(claimId, recordId, field, field === 'rejected-claim' ? 'rejected' : 'validated')
      for (const fragment of ['fragment-a', 'fragment-a-duplicate', 'fragment-b'])
        addEvidence.run(claimId, fragment, fragment === 'fragment-b' ? 'corroborating' : 'primary')
      if (field !== 'rejected-claim') database.prepare("UPDATE claims SET claim_status='accepted' WHERE id=?").run(claimId)
      const accepted = field === 'name' || field === 'tuition'
      addField.run(recordId, field, accepted ? 'accepted' : 'unknown', claimId,
        accepted ? '"value"' : null, accepted ? at : null, accepted ? '2026-11-01' : null)
    }
  }
  const batchId = 'b'.repeat(64)
  const manifest = JSON.stringify({ format: 'studyinchina.pipeline.materialization-batch', formatVersion: 1,
    batchId, packageDigest: sha, batchPurpose: 'catalog_entities', materializerVersion: 'fixture', provenanceStatus: 'unknown',
    generatedAt: at, sourceManifestSha256: sha, sourceSqlSha256: sha, sourceArtifactCount: 1,
    counts: { records: 2, programs: 2, scholarships: 0, organizations: 0, locations: 0, claims: 1,
      canonicalFields: 1, sourceFragments: 1, sourceDocuments: 1, programCycles: 0, scholarshipCycles: 0 } })
  database.prepare(`INSERT INTO materialization_batches(batch_id,materializer_version,package_digest,batch_status,
    expected_records,expected_programs,expected_scholarships,expected_claims,expected_canonical_fields,
    expected_evidence_fragments,expected_source_documents,manifest_json,created_at,updated_at)
    VALUES(?,'fixture',?,'importing',2,2,0,1,1,1,1,?,?,?)`).run(batchId, sha, manifest, at, at)
  const addIntent = database.prepare(`INSERT INTO materialization_batch_record_intents(batch_id,record_id,record_kind,package_digest,reserved_at)
    VALUES(?,?,'program',?,?)`)
  for (const recordId of ['record-3', 'record-4']) addIntent.run(batchId, recordId, sha, at)
  database.prepare(`INSERT INTO materialization_batch_records(batch_id,record_id,record_kind,created_at)
    VALUES(?,'record-4','program',?)`).run(batchId, at)
  return database
}

test('forward evidence joins preserve complete SQLite results and every fail-closed publication filter', async () => {
  const query = await evidenceQuery(), database = fixture()
  try {
    const previous = query.replace(/^(\s*)CROSS JOIN /gm, '$1JOIN ')
    assert.notEqual(previous, query)
    const before = database.prepare(previous).all(), after = database.prepare(query).all()
    assert.deepEqual(after, before)
    assert.equal(after.length, 12)
    assert.deepEqual([...new Set(after.map(row => row.subject_record_id))], ['record-0', 'record-1', 'record-5'])
    assert.deepEqual([...new Set(after.map(row => row.field_path))], ['name', 'tuition'])
    assert.ok(after.some(row => row.source_internal_id === 'source-b' && row.source_title === null && row.source_publisher === null))
    assert.equal(after.filter(row => row.source_internal_id === 'source-a').length, 6)
    assert.ok(query.includes('LEFT JOIN publication_source_metadata'))
    assert.ok(query.includes('batch_status NOT IN (\'applied\', \'superseded\')'))
  } finally { database.close() }
})

test('forward evidence plan uses the existing status and primary-key indexes in dependency order', async () => {
  const query = await evidenceQuery(), database = fixture()
  try {
    const plan = database.prepare('EXPLAIN QUERY PLAN ' + query).all().map(row => String(row.detail))
    const expected = [
      ['field', 'idx_canonical_fields_status_review'], ['record', 'sqlite_autoindex_records_1'],
      ['claim', 'sqlite_autoindex_claims_1'], ['evidence', 'sqlite_autoindex_claim_evidence_1'],
      ['fragment', 'sqlite_autoindex_source_fragments_1'], ['fetch', 'sqlite_autoindex_source_fetches_1'],
      ['source', 'sqlite_autoindex_source_documents_1'], ['metadata', 'sqlite_autoindex_publication_source_metadata_1'],
    ]
    const positions = expected.map(([table, index]) => {
      const position = plan.findIndex(step => step.startsWith(`SEARCH ${table} `) && step.includes(index))
      assert.ok(position >= 0, `${table} must use existing ${index}: ${plan.join('; ')}`)
      return position
    })
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
    assert.ok(plan.some(step => step.includes('idx_materialization_batch_intents_record')))
    assert.ok(plan.some(step => step.includes('idx_materialization_batch_records_record')))
  } finally { database.close() }
})
