import assert from 'node:assert/strict'
import test from 'node:test'
import { captureSource } from '../src/capture'
import { processDiscoveryFrontier } from '../src/discovery'
import { queueExtraction, recordTargets, seed, source } from '../src/repository'
import { readRecordTargetGraph } from '../src/target-graph'
import type { JobRow, RecordTarget } from '../src/types'
import { canonical, digest } from '../src/util'
import { makeEnv, seedInput, TEST_SCOPE } from './fixture'

async function fixture(parents = 10, legacy = false) {
  const f = makeEnv(), rootId = await digest('https://test.edu.cn/catalog')
  const target = (id: string, sourceId: string, school = 'uni-000'): RecordTarget => ({ recordId: id, entityType: 'program', universityId: school, sourceIds: [sourceId], recordScopeSha256: 'e'.repeat(64), identity: { name: { en: id }, degreeLevel: 'master' }, year: null, intake: null, fields: { durationMonths: null }, reviewAfter: '2026-11-30' })
  await seed(f.env, { ...seedInput(), recordTargets: [target('direct-programme', rootId)] })
  f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=? WHERE source_id=?').run('a'.repeat(64), rootId)
  const ids: string[] = [], refs: Record<string, string> = {}
  for (let i = 0; i < parents; i++) {
    const url = `https://test.edu.cn/parent/${i}`, id = await digest(url), raw = await digest('parent raw ' + i); ids.push(id)
    f.db.sqlite.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at,raw_sha256,discovery_depth) VALUES(?,?,'[\"test.edu.cn\"]','current_guide',1,168,?,?,0)").run(id, url, new Date().toISOString(), raw)
    f.db.sqlite.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').run(id, 'uni-000')
    const t = target(`ancestor-programme-${i}`, id)
    f.db.sqlite.prepare('INSERT INTO maintenance_record_targets VALUES(?,?,?,?,?,?,?,?,?,1)').run(`program:${t.recordId}`, t.recordId, t.entityType, t.universityId, t.recordScopeSha256, null, null, canonical(t.fields), canonical(t))
    f.db.sqlite.prepare('INSERT INTO maintenance_target_sources VALUES(?,?)').run(`program:${t.recordId}`, id)
    const frontier = canonical({ version: 1, sourceId: id, sourceUrl: url, rawSha256: raw, depth: 0, allowedHosts: ['test.edu.cn'], links: [{ url: 'https://test.edu.cn/catalog', category: 'program_detail', label: 'Official program catalog', priority: 1 }], missed: [] }), sha = await digest(frontier)
    await f.bucket.put(`maintenance/frontiers/${sha}.json`, frontier); refs[id] = sha
  }
  const writeLineage = () => f.bucket.put(`maintenance/discovery-lineage/${rootId}.json`, canonical({ version: 1, sourceId: rootId, parents: ids, frontierSha256: refs[ids.at(-1)!], ...(legacy ? {} : { parentFrontiers: refs }) }))
  await writeLineage()
  return { ...f, rootId, ids, refs, target, writeLineage }
}

test('ten real parents retain direct targets and bounded candidates, with an immutable review record for every omitted edge', async () => {
  const f = await fixture(); try {
    const graph = await readRecordTargetGraph(f.env, f.rootId)
    assert.equal(graph.visitedSourceIds.length, 8); assert.equal(graph.targets.length, 8); assert.equal(graph.pendingEdges.length, 3)
    assert.ok(graph.targets.some(t => t.recordId === 'direct-programme')); assert.ok(graph.pendingEdges.every(edge => edge.reason === 'source_budget_requires_review' && edge.lineage?.sha256))
    assert.equal(graph.complete, false); assert.equal(graph.applicabilityEstablished, false); assert.equal(graph.catalogueComplete, false)
    const row = (await source(f.env, f.rootId))!
    await queueExtraction(f.env, row, 'a'.repeat(64), `maintenance/snapshots/${f.rootId}/${'a'.repeat(64)}.json`)
    const event = f.db.sqlite.prepare("SELECT details_json FROM maintenance_events WHERE kind='source_target_lineage_held'").get()!, ref = JSON.parse(String(event.details_json)), body = await (await f.bucket.get(ref.objectKey))!.text()
    assert.equal(await digest(body), ref.sha256); assert.equal(JSON.parse(body).pendingEdges.length, 3); assert.equal(JSON.parse(body).applicabilityEstablished, false)
    await queueExtraction(f.env, row, 'a'.repeat(64), `maintenance/snapshots/${f.rootId}/${'a'.repeat(64)}.json`)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='source_target_lineage_held'").get()?.n, 1)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n, 0)
  } finally { f.db.sqlite.close() }
})

test('a legacy latest-only frontier cannot silently approve all historical navigation parents', async () => {
  const f = await fixture(10, true); try {
    const graph = await readRecordTargetGraph(f.env, f.rootId)
    assert.ok(graph.targets.some(t => t.recordId === 'direct-programme')); assert.ok(graph.targets.length <= 2)
    assert.ok(graph.pendingEdges.some(edge => edge.reason === 'frontier_edge_or_snapshot_unproven'))
    assert.ok(graph.pendingEdges.every(edge => edge.lineage?.sha256)); assert.equal(graph.complete, false)
  } finally { f.db.sqlite.close() }
})

test('cross-school or old-scope parents and changed frontier/snapshot bindings never supply targets', async () => {
  for (const mode of ['school', 'scope', 'raw', 'frontier', 'link']) {
    const f = await fixture(1); try {
      if (mode === 'school') f.db.sqlite.prepare('UPDATE maintenance_source_schools SET university_id=? WHERE source_id=?').run('uni-001', f.ids[0])
      if (mode === 'scope') f.db.sqlite.prepare('UPDATE maintenance_schools SET scope_sha256=? WHERE university_id=?').run('b'.repeat(64), 'uni-000')
      if (mode === 'raw') f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=? WHERE source_id=?').run('b'.repeat(64), f.ids[0])
      if (mode === 'frontier') await f.bucket.put(`maintenance/frontiers/${f.refs[f.ids[0]]}.json`, '{}')
      if (mode === 'link') { const key = `maintenance/frontiers/${f.refs[f.ids[0]]}.json`, obj = JSON.parse(await (await f.bucket.get(key))!.text()); obj.links = []; const text = canonical(obj), sha = await digest(text); await f.bucket.put(`maintenance/frontiers/${sha}.json`, text); f.refs[f.ids[0]] = sha; await f.writeLineage() }
      const graph = await readRecordTargetGraph(f.env, f.rootId)
      assert.ok(!graph.targets.some(t => t.recordId.startsWith('ancestor-')), mode); assert.equal(graph.complete, false, mode)
      if (mode !== 'scope') assert.ok(graph.targets.some(t => t.recordId === 'direct-programme'), mode)
    } finally { f.db.sqlite.close() }
  }
})

test('depth and cycles remain bounded and unprocessed ancestry is explicit', async () => {
  const f = await fixture(1); try {
    const parent = f.ids[0], grand = await digest('https://test.edu.cn/grand'), great = await digest('https://test.edu.cn/great')
    for (const [id, url, childId, childUrl] of [[grand, 'https://test.edu.cn/grand', parent, 'https://test.edu.cn/parent/0'], [great, 'https://test.edu.cn/great', grand, 'https://test.edu.cn/grand']]) {
      f.db.sqlite.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at,raw_sha256,discovery_depth) VALUES(?,?,'[\"test.edu.cn\"]','current_guide',1,168,?,?,0)").run(id, url, new Date().toISOString(), 'c'.repeat(64)); f.db.sqlite.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').run(id, 'uni-000')
      const frontier = canonical({ version: 1, sourceId: id, sourceUrl: url, rawSha256: 'c'.repeat(64), depth: 0, links: [{ url: childUrl }] }), sha = await digest(frontier)
      await f.bucket.put(`maintenance/frontiers/${sha}.json`, frontier); await f.bucket.put(`maintenance/discovery-lineage/${childId}.json`, canonical({ version: 1, sourceId: childId, parents: [id, f.rootId], frontierSha256: sha, parentFrontiers: { [id]: sha } }))
    }
    const graph = await readRecordTargetGraph(f.env, f.rootId)
    assert.equal(graph.visitedSourceIds.length, 3); assert.ok(graph.pendingEdges.some(edge => edge.parentSourceId === great && edge.reason === 'depth_budget_requires_review'))
  } finally { f.db.sqlite.close() }
})

test('successful official capture with ten navigation parents still discovers a new PDF through the ordinary frontier queue', async () => {
  const f = await fixture(10, true); try {
    const html = '<h1>International admissions 2027</h1><a href="/2027-programs.pdf">Official Masters Programs 2027</a>', row = (await source(f.env, f.rootId))!
    const outcome = await captureSource(f.env, { job_id: 'actual-capture', source_id: f.rootId } as JobRow, row, async input => String(input).endsWith('/robots.txt') ? new Response('', { status: 404 }) : new Response(html, { headers: { 'content-type': 'text/html' } }), async () => {})
    assert.equal(outcome, 'captured'); const observed = (await source(f.env, f.rootId))!; assert.equal(observed.error_code, null); assert.equal(observed.failures, 0); assert.ok(observed.last_success_at)
    assert.equal(f.db.sqlite.prepare('SELECT scope_sha256 FROM maintenance_control').get()?.scope_sha256, TEST_SCOPE)
    assert.ok(f.db.sqlite.prepare("SELECT 1 FROM maintenance_events WHERE kind='source_target_lineage_held'").get())
    const message = f.messages.find(m => m.discoveryManifestSha256); assert.ok(message?.discoveryManifestSha256)
    await processDiscoveryFrontier(f.env, message.discoveryManifestSha256, message.discoveryOffset ?? 0)
    const childId = await digest('https://test.edu.cn/2027-programs.pdf'), child = await source(f.env, childId); assert.ok(child)
    const lineage = JSON.parse(await (await f.bucket.get(`maintenance/discovery-lineage/${childId}.json`))!.text())
    assert.equal(lineage.parentFrontiers[f.rootId], message.discoveryManifestSha256)
    const candidates = await recordTargets(f.env, childId); assert.ok(candidates.some(t => t.recordId === 'direct-programme'))
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n, 0)
  } finally { f.db.sqlite.close() }
})
