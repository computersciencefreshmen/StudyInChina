import { readFileSync, writeFileSync } from 'node:fs'
import { bundleSchema } from '../../src/lib/data/schema'
import { getTodayDate } from '../../src/lib/data/freshness'
import { readAuditData } from './comprehensive-data-audit'
import type { DataBundle } from '../../src/lib/data/types'

async function main() {
const today = '2026-09-16'
if (getTodayDate() !== today) throw new Error('Perform a new link review before applying this dated remediation.')
const data = readAuditData(process.cwd())
const links = JSON.parse(readFileSync('quality/audit-2026-09-16-links.json', 'utf8')) as { results: { url: string; severity: string; status: number | null }[] }
const broken = new Set(links.results.filter(link => link.severity === 'hard' && link.status === 404).map(link => link.url))
const brokenSourceIds = new Set(data.sources.filter(source => broken.has(source.url)).map(source => source.id))
const changes: { collection: keyof DataBundle; id: string; before: unknown; after: unknown; reason: string }[] = []
const replacements = [
  { id: 'source-review-njucm-profile-2026-09-16', url: 'https://english.njucm.edu.cn/5128/list.htm', title: 'Introduction of NJUCM', publisher: 'Nanjing University of Chinese Medicine', kind: 'university' as const, language: 'en' as const },
  { id: 'source-review-njucm-admissions-2026-09-16', url: 'https://english.njucm.edu.cn/2019/0411/c5134a75522/page.htm', title: 'International Education College — official university description', publisher: 'Nanjing University of Chinese Medicine', kind: 'admissions' as const, language: 'en' as const },
  { id: 'source-review-hainan-admissions-2026-09-16', url: 'https://www.muhn.edu.cn/gjxy/zsgl/zsjz.htm', title: '海南医科大学国际学生学历生招生简章（2026）', publisher: 'Hainan Medical University', kind: 'admissions' as const, language: 'zh' as const },
]
for (const source of replacements) {
  const response = await fetch(source.url, { signal: AbortSignal.timeout(20000) })
  if (response.status !== 200) throw new Error(`Replacement source unavailable: ${source.url}`)
  const body = await response.text()
  if (body.length < 2000 || (!body.includes('2026') && !body.includes('NJUCM'))) throw new Error(`Unexpected source content: ${source.url}`)
  if (!data.sources.some(existing => existing.id === source.id)) {
    const next = { ...source, official: true, accessedAt: today }
    data.sources.push(next)
    changes.push({ collection: 'sources', id: source.id, before: null, after: next, reason: 'Official replacement page was opened and its institutional/admissions role reviewed; this does not renew any program facts.' })
  }
}
for (const collection of ['universities', 'programs', 'admissionCycles', 'scholarships'] as const) {
  for (const record of data[collection]) {
    const values = Object.values(record)
    if (record.status !== 'verified' || (!record.sourceIds.some(id => brokenSourceIds.has(id)) && !values.some(value => typeof value === 'string' && broken.has(value)))) continue
    changes.push({ collection, id: record.id, before: { status: record.status }, after: { status: 'stale' }, reason: 'At least one directly cited official source or decision route returned confirmed HTTP 404; retain historical evidence while withholding current facts until rechecked.' })
    record.status = 'stale'
  }
}
for (const [id, officialUrl, admissionsUrl, sourceIds] of [
  ['uni-nanjing-university-of-chinese-medicine', replacements[0].url, null, [replacements[0].id, replacements[1].id]],
  ['uni-hainan-medical-university', replacements[2].url, replacements[2].url, [replacements[2].id]],
] as const) {
  const university = data.universities.find(record => record.id === id)!
  const before = { officialUrl: university.officialUrl, admissionsUrl: university.admissionsUrl, sourceIds: university.sourceIds }
  const after = { officialUrl, admissionsUrl, sourceIds: [...new Set([...university.sourceIds, ...sourceIds])] }
  if (JSON.stringify(before) === JSON.stringify(after)) continue
  Object.assign(university, after)
  changes.push({ collection: 'universities', id, before, after, reason: 'Repair the proven dead university/admissions entry points with reviewed official pages. Original profile verification dates and stale status are preserved.' })
}
bundleSchema.parse(data)
if (process.argv.includes('--apply')) {
  const names = { universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships', sources: 'sources' } as const
  for (const [collection, file] of Object.entries(names)) if (changes.some(change => change.collection === collection)) writeFileSync(`content/data/${file}.json`, `${JSON.stringify(data[collection as keyof DataBundle], null, 2)}\n`)
  if (changes.length) writeFileSync('quality/audit-2026-09-16-data-link-remediation.json', `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), changes, unresolvedOfficialUrls: [...broken], note: 'Historical dead source IDs are retained for provenance. The unresolved URL list is the original audit set, not a claim that all remain active after remediation.' }, null, 2)}\n`)
}
console.log(JSON.stringify({ apply: process.argv.includes('--apply'), changed: changes.length, quarantined: changes.filter(change => change.reason.startsWith('At least')).map(change => change.id) }, null, 2))

}

void main().catch(error => { console.error(error); process.exitCode = 1 })
