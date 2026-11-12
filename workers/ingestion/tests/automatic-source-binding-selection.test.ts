import assert from 'node:assert/strict'
import test from 'node:test'
import { AUTOMATIC_SOURCE_BINDING_CANDIDATES_SQL } from '../src/automatic-source-bindings'
import type { SourceManifestV1 } from '../src/types'
import { discoveryDatabase, NOW, seedDiscoverySource } from './discovery-fixtures'

// Frozen pre-optimization SQL: compare complete selected evidence, not just IDs.
const previousSelection = `WITH latest AS (
  SELECT snapshot.*, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY fetched_at DESC, snapshot_id) AS snapshot_rank
  FROM ingestion_snapshots snapshot
), eligible AS (
  SELECT source.source_id, source.manifest_json,
    organization.record_id AS institution_id, organization.official_url, institution.admissions_url,
    (SELECT text_value FROM localized_content WHERE record_id = organization.record_id
      AND field_name = 'name' AND translation_status IN ('reviewed', 'published')
      ORDER BY CASE locale WHEN 'en' THEN 0 WHEN 'zh' THEN 1 ELSE 2 END, locale LIMIT 1) AS publisher_name,
    snapshot.snapshot_id, snapshot.r2_key, snapshot.raw_sha256, snapshot.canonical_sha256,
    snapshot.content_type, snapshot.byte_length, snapshot.final_url, snapshot.fetched_at,
    ROW_NUMBER() OVER (PARTITION BY organization.record_id ORDER BY RANDOM()) AS institution_rank
  FROM ingestion_sources source
  JOIN organizations organization ON organization.record_id = json_extract(source.manifest_json, '$.institutionId')
  JOIN institutions institution ON institution.record_id = organization.record_id
  JOIN records record ON record.id = organization.record_id
  JOIN latest snapshot ON snapshot.source_id = source.source_id AND snapshot.snapshot_rank = 1
  WHERE source.enabled = 1
    AND (source.source_id GLOB 'auto-seed-*' OR source.source_id GLOB 'auto-discovery-*')
    AND json_extract(source.manifest_json, '$.sourceCategory') NOT IN ('contacts', 'government_scholarship')
    AND record.kind = 'organization' AND record.workflow_status IN ('validated', 'applied', 'published', 'stale')
    AND NOT EXISTS (SELECT 1 FROM promotion_source_bindings binding WHERE binding.source_id = source.source_id)
) SELECT * FROM eligible ORDER BY institution_rank, RANDOM() LIMIT ?1`

type Database = ReturnType<typeof discoveryDatabase>
function source(db: Database, index: number, overrides: Partial<SourceManifestV1> = {}) {
  const manifest = seedDiscoverySource(db, { id: `auto-seed-${index.toString(16).padStart(24, '0')}`,
    institutionId: `school-${index}`, officialUrl: `https://admissions.example.edu.cn/catalog/${index}`, ...overrides })
  db.prepare("UPDATE records SET workflow_status='validated' WHERE id=?").run(manifest.institutionId)
  return manifest
}
function snapshot(db: Database, manifest: SourceManifestV1, id: string, fetchedAt = NOW, hash = id.replace(/[^a-f0-9]/gu, '').slice(-64).padStart(64, '0')) {
  db.prepare(`INSERT INTO ingestion_snapshots
    (snapshot_id,source_id,r2_key,raw_sha256,canonical_sha256,content_type,byte_length,final_url,fetched_at)
    VALUES (?,?,?,?,?,'text/html',100,?,?)`).run(id, manifest.id, `raw/${id}`, hash, hash, manifest.officialUrl, fetchedAt)
}
function comparable(rows: ReturnType<ReturnType<Database['prepare']>['all']>) {
  return rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'institution_rank')))
    .sort((a, b) => String(a.source_id).localeCompare(String(b.source_id)))
}
function selected(db: Database, limit = 100) { return db.prepare(AUTOMATIC_SOURCE_BINDING_CANDIDATES_SQL).all(limit) }

test('indexed latest-source selection preserves all eligibility gates and complete evidence from the previous SQL', () => {
  const db = discoveryDatabase()
  try {
    assert.deepEqual(selected(db), db.prepare(previousSelection).all(100))
    for (let index = 1; index <= 12; index++) {
      const manifest = source(db, index, index === 3 ? { enabled: false } : index === 4 ? { sourceCategory: 'contacts' }
        : index === 5 ? { sourceCategory: 'government_scholarship' } : index === 6 ? { id: 'manual-source' } : {})
      if (index === 7) db.prepare("UPDATE records SET workflow_status='draft' WHERE id=?").run(manifest.institutionId)
      if (index === 8) db.prepare("UPDATE records SET kind='program' WHERE id=?").run(manifest.institutionId)
      if (index === 9) db.prepare('DELETE FROM institutions WHERE record_id=?').run(manifest.institutionId)
      if (index === 10) {
        db.prepare("UPDATE ingestion_sources SET manifest_json=json_set(manifest_json,'$.institutionId','missing-owner') WHERE source_id=?").run(manifest.id)
      }
      if (index === 11) {
        db.prepare(`INSERT INTO source_documents (id,public_id,canonical_url,publisher_organization_id,source_kind,authority_level,official,active,robots_policy)
          VALUES ('existing','existing',?,?,'program','primary_official',1,1,'enforce')`).run(manifest.officialUrl, manifest.institutionId)
        db.prepare("INSERT INTO promotion_source_bindings(source_id,source_document_id,enabled) VALUES (?,'existing',0)").run(manifest.id)
      }
      if (index !== 12) {
        snapshot(db, manifest, `older-${index}`, '2026-09-14T00:00:00.000Z', '1'.repeat(64))
        snapshot(db, manifest, `latest-${index}`, NOW, '2'.repeat(64))
      }
    }
    const actual = selected(db)
    assert.deepEqual(comparable(actual), comparable(db.prepare(previousSelection).all(100)))
    assert.deepEqual(actual.map(row => row.institution_id).sort(), ['school-1', 'school-2'])
  } finally { db.close() }
})

test('duplicate timestamps retain the ascending snapshot-ID tie break, including future observations', () => {
  const db = discoveryDatabase()
  try {
    const manifest = source(db, 1)
    snapshot(db, manifest, '0-older', '2026-09-15T00:00:00.000Z', '1'.repeat(64))
    snapshot(db, manifest, 'b-newest', NOW, '2'.repeat(64))
    snapshot(db, manifest, 'a-newest', NOW, '3'.repeat(64))
    assert.equal(selected(db)[0].snapshot_id, 'a-newest')
    assert.deepEqual(comparable(selected(db)), comparable(db.prepare(previousSelection).all(100)))
    snapshot(db, manifest, 'future', '2026-09-17T00:00:00.000Z', '4'.repeat(64))
    assert.equal(selected(db)[0].snapshot_id, 'future', 'never filter invalid latest evidence into an older usable row')
    assert.deepEqual(comparable(selected(db)), comparable(db.prepare(previousSelection).all(100)))
  } finally { db.close() }
})

test('per-institution random ranking still gives each eligible institution its first slot before second slots', () => {
  const db = discoveryDatabase()
  try {
    for (let school = 0; school < 3; school++) for (let item = 0; item < 4; item++) {
      const manifest = source(db, school * 10 + item, { institutionId: `fair-school-${school}` })
      snapshot(db, manifest, `fair-${school}-${item}`)
    }
    for (let attempt = 0; attempt < 12; attempt++) {
      const rows = selected(db, 3)
      assert.equal(rows.length, 3)
      assert.equal(new Set(rows.map(row => row.institution_id)).size, 3)
      assert.ok(rows.every(row => row.institution_rank === 1))
      const next = selected(db, 4)
      assert.equal(new Set(next.map(row => row.institution_id)).size, 3)
      assert.deepEqual(next.map(row => row.institution_rank), [1, 1, 1, 2])
    }
  } finally { db.close() }
})

test('source remains the outer loop under statistics that favor starting from organization records', t => {
  const db = discoveryDatabase()
  try {
    for (let index = 1; index <= 6; index++) {
      const manifest = source(db, index)
      snapshot(db, manifest, `planner-${index}`)
    }
    for (let index = 100; index < 300; index++) source(db, index, { enabled: false })
    db.exec('ANALYZE')
    for (const skew of [false, true]) {
      if (skew) db.exec(`
        UPDATE sqlite_stat1 SET stat='1000000000 1' WHERE tbl='ingestion_sources';
        UPDATE sqlite_stat1 SET stat='100 1' WHERE tbl IN ('records','organizations','institutions') AND idx LIKE 'sqlite_autoindex_%';
        ANALYZE sqlite_schema;
      `)
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${AUTOMATIC_SOURCE_BINDING_CANDIDATES_SQL}`).all(20).map(row => String(row.detail))
      const sourceLoop = plan.findIndex(step => /(?:SCAN|SEARCH) source\b/u.test(step))
      assert.ok(sourceLoop >= 0, plan.join('\n'))
      for (const alias of ['organization', 'institution', 'record', 'snapshot']) {
        const nextLoop = plan.findIndex(step => new RegExp(`(?:SCAN|SEARCH) ${alias}\\b`, 'u').test(step))
        assert.ok(nextLoop > sourceLoop, `${alias} must follow source: ${plan.join('\n')}`)
      }
      assert.ok(plan.every(step => !/SCAN (?:record|organization|institution|snapshot|newest)\b/u.test(step)), plan.join('\n'))
      assert.ok(plan.some(step => /SEARCH record USING INDEX sqlite_autoindex_records_1 \(id=\?\)/u.test(step)), plan.join('\n'))
      assert.deepEqual(comparable(selected(db)), comparable(db.prepare(previousSelection).all(100)))
      if (skew) {
        const unforced = AUTOMATIC_SOURCE_BINDING_CANDIDATES_SQL.replaceAll('CROSS JOIN', 'JOIN')
        const previousPlan = db.prepare(`EXPLAIN QUERY PLAN ${unforced}`).all(20).map(row => String(row.detail))
        t.diagnostic(`unforced skewed plan: ${previousPlan.join(' | ')}`)
        t.diagnostic(`source-first skewed plan: ${plan.join(' | ')}`)
      }
    }
  } finally { db.close() }
})

test('existing source/fetched index bounds snapshot visits independently of irrelevant historical volume', t => {
  const db = discoveryDatabase()
  try {
    const eligible = source(db, 1)
    for (let index = 1; index <= 32; index++) snapshot(db, eligible, `eligible-old-${index}`,
      new Date(Date.parse(NOW) - index * 1000).toISOString(), index.toString(16).padStart(64, '0'))
    snapshot(db, eligible, 'eligible-latest', NOW, 'f'.repeat(64))
    let visits = 0
    db.function('observe_snapshot', (id: unknown) => { assert.equal(typeof id, 'string'); visits++; return 1 })
    // A true, non-deterministic predicate counts visited snapshot candidates;
    // it does not change the indexed source equality or ordering expressions.
    const measuredNew = AUTOMATIC_SOURCE_BINDING_CANDIDATES_SQL.replace('WHERE newest.source_id = source.source_id',
      'WHERE newest.source_id = source.source_id AND observe_snapshot(newest.snapshot_id)')
    const measuredOld = previousSelection.replace('FROM ingestion_snapshots snapshot',
      'FROM ingestion_snapshots snapshot WHERE observe_snapshot(snapshot.snapshot_id)')
    db.prepare(measuredNew).all(25)
    const initialVisits = visits
    db.exec('BEGIN')
    for (let item = 1; item <= 100; item++) {
      const ignored = source(db, item + 10, { enabled: false })
      for (let history = 0; history < 300; history++) snapshot(db, ignored, `history-${item}-${history}`,
        new Date(Date.parse(NOW) - history * 1000).toISOString(), history.toString(16).padStart(64, '0'))
    }
    db.exec('COMMIT')
    visits = 0; const actual = db.prepare(measuredNew).all(25), indexedVisits = visits
    visits = 0; const legacy = db.prepare(measuredOld).all(25), legacyVisits = visits
    assert.deepEqual(comparable(actual), comparable(legacy))
    assert.equal(indexedVisits, initialVisits)
    assert.ok(indexedVisits <= 3, `latest index lookup visited ${indexedVisits} snapshot candidates`)
    assert.equal(legacyVisits, 30_033)
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${AUTOMATIC_SOURCE_BINDING_CANDIDATES_SQL}`).all(25).map(row => String(row.detail))
    assert.ok(plan.some(step => /SEARCH newest USING INDEX idx_ingestion_snapshots_source_fetched \(source_id=\?\)/u.test(step)), plan.join('\n'))
    assert.ok(plan.some(step => /SEARCH snapshot USING INDEX sqlite_autoindex_ingestion_snapshots_1 \(snapshot_id=\?\)/u.test(step)), plan.join('\n'))
    assert.ok(plan.every(step => !/SCAN (?:snapshot|newest)\b|MATERIALIZE latest|CO-ROUTINE latest/u.test(step)), plan.join('\n'))
    t.diagnostic(`snapshot-candidate visit proxy: legacy=${legacyVisits}, indexed=${indexedVisits}; not a billed D1 rows-read measurement`)
  } finally { db.close() }
})
