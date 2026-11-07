/** Local computation benchmark; not a simulation of Vercel billing or CDN hits.
 * Run each scenario in a fresh process with:
 * node --conditions=react-server --import tsx scripts/quality/benchmark-fluid-cpu.ts <scenario> <output>
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import { getCatalogData } from '../../src/lib/data/load'
import { getCatalogDirectoryService, getCurrentCatalogRelease } from '../../src/lib/catalog-api/runtime'
import { JsonCatalogRepository } from '../../src/lib/catalog/json'
import { getTodayDate } from '../../src/lib/data/freshness'

const scenario = process.argv[2] ?? 'page-data'
const output = process.argv[3]
const repository = new JsonCatalogRepository()
const operations: Record<string, () => Promise<unknown>> = {
  'page-data': () => getCatalogData(),
  'directory-api': async () => (await getCatalogDirectoryService()).listPrograms({ limit: 24 }),
  release: () => getCurrentCatalogRelease(),
  'repository-list': () => repository.listPrograms({ view: 'directory', limit: 24 }),
}
const operation = operations[scenario]
if (!operation) throw Error('Unknown benchmark scenario')
async function measure(count: number, concurrent = false) {
  const memory = process.memoryUsage().heapUsed, start = performance.now(), cpu = process.cpuUsage()
  const values = concurrent ? await Promise.all(Array.from({ length: count }, operation)) : []
  if (!concurrent) for (let i = 0; i < count; i++) values.push(await operation())
  // Include response serialization: immutable results are consumed identically in both versions.
  const digests = values.map(value => createHash('sha256').update(JSON.stringify(value)).digest('hex'))
  const used = process.cpuUsage(cpu)
  return { count, cpuMs: (used.user + used.system) / 1000, wallMs: performance.now() - start,
    heapDeltaBytes: process.memoryUsage().heapUsed - memory, digests }
}
async function main() {
const result = {
  scenario, node: process.version, platform: process.platform, evaluatedForDate: getTodayDate(),
  inputSha256: createHash('sha256').update(['sources', 'cities', 'universities', 'programs', 'admission-cycles', 'scholarships', 'identity-acceptances', 'field-verifications']
    .map(name => existsSync(`content/data/${name}.json`) ? readFileSync(`content/data/${name}.json`, 'utf8') : '<missing>').join('\n')).digest('hex'),
  first: await measure(1), hot: await measure(10), concurrent: await measure(8, true),
}
if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n') }
console.log(JSON.stringify(result))
}
void main()
