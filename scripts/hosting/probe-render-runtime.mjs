/** Bounded LOCAL probe of the actual start wrapper. Not a Linux cgroup or platform SLA test. */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const output = resolve(process.argv[2] || '.tmp/render-runtime-probe.json')
mkdirSync(dirname(output), { recursive: true })
const samplesFile = output + '.ndjson'
writeFileSync(samplesFile, '')
const port = await new Promise((accept, reject) => {
  const server = createServer(); server.on('error', reject)
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => accept(port)) })
})
const origin = `http://127.0.0.1:${port}`, externalOrigin = 'https://studyinchina-candidate.onrender.com'
const password = randomBytes(32).toString('hex')
const preload = fileURLToPath(new URL('./probe-memory-preload.cjs', import.meta.url))
const started = performance.now(), checks = []
const inheritedEnvironment = { ...process.env }
for (const key of ['VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_GIT_COMMIT_SHA']) delete inheritedEnvironment[key]
const child = spawn(process.execPath, ['scripts/hosting/start-render.mjs'], { stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...inheritedEnvironment, NODE_ENV: 'production', RENDER: 'true', RENDER_EXTERNAL_URL: externalOrigin,
    NEXT_PUBLIC_SITE_URL: externalOrigin, RENDER_GIT_COMMIT: 'a'.repeat(40),
    PORT: String(port), CONTENT_PREVIEW: 'false', CATALOG_BACKEND: 'json',
    ADMIN_ACCESS_TOKEN: password, ADMIN_SESSION_SECRET: randomBytes(32).toString('hex'), ADMIN_LOGIN_RATE_LIMIT_MODE: 'memory',
    ADMIN_LOCAL_VERIFICATION_ENABLED: 'false', ADMIN_REMOTE_CONTROL_ENABLED: 'false', ADMIN_RELEASE_CONTROL_ENABLED: 'false',
    ADMIN_TELEMETRY_URL: '', ADMIN_TELEMETRY_TOKEN: '', HOSTING_MEMORY_PROBE_FILE: samplesFile,
    NODE_OPTIONS: `--require=${JSON.stringify(preload)} --max-old-space-size=256` } })
let exited = false
child.on('exit', () => { exited = true })
// Discard server logs: proof stores status booleans and memory only, never cookies/credentials.
child.stdout.resume(); child.stderr.resume()
const headers = { 'x-forwarded-proto': 'https', origin: externalOrigin }
async function get(path, expectedStatus = 200, cookie) {
  const response = await fetch(origin + path, { headers: { ...headers, ...(cookie ? { cookie } : {}) }, signal: AbortSignal.timeout(20_000) })
  const text = await response.text()
  if (response.status !== expectedStatus) throw Error(`Unexpected ${path} status ${response.status}`)
  return { response, text }
}
try {
  for (;;) {
    if (exited) throw Error('Start wrapper exited before readiness')
    try { const { response } = await get('/api/health'); if (response.ok) break } catch { /* bounded readiness retry */ }
    if (performance.now() - started > 90_000) throw Error('Readiness timeout')
    await new Promise(accept => setTimeout(accept, 200))
  }
  checks.push({ check: 'strict-health', pass: true, readyWallMs: performance.now() - started })
  const universities = JSON.parse(readFileSync('content/data/universities.json', 'utf8'))
  const slug = universities.find(item => item.status === 'verified').slug
  const paths = ['/en/universities', '/zh/universities', `/en/universities/${slug}`, `/zh/universities/${slug}`,
    '/api/v1/directory/programs?limit=24', '/api/v1/releases/current']
  for (let round = 0; round < 10; round++) {
    await Promise.all(paths.map(async path => {
      const { text } = await get(path)
      if (path.startsWith('/en') && (!text.includes('lang="en"') || !text.includes(externalOrigin))) throw Error('English origin/language mismatch')
      if (path.startsWith('/zh') && (!text.includes('lang="zh"') || !text.includes(externalOrigin))) throw Error('Chinese origin/language mismatch')
      if (path.endsWith('/current') && JSON.parse(text).data.deploymentSha !== 'a'.repeat(40)) throw Error('Render commit mismatch')
    }))
  }
  checks.push({ check: 'public-concurrent-origin-languages-release', requests: 60, concurrency: 6, pass: true })
  const denied = await get('/api/admin/status', 401)
  if (!denied.response.headers.get('cache-control')?.includes('no-store')) throw Error('Admin response cache isolation')
  const login = await fetch(origin + '/api/admin/session', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
  const cookieHeader = login.headers.get('set-cookie') || ''
  if (login.status !== 200 || !/;\s*Secure/i.test(cookieHeader) || !/;\s*HttpOnly/i.test(cookieHeader) || !/SameSite=strict/i.test(cookieHeader)) throw Error('Proxy HTTPS session cookie failed')
  const cookie = cookieHeader.split(';')[0]
  const session = JSON.parse((await get('/api/admin/session', 200, cookie)).text)
  if (!session.authenticated) throw Error('Authenticated session failed')
  const wrongOrigin = await fetch(origin + '/api/admin/session', { method: 'DELETE', headers: { ...headers, origin: 'https://attacker.example', cookie } })
  if (wrongOrigin.status !== 403) throw Error('Cross-origin mutation accepted')
  const events = await fetch(origin + '/api/admin/events', { headers: { ...headers, cookie }, signal: AbortSignal.timeout(20_000) })
  const reader = events.body.getReader(), firstEvent = await reader.read()
  if (events.status !== 200 || !events.headers.get('content-type')?.includes('text/event-stream') || firstEvent.done) throw Error('SSE failed')
  await reader.cancel()
  const logout = await fetch(origin + '/api/admin/session', { method: 'DELETE', headers: { ...headers, cookie } })
  if (logout.status !== 200 || !/Max-Age=0/i.test(logout.headers.get('set-cookie') || '')) throw Error('Logout failed')
  checks.push({ check: 'auth-cookie-https-csrf-sse-logout', pass: true, fixtureRateLimitMode: 'memory; production distributed unchanged' })
} catch (error) {
  checks.push({ check: 'probe', pass: false, error: error.message })
  process.exitCode = 1
} finally {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGTERM')
  if (!exited) await Promise.race([new Promise(accept => child.once('exit', accept)), new Promise(accept => setTimeout(accept, 3000))])
  const samples = readFileSync(samplesFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  const byPid = new Map()
  const activeRss = new Map()
  let sampledConcurrentPeakRssBytes = 0
  for (const sample of samples) {
    const record = byPid.get(sample.pid) || { pid: sample.pid, role: sample.role, peakRssBytes: 0, peakHeapBytes: 0, cpuMs: 0 }
    record.peakRssBytes = Math.max(record.peakRssBytes, sample.rss, sample.maxRssKiB * 1024)
    record.peakHeapBytes = Math.max(record.peakHeapBytes, sample.heapUsed)
    record.cpuMs = Math.max(record.cpuMs, sample.cpuUs / 1000)
    byPid.set(sample.pid, record)
    activeRss.set(sample.pid, sample.rss)
    sampledConcurrentPeakRssBytes = Math.max(sampledConcurrentPeakRssBytes, [...activeRss.values()].reduce((sum, rss) => sum + rss, 0))
    if (sample.phase === 'exit') activeRss.delete(sample.pid)
  }
  const result = { pass: checks.every(check => check.pass), platform: process.platform, node: process.version,
    heapLimitMiBPerNodeProcess: 256, hardMemoryLimitApplied: false, checks, processes: [...byPid.values()],
    sumOfIndividualPeakRssBytes: [...byPid.values()].reduce((sum, item) => sum + item.peakRssBytes, 0),
    sampledConcurrentPeakRssBytes,
    limitation: 'Windows RSS with a V8 heap cap; sum of peaks is conservative, not simultaneous cgroup usage. Linux/Render validation still required.' }
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
}
