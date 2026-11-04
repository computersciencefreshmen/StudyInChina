/* eslint-disable @typescript-eslint/no-require-imports -- Node preload for local measurement only */
const { appendFileSync } = require('node:fs')
const { basename } = require('node:path')
const output = process.env.HOSTING_MEMORY_PROBE_FILE
if (output) {
  const sample = phase => {
    const memory = process.memoryUsage(), cpu = process.cpuUsage()
    appendFileSync(output, JSON.stringify({ time: Date.now(), pid: process.pid, parentPid: process.ppid,
      role: basename(process.argv[1] || 'node'), phase, rss: memory.rss, heapUsed: memory.heapUsed,
      maxRssKiB: process.resourceUsage().maxRSS, cpuUs: cpu.user + cpu.system }) + '\n')
  }
  sample('startup')
  const timer = setInterval(() => sample('interval'), 100)
  timer.unref()
  process.on('exit', () => { clearInterval(timer); sample('exit') })
}
