import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDiscoveredSourceManifest, discoverOfficialLinks, MAX_AUTOMATIC_SOURCES_PER_INSTITUTION, registerDiscoveredSources } from '../src/source-discovery'
import { claimJob, listDueSourceIds } from '../src/repository'
import { scheduleDueSources } from '../src/index'
import { buildOfficialEntityExtraction, processIngestionJob } from '../src/pipeline'
import { buildPilotSourceImport } from '../../../scripts/ingestion/build-source-import'
import { validatePilotSourceManifestDirectory } from '../../../scripts/validate-source-manifests'
import type { IngestionJob } from '../src/types'
import { sourceManifest } from './fixtures'
import { discoveryDatabase, discoveryEnvironment, NOW, seedDiscovery, seedDiscoverySnapshot, seedDiscoverySource } from './discovery-fixtures'

test('automatic manifests preserve official host constraints without copying critical extraction or browser work', async () => {
  const parent = sourceManifest({ fetch: { renderMode: 'browser', browserWaitForSelector: '#app' } })
  const source = await buildDiscoveredSourceManifest(parent, { institutionId: parent.institutionId, officialUrl: 'https://static.example.edu.cn/course.html', role: 'program_detail' })
  assert.equal(source.extraction.mode, 'rules-only')
  assert.equal(source.extraction.fields.some((field) => field.critical), false)
  assert.deepEqual(source.allowedHosts, ['static.example.edu.cn'])
  assert.equal(source.fetch.renderMode, 'http')
  assert.equal(source.fetch.browserWaitForSelector, undefined)
  assert.equal(source.robots.mode, 'enforce')
  for (const officialUrl of ['https://evil.example.com/program', 'https://127.0.0.1/program', 'http://admissions.example.edu.cn/program', 'https://user:pass@admissions.example.edu.cn/program']) {
    await assert.rejects(buildDiscoveredSourceManifest(parent, { institutionId: parent.institutionId, officialUrl, role: 'program_detail' }))
  }
  await assert.rejects(buildDiscoveredSourceManifest(parent, { institutionId: 'wrong-school', officialUrl: parent.officialUrl, role: 'program_detail' }))
  await assert.rejects(buildDiscoveredSourceManifest({ ...parent, robots: { mode: 'blocked' } }, { institutionId: parent.institutionId, officialUrl: parent.officialUrl, role: 'program_detail' }))
  await assert.rejects(buildDiscoveredSourceManifest({ ...parent, id: 'auto-discovery-d2-terminal' }, { institutionId: parent.institutionId, officialUrl: parent.officialUrl, role: 'program_detail' }))
})

test('official navigation discovery follows admissions catalogs and rejects unsafe or executable links', () => {
  const parent = sourceManifest()
  const links = discoverOfficialLinks(`
    <a href='/catalog?language=en&amp;type=degree'>Degree programmes</a>
    <a href='/admissions'>招生简章</a><a href='/scholarships'>Scholarships</a>
    <a href='https://evil.example.com/catalog'>Programs</a>
    <a href='https://localhost/catalog'>Programs</a>
    <a href='javascript:alert(1)'>Programs</a><a href='/sports'>Sports news</a>
    <!-- <a href='/hidden'>Programs</a> --><script>"<a href='/script'>Programs</a>"</script>
  `, parent, parent.officialUrl)
  assert.deepEqual(links.map((link) => link.officialUrl), [
    'https://admissions.example.edu.cn/catalog?language=en&type=degree',
    'https://admissions.example.edu.cn/admissions',
    'https://admissions.example.edu.cn/scholarships',
  ])
  assert.equal(discoverOfficialLinks('<a href="/program">Programs</a>', { ...parent, id: 'auto-discovery-d2-terminal' }, parent.officialUrl).length, 0)
})

test('snapshot-backed enrollment is institution-fair, idempotent, bounded, and never publishes facts', async () => {
  const db = discoveryDatabase()
  try {
    for (const institutionId of ['school-a', 'school-b', 'school-c']) {
      const parent = seedDiscoverySource(db, { id: `parent-${institutionId}`, institutionId })
      const snapshotId = seedDiscoverySnapshot(db, parent)
      for (let i = 0; i < 10; i++) seedDiscovery(db, parent, snapshotId, `${institutionId}-discovery-${i}`)
    }
    const env = discoveryEnvironment(db)
    env.DISCOVERY_REGISTER_LIMIT = '3'
    assert.deepEqual(await registerDiscoveredSources(env, NOW), { registered: 3, deferred: 0 })
    const schools = db.prepare(`SELECT DISTINCT institution_id FROM source_discoveries WHERE discovery_status='registered'`).all()
    assert.equal(schools.length, 3)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM claims').get() as { count: number }).count, 0)
    env.DISCOVERY_REGISTER_LIMIT = '100'
    assert.equal((await registerDiscoveredSources(env, NOW)).registered, 27)
    assert.deepEqual(await registerDiscoveredSources(env, NOW), { registered: 0, deferred: 0 })
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM ingestion_sources').get() as { count: number }).count, 33)
  } finally { db.close() }
})

test('unsafe parents and URLs isolate only their discovery and are reconsidered after the policy cooldown', async () => {
  const db = discoveryDatabase()
  try {
    const parent = seedDiscoverySource(db)
    const snapshotId = seedDiscoverySnapshot(db, parent)
    seedDiscovery(db, parent, snapshotId, 'bad', 'https://evil.example.com/program')
    seedDiscovery(db, parent, snapshotId, 'good')
    const env = discoveryEnvironment(db)
    assert.deepEqual(await registerDiscoveredSources(env, NOW), { registered: 1, deferred: 1 })
    assert.deepEqual(await registerDiscoveredSources(env, NOW), { registered: 0, deferred: 0 })
    assert.equal((await registerDiscoveredSources(env, '2026-09-24T00:00:00.000Z')).deferred, 1)
    assert.equal((db.prepare(`SELECT discovery_status FROM source_discoveries WHERE discovery_id='bad'`).get() as { discovery_status: string }).discovery_status, 'rejected')
  } finally { db.close() }
})

test('automatic enrollment respects manual disable, existing manifests, and institution capacity', async () => {
  const db = discoveryDatabase()
  try {
    const parent = seedDiscoverySource(db)
    const snapshotId = seedDiscoverySnapshot(db, parent)
    seedDiscoverySource(db, { id: 'manual-disabled', enabled: false, officialUrl: 'https://admissions.example.edu.cn/disabled' })
    seedDiscovery(db, parent, snapshotId, 'disabled', 'https://admissions.example.edu.cn/disabled')
    seedDiscovery(db, parent, snapshotId, 'existing', parent.officialUrl)
    for (let i = 0; i < MAX_AUTOMATIC_SOURCES_PER_INSTITUTION; i++) {
      seedDiscoverySource(db, { id: `auto-discovery-d1-${i}`, officialUrl: `https://admissions.example.edu.cn/existing-${i}` })
    }
    seedDiscovery(db, parent, snapshotId, 'capped')
    const result = await registerDiscoveredSources(discoveryEnvironment(db), NOW)
    assert.deepEqual(result, { registered: 1, deferred: 2 })
    assert.equal((db.prepare(`SELECT enabled FROM ingestion_sources WHERE source_id='manual-disabled'`).get() as { enabled: number }).enabled, 0)
    assert.equal((db.prepare(`SELECT registered_source_id FROM source_discoveries WHERE discovery_id='existing'`).get() as { registered_source_id: string }).registered_source_id, parent.id)
  } finally { db.close() }
})

test('browser policy is applied before the scheduler limit so deferred sources cannot starve eligible work', async () => {
  const db = discoveryDatabase()
  try {
    seedDiscoverySource(db, { id: 'a-browser', sourceCategory: 'contacts', fetch: { renderMode: 'browser' } })
    seedDiscoverySource(db, { id: 'b-blocked', robots: { mode: 'blocked' } })
    seedDiscoverySource(db, { id: 'z-http', sourceCategory: 'dates_deadlines' })
    assert.deepEqual(await listDueSourceIds(discoveryEnvironment(db), NOW, 1, true, 'critical-only'), ['z-http'])
  } finally { db.close() }
})

test('a malformed manifest and failed enqueue do not prevent other due schools from running', async () => {
  const db = discoveryDatabase()
  try {
    seedDiscoverySource(db, { id: 'a-malformed' })
    db.prepare(`UPDATE ingestion_sources SET manifest_json = json_set(manifest_json, '$.extraction.fields', json('[]')) WHERE source_id='a-malformed'`).run()
    seedDiscoverySource(db, { id: 'b-queue-failure' })
    seedDiscoverySource(db, { id: 'c-healthy' })
    const env = discoveryEnvironment(db)
    const sent: string[] = []
    env.INGESTION_QUEUE.send = async (job) => {
      if (job.sourceId === 'b-queue-failure') throw new Error('Queue unavailable')
      sent.push(job.sourceId)
    }
    await assert.rejects(scheduleDueSources({ cron: '', scheduledTime: Date.parse(NOW) }, env), AggregateError)
    assert.deepEqual(sent, ['c-healthy'])
    const rows = db.prepare(`SELECT source_id,next_fetch_at FROM ingestion_sources WHERE source_id <> 'c-healthy'`).all() as { next_fetch_at: string }[]
    assert.equal(rows.every((row) => row.next_fetch_at === '2026-09-16T00:15:00.000Z'), true)
  } finally { db.close() }
})

test('reimporting pilot manifests preserves runtime discovery and fleet seed ownership', () => {
  const db = discoveryDatabase()
  try {
    const records = validatePilotSourceManifestDirectory()
    const institutionId = records[0]!.institutionId
    seedDiscoverySource(db, { id: 'auto-discovery-d1-preserved', institutionId })
    seedDiscoverySource(db, { id: 'auto-seed-preserved', institutionId })
    seedDiscoverySource(db, { id: 'removed-pilot-source', institutionId })
    db.exec(buildPilotSourceImport(records, NOW).sql)
    const enabled = db.prepare(`SELECT source_id FROM ingestion_sources WHERE enabled=1 AND source_id IN ('auto-discovery-d1-preserved','auto-seed-preserved','removed-pilot-source') ORDER BY source_id`).all() as { source_id: string }[]
    assert.deepEqual(enabled.map((row) => row.source_id), ['auto-discovery-d1-preserved','auto-seed-preserved'])
  } finally { db.close() }
})

test('official anchor fetch automatically produces snapshot-backed child jobs and catalog upgrades bypass 304', async () => {
  const db = discoveryDatabase()
  try {
    const parent = seedDiscoverySource(db)
    const env = discoveryEnvironment(db)
    const job: IngestionJob = { version: 1, jobId: 'initial-job', sourceId: parent.id, reason: 'scheduled', scheduledAt: NOW }
    db.prepare(`INSERT INTO ingestion_jobs (job_id,source_id,status,reason,scheduled_at,created_at,updated_at) VALUES (?,?,'running','scheduled',?,?,?)`).run(job.jobId,parent.id,NOW,NOW,NOW)
    db.prepare(`INSERT INTO ingestion_robots_cache (host,body,status_code,fetched_at,expires_at) VALUES ('admissions.example.edu.cn','',200,?,'2099-01-01T00:00:00.000Z')`).run(NOW)
    await processIngestionJob(env, job, async () => new Response('<title>Official admissions</title><a href="/catalog">Degree programmes</a>', { headers: { 'Content-Type': 'text/html', ETag: '"original"' } }), new Date(NOW))
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM source_discoveries').get() as { count: number }).count, 1)
    const sent: string[] = []
    env.INGESTION_QUEUE.send = async (queued) => { sent.push(queued.sourceId) }
    await scheduleDueSources({ cron: '', scheduledTime: Date.parse(NOW) }, env)
    assert.equal(sent.length, 1)
    assert.match(sent[0]!, /^auto-discovery-d1-/u)
    db.prepare(`UPDATE entity_extraction_runs SET extractor='official-html-v2'`).run()
    db.prepare(`UPDATE ingestion_jobs SET status='running',outcome=NULL,completed_at=NULL WHERE job_id=?`).run(job.jobId)
    await assert.rejects(processIngestionJob(env, job, async (_url, init) => {
      assert.equal(new Headers(init?.headers).has('If-None-Match'), false)
      return new Response(null, { status: 304 })
    }, new Date(NOW)), /without a current saved extraction/u)
    assert.equal((db.prepare('SELECT status FROM ingestion_jobs WHERE job_id=?').get(job.jobId) as { status: string }).status, 'running')
  } finally { db.close() }
})
test('overlapping schedulers or manual requests cannot claim two active jobs for one source', async () => {
  const db = discoveryDatabase()
  try {
    const parent = seedDiscoverySource(db)
    const env = discoveryEnvironment(db)
    const job: IngestionJob = { version: 1, jobId: 'first-job', sourceId: parent.id, reason: 'scheduled', scheduledAt: NOW }
    assert.equal(await claimJob(env, job), true)
    assert.equal(await claimJob(env, { ...job, jobId: 'overlapping-job' }), false)
    db.prepare(`UPDATE ingestion_jobs SET status='completed',completed_at=? WHERE job_id=?`).run(NOW, job.jobId)
    assert.equal(await claimJob(env, { ...job, jobId: 'next-job' }), true)
  } finally { db.close() }
})
test('a school homepage title and generic admissions navigation never create a program entity', async () => {
  const parent = sourceManifest({ id: 'auto-seed-homepage', sourceCategory: 'catalog_anchor', entityType: 'program' })
  const extraction = await buildOfficialEntityExtraction(parent, 'snapshot', 'job', parent.officialUrl,
    '<title>Peking University</title><h1>北京大学国际合作部</h1><nav><a href="/programs">Degree programmes</a></nav>', 'text/html', NOW)
  assert.ok(extraction)
  assert.deepEqual(extraction.candidates, [])
  assert.equal(discoverOfficialLinks('<a>'.repeat(100_000), parent, parent.officialUrl).length, 0)
})