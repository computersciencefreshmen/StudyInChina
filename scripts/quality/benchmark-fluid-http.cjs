// Local production Next server. CPU comes from the server process, not HTTP latency.
/* eslint-disable @typescript-eslint/no-require-imports -- forked plain Node entry point */
const { fork } = require('node:child_process')
const { createServer } = require('node:http')
const { readFileSync, writeFileSync } = require('node:fs')
const { performance } = require('node:perf_hooks')
if (process.argv[2] === '--server') {
  const next = require('next')({ dev: false, dir: process.cwd() })
  next.prepare().then(() => {
    let cpu, start, heap
    process.on('message', message => {
      if (message === 'start') { cpu = process.cpuUsage(); start = performance.now(); heap = process.memoryUsage().heapUsed; process.send({ started: true }) }
      if (message === 'end') { const used = process.cpuUsage(cpu); process.send({ cpuMs: (used.user + used.system) / 1000, wallMs: performance.now() - start, heapDeltaBytes: process.memoryUsage().heapUsed - heap }) }
    })
    const server = createServer(next.getRequestHandler())
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }))
  })
} else {
  async function main() {
    const child = fork(__filename, ['--server'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
    const receive = () => new Promise(resolve => child.once('message', resolve))
    try {
      const { port } = await receive()
      const universities = JSON.parse(readFileSync('content/data/universities.json', 'utf8'))
      const university = universities.find(item => item.status === 'verified')
      const paths = ['/en/universities', '/zh/universities', `/en/universities/${university.slug}`, `/zh/universities/${university.slug}`,
        '/api/v1/directory/programs?limit=24', '/api/v1/releases/current']
      const results = []
      for (const path of paths) {
        for (const [phase, count, concurrent] of [['first', 1, false], ['hot', 5, false], ['concurrent', 4, true]]) {
          let pending = receive(); child.send('start'); await pending
          const request = async () => {
            const start = performance.now(), response = await fetch(`http://127.0.0.1:${port}${path}`), body = await response.text()
            if (response.status !== 200 || (path.startsWith('/zh') && !body.includes('lang="zh"')) || (path.startsWith('/en') && !body.includes('lang="en"'))) throw Error(`Invalid response ${path}: ${response.status}`)
            return { status: response.status, bytes: Buffer.byteLength(body), cacheControl: response.headers.get('cache-control'), wallMs: performance.now() - start }
          }
          const responses = []
          if (concurrent) responses.push(...await Promise.all(Array.from({ length: count }, request)))
          else for (let i = 0; i < count; i++) responses.push(await request())
          pending = receive(); child.send('end'); const metrics = await pending
          results.push({ path, phase, count, ...metrics, responses })
        }
      }
      writeFileSync(process.argv[2], JSON.stringify({ node: process.version, results }, null, 2) + '\n')
      console.log('HTTP benchmark saved to ' + process.argv[2])
    } finally { child.kill() }
  }
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
