import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectSicasBatch, normalizeSicasState, roundRobinSicasSources, sicasRobotsPolicy } from './sicas-collector.mjs'
import { parseSicasProgram, parseSicasListing, sicasProgramIdentity, sourceHash } from './sicas-parser.mjs'

const source = (school, id) => ({ id: `sicas-${id}`, provider: 'SICAS', sourceId: String(id), schoolId: `sicas-${school}`,
  schoolName: 'URL-only school label', name: 'URL-only programme label', status: 'link_only', fields: {},
  sourceUrl: `https://www.sicas.com.cn/${school}/Slug/${id}/Slug` })
const page = (name = 'Finance', school = 'Example University') => `<!doctype html><body>
  <div class="sc-info"><h1 class="sc-title">${name}</h1><div class="sc-name">${school}</div>
  <div class="sc-des">The ${name} at ${school} is a 4 Years long program for international students, taught in Chinese.</div></div>
  <aside><div class="sidebar-detail">
    <div class="item"><div class="name">Start Date</div><div class="des">Sep 01 , 2026</div></div>
    <div class="item"><div class="name">Application Deadline</div><div class="des">Jul 30 , 2026</div></div>
    <div class="item"><div class="name">Tuition Fee</div><div class="des">$ 1361 USD/per year</div></div>
    <div class="item"><div class="name">&nbsp;</div><div class="des">￥ 9800 CNY/per year</div></div>
    <div class="item"><div class="name">Teaching Language</div><div class="des">Chinese</div></div>
    <div class="item"><div class="name">Application Fee</div><div class="des">$ 150 USD</div></div>
    <div class="item"><div class="name">Service Fee</div><div class="des">$ 50 USD</div></div>
  </div></aside>
  <div id="require"><div class="cards-text">Foreigners aged between 16 and 5. HSK level 6 or above.</div></div>
  <div id="materials"><div class="cards-text">A. Passport B. Academic transcript</div></div>
  <div id="about-program"><div class="cards-text">Historical programme brochure published in 2015.</div></div>
  <div id="fees"><div class="cards-text">Tuition fee: ￥ 9800 CNY/per year</div></div>
  <div class="similar-programmes">Start Date 2039 Tuition RMB 999999 <div class="sc-name">Wrong University</div></div>
  <script>throw new Error('Scripts must never execute')</script>
</body>`

test('programme identity rejects unsafe hosts/paths and preserves exact numeric source identities', () => {
  assert.deepEqual(sicasProgramIdentity(source(58, 55).sourceUrl), { schoolSourceId: '58', programmeSourceId: '55',
    url: 'https://www.sicas.com.cn/School/58/Slug/55/Slug' })
  for (const url of ['http://www.sicas.com.cn/School/1/A/2/B', 'https://www.sicas.com.cn.evil.test/School/1/A/2/B',
    'https://name:secret@www.sicas.com.cn/School/1/A/2/B', 'https://www.sicas.com.cn:444/School/1/A/2/B',
    'https://www.sicas.com.cn/Account/Login', 'https://www.sicas.com.cn/School/1/A%2fB/2/C']) assert.equal(sicasProgramIdentity(url), null)
})

test('literal fields retain old dates and anomalous source text, ignore related programmes, and never infer degree', () => {
  const html = page(), fetchedAt = '2026-11-17T00:00:00.000Z'
  const row = parseSicasProgram(html, { source: source(58, 55), sourceUrl: sicasProgramIdentity(source(58, 55).sourceUrl).url, fetchedAt })
  assert.equal(row.name, 'Finance'); assert.equal(row.schoolName, 'Example University')
  assert.equal(row.fields.tuition, '￥ 9800 CNY/per year'); assert.equal(row.fields.duration, '4 Years')
  assert.equal(row.fields.degree, undefined); assert.equal(row.admissionYear, null); assert.equal(row.official, false)
  assert.equal(row.fields.requirements, 'Foreigners aged between 16 and 5. HSK level 6 or above.')
  assert.equal(row.fields.startDate, 'Sep 01 , 2026'); assert.equal(row.fields.deadline, 'Jul 30 , 2026')
  assert.equal(row.evidenceHash, sourceHash(html)); assert.deepEqual(row.displayedDates[0].literalYears, ['2026'])
  assert.ok(!Object.values(row.fields).some(value => value.includes('999999')))
  for (const [field, value] of Object.entries(row.fields)) {
    assert.ok(row.fieldEvidence[field].text.includes(value)); assert.equal(row.fieldEvidence[field].evidenceHash, row.evidenceHash)
  }
  assert.equal(parseSicasProgram(html, { source: source(58, 99), sourceUrl: row.sourceUrl, fetchedAt }), null)
})

test('missing programme fields stay absent and an account/error page cannot become a programme', () => {
  const html = page().replace('<div id="materials"><div class="cards-text">A. Passport B. Academic transcript</div></div>', '')
  const row = parseSicasProgram(html, { source: source(58, 55), sourceUrl: sicasProgramIdentity(source(58, 55).sourceUrl).url })
  assert.equal(row.fields.materials, undefined)
  assert.equal(parseSicasProgram('<h1>Login</h1><p>Finance</p>', { sourceUrl: row.sourceUrl }), null)
})

test('listing entries carry exact programme IDs and a separate receipt instead of silently changing detail facts', () => {
  const rows = parseSicasListing('<div class="item"><div class="detail"><div class="top"><div class="name"><a href="/School/58/A/55/B">Finance</a></div></div></div></div>',
    { sourceUrl: 'https://www.sicas.com.cn/Search/List?degreeId=2', fetchedAt: '2026-11-17T00:00:00Z', rawSha256: 'a'.repeat(64), degreeDisplay: "Bachelor's Degree" })
  assert.equal(rows[0].id, 'sicas-55'); assert.equal(rows[0].degreeDisplay, "Bachelor's Degree")
  assert.equal(rows[0].evidenceHash, 'a'.repeat(64)); assert.match(rows[0].listingSourceUrl, /degreeId=2/)
})

test('school round-robin is deterministic and stable source IDs are deduplicated', () => {
  const a = source(1, 11), b = source(1, 12), c = source(2, 21), d = source(2, 22)
  assert.deepEqual(roundRobinSicasSources([d, b, a, c, a]).map(row => row.id), ['sicas-11', 'sicas-21', 'sicas-12', 'sicas-22'])
})

test('robots uses the actual research user agent, allows the longest matching rule, and honors crawl delay', () => {
  const policy = sicasRobotsPolicy('User-agent: Googlebot\nAllow: /\nUser-agent: *\nDisallow: /School/\nAllow: /School/58/\nCrawl-delay: 2')
  assert.equal(policy.allows('https://www.sicas.com.cn/School/1/A/2/B'), false)
  assert.equal(policy.allows('https://www.sicas.com.cn/School/58/A/2/B'), true)
  assert.equal(policy.delayMs, 2000)
})

function clockFixture() {
  let time = Date.parse('2026-11-17T00:00:00.000Z')
  return { now: () => time, sleeper: async ms => { time += ms }, advance: ms => { time += ms } }
}

test('batch returns literal records, retains prior outcomes, spaces starts, and caps total requests including robots', async () => {
  const clock = clockFixture(), starts = [], inputs = []
  const result = await collectSicasBatch({ sources: [source(1, 11), source(2, 21), source(1, 12)], limit: 3, ...clock,
    state: { outcomes: { 'sicas-99': { status: 'unavailable', attempts: 1, nextAttemptAt: '2026-12-17T00:00:00Z' } } },
    fetcher: async (url, init) => {
      starts.push(clock.now()); inputs.push({ url, init })
      return new Response(url.endsWith('/robots.txt') ? null : page(), { status: url.endsWith('/robots.txt') ? 404 : 200 })
    } })
  assert.equal(result.records.length, 2); assert.equal(result.summary.requests, 3)
  assert.deepEqual(result.records.map(row => row.id).sort(), ['sicas-11', 'sicas-21'])
  assert.equal(result.state.outcomes['sicas-99'].status, 'unavailable')
  assert.ok(starts.slice(1).every((time, i) => time - starts[i] >= 750))
  assert.ok(result.summary.maxInFlight <= 2)
  assert.ok(inputs.every(row => row.init.method === 'GET' && row.init.redirect === 'manual' && !row.init.headers.Cookie))
  assert.equal(result.summary.modelCalls, 0); assert.equal(result.summary.officialVerificationPerformed, false)
  assert.ok(result.receipts.every(row => !('rawBodyPath' in row) && !('html' in row)))
})

test('a 429 stops the provider, saves cooldown, and a resumed batch performs zero requests during cooldown', async () => {
  const clock = clockFixture()
  const result = await collectSicasBatch({ sources: [source(1, 11), source(2, 21), source(3, 31)], limit: 5, ...clock,
    fetcher: async url => new Response(null, { status: url.endsWith('/robots.txt') ? 404 : 429, headers: { 'retry-after': '3600' } }) })
  assert.equal(result.summary.stoppedHost, true)
  assert.equal(result.state.hosts['www.sicas.com.cn'].reason, 'http_429')
  assert.ok(Object.values(result.state.outcomes).some(row => row.status === 'blocked'))
  const resumed = await collectSicasBatch({ sources: [source(1, 11)], state: result.state, ...clock,
    fetcher: async () => { throw new Error('No request is permitted in cooldown') } })
  assert.equal(resumed.summary.requests, 0)
  assert.deepEqual(resumed.state.outcomes, result.state.outcomes)
})

test('robots HTML redirects are not followed; a robots disallow never sends a detail request', async () => {
  for (const robots of [new Response(null, { status: 302, headers: { location: 'https://www.sicas.com.cn/School/1/A/11/B' } }),
    new Response('User-agent: *\nDisallow: /', { status: 200, headers: { 'content-type': 'text/plain' } })]) {
    const urls = [], clock = clockFixture()
    const result = await collectSicasBatch({ sources: [source(1, 11)], ...clock, fetcher: async url => { urls.push(url); return robots } })
    assert.deepEqual(urls, ['https://www.sicas.com.cn/robots.txt'])
    assert.equal(result.records.length, 0)
  }
})

test('404 is a slow retry and malformed state cannot inject arbitrary properties or hosts', async () => {
  const clock = clockFixture()
  const result = await collectSicasBatch({ sources: [source(1, 11)], ...clock,
    fetcher: async () => new Response(null, { status: 404 }) })
  assert.equal(result.state.outcomes['sicas-11'].status, 'unavailable')
  assert.ok(Date.parse(result.state.outcomes['sicas-11'].nextAttemptAt) - clock.now() >= 7 * 86400000)
  const clean = normalizeSicasState({ cursor: -1, secret: 'not copied', hosts: { 'evil.test': { blockedUntil: '2099-01-01T00:00:00Z' } },
    outcomes: { bad: { status: 'captured' }, 'sicas-2': { status: 'retry', attempts: 2, secret: 'not copied', errorCode: 'network_error' } } })
  assert.equal(clean.secret, undefined); assert.equal(clean.outcomes['sicas-2'].secret, undefined)
  assert.deepEqual(clean.hosts, {}); assert.equal(clean.cursor, 0)
})

test('zero budget and an expired deadline never start even a robots request', async () => {
  const clock = clockFixture(), fetcher = async () => { throw new Error('No request is allowed') }
  for (const options of [{ limit: 0 }, { deadlineAt: clock.now() - 1 }]) {
    const result = await collectSicasBatch({ sources: [source(1, 11)], ...clock, fetcher, ...options })
    assert.equal(result.summary.requests, 0)
  }
})

test('two slow detail responses can overlap while request starts remain spaced', { timeout: 2000 }, async () => {
  const clock = clockFixture(), pending = [], starts = []
  const result = await collectSicasBatch({ sources: [source(1, 11), source(2, 21)], limit: 3, ...clock,
    fetcher: async url => {
      starts.push(clock.now())
      if (url.endsWith('/robots.txt')) return new Response(null, { status: 404 })
      return new Promise(resolve => {
        pending.push(resolve)
        if (pending.length === 2) for (const done of pending) done(new Response(page(), { status: 200 }))
      })
    } })
  assert.equal(result.summary.maxInFlight, 2); assert.equal(result.records.length, 2)
  assert.ok(starts.slice(1).every((time, index) => time - starts[index] >= 750))
})

test('detail redirects are not followed and failure output never exposes exception contents', async () => {
  const clock = clockFixture(), urls = []
  const redirected = await collectSicasBatch({ sources: [source(1, 11)], ...clock,
    fetcher: async url => { urls.push(url); return new Response(null, { status: url.endsWith('/robots.txt') ? 404 : 302,
      headers: { location: 'https://evil.test/private' } }) } })
  assert.equal(urls.length, 2); assert.equal(redirected.state.outcomes['sicas-11'].errorCode, 'redirect_not_followed')
  const failed = await collectSicasBatch({ sources: [source(1, 11)], ...clock,
    fetcher: async url => { if (url.endsWith('/robots.txt')) return new Response(null, { status: 404 }); throw new Error('arbitrary private exception content') } })
  assert.equal(failed.state.outcomes['sicas-11'].errorCode, 'network_error')
  assert.ok(!JSON.stringify(failed).includes('arbitrary private'))
})
