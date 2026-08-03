const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const dataDir = path.join(root, 'content', 'data')
const checkedAt = '2026-08-02'
const reviewAfter = '2026-08-09'

// These official pages were reopened during the release audit and still show
// the same published cycles. A live page check is enough to renew the evidence
// window; no date, fee or eligibility value is changed here.
const refreshed = new Map([
  ['cycle-2026-3ff111b197cd', 'src-program-review-00734e75ed5e'], // Fudan PDF
  ['cycle-2026-a6e5661b86ff', 'src-program-review-88495cf206e1'], // Soochow 2026 guide
  ['cycle-2027-5df1a1f1218d', 'src-program-review-0f2dc2c02d7b'], // DUT ICL education bachelor
  ['cycle-2027-bf053c085767', 'src-program-review-b1c8f6686741'], // DUT business Chinese bachelor
])

// These pages could not be revalidated without bypassing a timeout, 403 or
// redirect loop. Mark only the dynamic cycle stale; the separately evidenced
// program identity remains available, while its dates stop being published.
const stale = new Set([
  'cycle-2026-1ccb060c1890',
  'cycle-2026-6a227bb6f214',
  'cycle-2026-0c884cf7d7fb',
  'cycle-2027-f7eb477163e2',
  'cycle-2026-d4f907d22a04',
  'cycle-2026-fba0e9f1f48a',
])

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'))
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(dataDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function main() {
  const cycles = readJson('admission-cycles.json')
  const sources = readJson('sources.json')
  const cycleIds = new Set(cycles.map((item) => item.id))
  const sourceById = new Map(sources.map((item) => [item.id, item]))

  for (const cycleId of [...refreshed.keys(), ...stale]) {
    if (!cycleIds.has(cycleId)) throw new Error(`Missing audited cycle ${cycleId}`)
  }
  for (const [cycleId, sourceId] of refreshed) {
    const cycle = cycles.find((item) => item.id === cycleId)
    if (!cycle.sourceIds.includes(sourceId)) {
      throw new Error(`${cycleId} does not reference ${sourceId}`)
    }
    const source = sourceById.get(sourceId)
    if (!source?.official || !source.url.startsWith('https://')) {
      throw new Error(`${sourceId} is not an official HTTPS source`)
    }
    cycle.verifiedAt = checkedAt
    cycle.reviewAfter = reviewAfter
    cycle.status = 'verified'
    source.accessedAt = checkedAt
  }
  for (const cycleId of stale) {
    const cycle = cycles.find((item) => item.id === cycleId)
    cycle.status = 'stale'
  }

  writeJson('admission-cycles.json', cycles)
  writeJson('sources.json', sources)
  console.log(JSON.stringify({
    checkedAt,
    refreshed: [...refreshed.keys()],
    markedStale: [...stale],
  }, null, 2))
}

main()
