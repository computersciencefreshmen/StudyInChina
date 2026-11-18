import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { FEED_BRANCH, MAX_INDEX_BYTES, MAX_INDEX_RECORDS, emptyProgress, feedRevision, loadProgramFeed, mergeProgramRecords, sanitizeProgram, sha256, writeProgramFeed } from './program-catalog-feed.mjs'
import { checkpointFeed, collectFeedCandidate, harvestMonitor, harvestProgramCatalog, publishFeedCandidate } from './harvest-program-catalog.mjs'
import { pushCatalogCheckpoint } from './push-catalog-checkpoint.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    const checked = realpathSync(root)
    assert.equal(dirname(checked), realpathSync(tmpdir()))
    assert.ok(basename(checked).startsWith('sic-feed-test-'))
    rmSync(checked, { recursive: true, force: true })
  }
})
const temporaryRoot = () => { const root = mkdtempSync(join(tmpdir(), 'sic-feed-test-')); roots.push(root); return root }
function program(n = 1, status = 'link_only') {
  return { id: `sicas-${n}`, sourceId: String(n), schoolId: 'sicas-1', provider: 'SICAS', schoolName: 'Example University',
    name: `Medicine ${n}`, sourceUrl: `https://www.sicas.com.cn/School/1/Program/${n}`, status,
    admissionYear: 2035, official: true, fields: status === 'extracted' ? { tuition: 'RMB 20,000 per year', startDate: 'Sep 1, 2035' } : { tuition: 'must not be inferred' },
    ...(status === 'extracted' ? { fetchedAt: '2026-11-17T00:00:00Z', evidenceHash: sha256('public raw body'),
      fieldEvidence: { tuition: { selector: '.tuition', text: 'Tuition: RMB 20,000 per year' }, startDate: { selector: '.start', text: 'Starting date: Sep 1, 2035' } } } : {}) }
}
const write = (root, records, state = emptyProgress()) => {
  const manifest = writeProgramFeed(root, { records, state, generatedAt: '2026-11-17T00:00:00Z' })
  writeFileSync(join(root, 'vercel.json'), JSON.stringify({ git: { deploymentEnabled: false } }))
  return manifest
}

test('round-trips captured details and keeps source-link facts and admission years unknown', () => {
  const root = temporaryRoot(), manifest = write(root, [program(1), program(2, 'extracted')])
  const loaded = loadProgramFeed(root)
  assert.deepEqual(manifest.counts, { programCount: 2, capturedCount: 1, schoolCount: 1, sourceCount: 2 })
  assert.deepEqual(loaded.records[0].fields, {})
  assert.equal(loaded.records[1].fields.startDate, 'Sep 1, 2035')
  for (const row of loaded.records) { assert.equal(row.official, false); assert.equal(row.admissionYear, null) }
  assert.equal(loaded.records[1].fieldEvidence.tuition.text, 'Tuition: RMB 20,000 per year')
})

test('bounds every content-addressed index by both record count and bytes', () => {
  const root = temporaryRoot()
  const rows = Array.from({ length: 701 }, (_, i) => ({ ...program(i + 1), name: 'N'.repeat(1900) }))
  const manifest = write(root, rows)
  assert.ok(manifest.indexShards.length > 1)
  for (const shard of manifest.indexShards) {
    assert.ok(shard.count <= MAX_INDEX_RECORDS)
    assert.ok(shard.bytes <= MAX_INDEX_BYTES)
    assert.equal(sha256(readFileSync(join(root, shard.path))), shard.sha256)
  }
  assert.equal(loadProgramFeed(root).records.length, rows.length)
})

test('a progress-only checkpoint does not change the public content revision', () => {
  const root = temporaryRoot(), first = write(root, [program()])
  const next = write(root, [program()], { ...emptyProgress(), updatedAt: '2026-11-17T01:00:00Z', cursor: 1 })
  assert.equal(first.revision, next.revision)
  assert.notEqual(first.state.sha256, next.state.sha256)
})

test('rejects tampered content hashes and path traversal before loading records', () => {
  const root = temporaryRoot(), manifest = write(root, [program()])
  writeFileSync(join(root, manifest.indexShards[0].path), 'changed')
  assert.throws(() => loadProgramFeed(root), /feed_hash_mismatch/)
  const other = temporaryRoot(), m = write(other, [program()])
  m.indexShards[0].path = '../private.json'
  m.revision = feedRevision(m.counts, m.indexShards)
  writeFileSync(join(other, 'manifest.json'), JSON.stringify(m))
  assert.throws(() => loadProgramFeed(other), /feed_path_invalid/)
})

test('drops private record extras and rejects credentials, raw HTML or private paths in state', () => {
  const row = sanitizeProgram({ ...program(), rawBodyPath: 'C:\\Users\\private.html', authorization: 'never publish' })
  assert.equal(row.rawBodyPath, undefined)
  assert.equal(row.authorization, undefined)
  for (const state of [{ token: 'sensitive' }, { headers: { cookie: 'sensitive' } }, { debug: '<html>raw</html>' }, { file: 'C:\\Users\\Henry\\private' }]) {
    assert.throws(() => write(temporaryRoot(), [program()], state), /feed_state_private/)
  }
})

test('merging retains newest captured facts, never downgrades to URL-only, and rejects conflicting schools', () => {
  const latest = program(1, 'extracted'), old = { ...latest, fetchedAt: '2026-01-01T00:00:00Z' }
  const merged = mergeProgramRecords([latest], [old, program(1), { ...latest, schoolId: 'sicas-2' }])
  assert.equal(merged.records[0].fetchedAt, latest.fetchedAt)
  assert.equal(merged.records[0].status, 'extracted')
  assert.deepEqual(merged.rejected, [{ id: latest.id, errorCode: 'invalid_feed_record' }])
  assert.throws(() => sanitizeProgram({ ...latest, fieldEvidence: undefined }, { requireFieldEvidence: true }), /feed_missing_field_evidence/)
  assert.equal(sanitizeProgram({ ...latest, fieldEvidence: undefined }).fields.tuition, latest.fields.tuition)
  assert.equal(mergeProgramRecords([], [{ ...latest, fieldEvidence: undefined }]).rejected.length, 1)
})

function fakeGit(root, { failPush = false, wrongBranch = false } = {}) {
  const calls = []
  return { calls, run: (_root, args) => {
    calls.push(args)
    if (args.join(' ') === 'rev-parse --show-toplevel') return resolve(root)
    if (args.join(' ') === 'branch --show-current') return wrongBranch ? 'main' : FEED_BRANCH
    if (args.join(' ') === 'remote get-url origin') return 'https://github.com/computersciencefreshmen/StudyInChina.git'
    if (args[0] === 'diff') return calls.some(c => c[0] === 'add') ? 'manifest.json\nstate/progress.json' : ''
    if (args[0] === 'push' && failPush) throw new Error('simulated push failure')
    return ''
  } }
}

test('scope-bound older fields retain original provenance; new intakes never borrow previous fees', () => {
  const prior = program(1, 'extracted')
  prior.archiveSha256 = prior.evidenceHash
  const track = { degree: 'Bachelor', language: 'English' }
  const trackProof = { degree: { selector: '.degree', text: 'Bachelor' }, language: { selector: '.language', text: 'English' } }
  Object.assign(prior.fields, track)
  Object.assign(prior.fieldEvidence, trackProof)
  const sparse = { ...prior, fetchedAt: '2026-11-18T00:00:00Z', evidenceHash: sha256('new body'),
    fields: { ...track, startDate: prior.fields.startDate, tuition: 'TBD' },
    fieldEvidence: { ...trackProof, startDate: prior.fieldEvidence.startDate, tuition: { text: 'Fee: TBD', selector: '.tuition' } } }
  const merged = mergeProgramRecords([prior], [sparse]).records[0]
  assert.equal(merged.fields.tuition, prior.fields.tuition)
  assert.equal(merged.fieldEvidence.tuition.evidenceHash, prior.evidenceHash)
  assert.equal(merged.fieldEvidence.tuition.archiveSha256, prior.evidenceHash)
  assert.equal(merged.fieldEvidence.tuition.fetchedAt, prior.fetchedAt)
  for (const missing of ['degree', 'language']) {
    const earlier = structuredClone(prior), newer = structuredClone(sparse)
    delete earlier.fields[missing]; delete newer.fields[missing]
    const blocked = mergeProgramRecords([earlier], [newer])
    assert.equal(blocked.held[0].errorCode, 'incomplete_evidence_scope')
    assert.equal(blocked.records[0].fetchedAt, prior.fetchedAt)
  }
  const nextIntake = { ...sparse, fields: { startDate: 'Sep 1, 2036' }, fieldEvidence: { startDate: { selector: '.start', text: 'Sep 1, 2036' } } }
  assert.equal(mergeProgramRecords([prior], [nextIntake]).records[0].fields.tuition, undefined)
  const uncertain = mergeProgramRecords([prior], [{ ...sparse, fields: {}, fieldEvidence: {} }])
  assert.equal(uncertain.records[0].fetchedAt, prior.fetchedAt)
  assert.equal(uncertain.held[0].errorCode, 'incomplete_evidence_scope')
  assert.equal(mergeProgramRecords([prior], [{ ...sparse, name: 'Other program' }]).rejected.length, 1)
})

test('staged harvest replays once and a stale cursor cannot overwrite a newer collection', async () => {
  const root = temporaryRoot(); write(root, [program()]); const git = fakeGit(root)
  const first = await collectFeedCandidate({ feedDir: root, git: git.run,
    collector: async ({ state }) => ({ records: [], state, receipts: [] }) })
  assert.equal(git.calls.some(args => args[0] === 'push'), false)
  const competing = { ...first, generatedAt: '2026-11-17T02:00:00Z' }
  assert.equal(publishFeedCandidate(root, first, git.run).pushed, true)
  assert.equal(publishFeedCandidate(root, first, git.run).reused, true)
  assert.throws(() => publishFeedCandidate(root, competing, git.run), /cursor_conflict/)
})

test('health counts four distinct eligible windows, skips idle and resets only on visible growth', () => {
  let state
  const tick = (minute, attempted = 1, grew = false) => {
    state = harvestMonitor(state, { generatedAt: new Date(Date.UTC(2026, 10, 18, 0, minute)).toISOString(), attempted }, grew, 1, 0)
  }
  tick(0); tick(2); tick(15, 0); tick(30); tick(45); tick(60)
  assert.equal(state.eligibleWindowsWithoutGrowth, 4); assert.equal(state.reason, 'scope_review')
  tick(61, 1, true); tick(62); assert.equal(state.eligibleWindowsWithoutGrowth, 0)
})

test('both publishers rebase disjoint work, reject overlapping writes and recognize an acknowledged push', () => {
  for (const lane of ['harvest', 'translation']) {
    function race(changes, remote = '3'.repeat(40)) {
      let pushes = 0, rebases = 0
      const git = args => {
        if (args[0] === 'push' && ++pushes === 1) throw Error('push conflict')
        if (args[0] === 'rev-parse') return args[1] === 'HEAD^' ? '1'.repeat(40) : args[1] === 'HEAD' ? '2'.repeat(40) : remote
        if (args[0] === 'diff') return changes
        if (args.includes('rebase')) rebases++
        return ''
      }
      pushCatalogCheckpoint(git, lane)
      return [pushes, rebases]
    }
    const other = lane === 'harvest' ? 'translations/status.json\0' : 'manifest.json\0indexes/abc.json\0'
    assert.deepEqual(race(other), [2, 1])
    assert.deepEqual(race(other, '2'.repeat(40)), [1, 0])
    assert.throws(() => race('manifest.json\0translations/status.json\0'), /namespace_conflict/)
  }
})

test('commits and pushes a 403 backoff checkpoint and withholds GitHub credentials from the collector', async () => {
  const root = temporaryRoot(); write(root, [program()]); const git = fakeGit(root)
  const result = await harvestProgramCatalog({ feedDir: root, git: git.run, now: () => Date.parse('2026-11-17T01:00:00Z'),
    environment: { GITHUB_TOKEN: 'must not be passed', RUNNER_TEMP: '/runner-temp' }, collector: async input => {
      assert.equal(input.limit, 150)
      assert.equal(input.deadlineAt, Date.parse('2026-11-17T01:09:00Z'))
      assert.equal(input.environment.GITHUB_TOKEN, undefined)
      return { records: [], state: { ...input.state, cursor: 1, updatedAt: '2026-11-17T01:00:00Z',
        hosts: { 'www.sicas.com.cn': { blockedUntil: '2026-11-18T01:00:00Z', reason: 'http_403', httpStatus: 403 } } },
      receipts: [{ provider: 'SICAS', sourceUrl: program().sourceUrl, status: 403, headers: { authorization: 'must not publish' } }], summary: { modelCalls: 0 } }
    } })
  assert.equal(result.pushed, true)
  assert.equal(loadProgramFeed(root).state.hosts['www.sicas.com.cn'].httpStatus, 403)
  assert.equal(git.calls.filter(args => args[0] === 'push').length, 1)
  assert.ok(git.calls.findIndex(args => args[0] === 'push') > git.calls.findIndex(args => args.includes('commit')))
})

test('fails before collecting on the wrong branch and never retries a rejected checkpoint push', async () => {
  const root = temporaryRoot(); write(root, [program()]); const wrong = fakeGit(root, { wrongBranch: true })
  let collected = 0
  const collector = async ({ state }) => { collected++; return { records: [], state, receipts: [], summary: {} } }
  await assert.rejects(harvestProgramCatalog({ feedDir: root, git: wrong.run, collector }), /feed_checkout_invalid/)
  assert.equal(collected, 0)
  const failing = fakeGit(root, { failPush: true })
  await assert.rejects(harvestProgramCatalog({ feedDir: root, git: failing.run, collector }), /simulated push failure/)
  assert.equal(collected, 1)
  assert.equal(failing.calls.filter(args => args[0] === 'push').length, 1)
  assert.throws(() => checkpointFeed(root, 'abc', fakeGit(root, { wrongBranch: true }).run), /feed_checkout_invalid/)
})

test('the real SICAS collector integrates with immutable feed publication using offline responses', async () => {
  const { collectSicasBatch } = await import('../harvest/sicas-collector.mjs')
  const root = temporaryRoot()
  const source = { ...program(55), schoolId: 'sicas-58', sourceUrl: 'https://www.sicas.com.cn/58/Example/55/Finance' }
  write(root, [source])
  let time = Date.parse('2026-11-17T00:00:00Z')
  const html = '<html><div class="sc-info"><h1 class="sc-title">Finance</h1><div class="sc-name">Example University</div><div class="sc-des">The Finance at Example University is a 4 Years long program for international students, taught in Chinese.</div></div><div class="sidebar-detail"><div class="item"><div class="name">Tuition Fee</div><div class="des">RMB 20,000 per year</div></div></div></html>'
  const git = fakeGit(root)
  const result = await harvestProgramCatalog({ feedDir: root, git: git.run, limit: 2, now: () => time,
    collector: input => collectSicasBatch({ ...input, now: () => time, sleeper: async ms => { time += ms },
      fetcher: async url => new Response(url.endsWith('/robots.txt') ? null : html, { status: url.endsWith('/robots.txt') ? 404 : 200 }) }) })
  assert.equal(result.counts.capturedCount, 1)
  assert.equal(result.pushed, true)
  const loaded = loadProgramFeed(root)
  assert.equal(loaded.records[0].name, 'Finance')
  assert.equal(loaded.records[0].fields.duration, '4 Years')
  assert.equal(loaded.records[0].admissionYear, null)
  assert.equal(loaded.state.outcomes['sicas-55'].status, 'captured')
})

test('refuses checkpoint publication unless the data branch explicitly disables Vercel deployments', () => {
  const root = temporaryRoot(); write(root, [program()])
  writeFileSync(join(root, 'vercel.json'), '{}')
  const git = fakeGit(root)
  assert.throws(() => checkpointFeed(root, 'abc', git.run), /feed_preview_not_disabled/)
  assert.equal(git.calls.some(args => args[0] === 'push'), false)
})
