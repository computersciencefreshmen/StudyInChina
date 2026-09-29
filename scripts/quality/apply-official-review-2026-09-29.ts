import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTodayDate } from '../../src/lib/data/freshness'
import { bundleSchema } from '../../src/lib/data/schema'
import { readAuditData } from './comprehensive-data-audit'
import type { DataBundle } from '../../src/lib/data/types'

const today = '2026-09-29'
const data = readAuditData(process.cwd())
const receipts = JSON.parse(readFileSync(`quality/audit-${today}-data-source-receipts.json`, 'utf8')) as {
  receipts: { url: string; receivedAt?: string; status?: number; sha256?: string; localSnapshot?: string }[]
}
const changes: { collection: string; id: string; before: unknown; after: unknown; reason: string }[] = []
const reviews: { url: string; receivedAt: string; sha256: string; locator: string; conclusion: string }[] = []
function evidence(url: string, locator: string, conclusion: string) {
  const receipt = receipts.receipts.find(item => item.url === url)
  if (!receipt?.receivedAt || !receipt.localSnapshot || receipt.status !== 200) throw new Error(`Missing capture: ${url}`)
  if (getTodayDate(new Date(receipt.receivedAt)) !== today) throw new Error(`Capture date mismatch: ${url}`)
  const sha256 = createHash('sha256').update(readFileSync(receipt.localSnapshot)).digest('hex')
  if (sha256 !== receipt.sha256) throw new Error(`Checksum mismatch: ${url}`)
  reviews.push({ url, receivedAt: receipt.receivedAt, sha256, locator, conclusion })
}
function change<K extends keyof DataBundle>(collection: K, id: string, patch: Partial<DataBundle[K][number]>, reason: string) {
  const record = data[collection].find(item => item.id === id)
  if (!record) throw new Error(`Missing ${collection}:${id}`)
  const before = Object.fromEntries(Object.keys(patch).map(key => [key, (record as unknown as Record<string, unknown>)[key]]))
  if (JSON.stringify(before) === JSON.stringify(patch)) return
  Object.assign(record, patch)
  changes.push({ collection, id, before, after: patch, reason })
}
function insert<K extends keyof DataBundle>(collection: K, record: DataBundle[K][number], reason: string) {
  if (data[collection].some(item => item.id === record.id)) return
  ;(data[collection] as DataBundle[K][number][]).push(record)
  changes.push({ collection, id: record.id, before: null, after: record, reason })
}
const tjuUrl = 'https://sie.tju.edu.cn/en/xwxm/FOUNDATIONPROGRAM/202609/t20260920_324704.html'
const hainanUrl = 'https://muhn.edu.cn/gjxy/info/1432/30314.htm'
evidence(tjuUrl, 'III–VI and VIII; Program 2 in duration and fee tables', 'The exact one-year foundation route has a 15 March–15 July 2027 application window and September 2027 entry; 28900 tuition for the one-year programme, 500 application fee, HSK3 or at least one year of Chinese study. The separate spring one-semester route is not merged into this identity.')
evidence(hainanUrl, 'I Clinical Medicine; II application method; VI scholarship application', 'Current official 2026 page names Chinese-taught five-year Clinical Medicine and the ASEAN/Hainan scholarships, and supplies application instructions. Only dead discovery/instruction links are replaced; fees, dates and requirements are not renewed.')
evidence('https://www.bipt.edu.cn/pub/gjjl/gg/6ae59c2994f14fec8828e3cc0ae496c4.htm', 'IV forms and contact; online-application navigation', 'Current 2026 guide supplies forms and admissions contact but does not establish a working replacement for the stored 404 online-application page. Clear three dead application URLs; keep stale records and original provenance.')
evidence('https://lxs.sicnu.edu.cn/p/30/?StId=st_app_news_i_x639081519364042574', 'IV Application Procedures', 'The current 2026 SICNU guide still directs to cis.chinese.cn, whose root returned confirmed HTTP404 in the full audit. Clear two dead application URLs; do not guess a replacement login path or renew old facts.')

for (const collection of ['universities', 'programs', 'admissionCycles', 'scholarships', 'cities'] as const) {
  for (const record of data[collection]) if (record.status === 'verified' && record.reviewAfter < today) change(collection, record.id, { status: 'stale' }, 'Daily expiry; original evidence dates preserved.')
}
for (const id of ['prog-gap-wave7-bipt-biological-pharmacy-bachelor', 'prog-gap-wave7-bipt-chinese-language-program', 'prog-gap-wave7-bipt-robotics-engineering-bachelor', 'prog-gap-wave8-sicnu-international-chinese-education-doctorate', 'prog-gap-wave8-sicnu-international-chinese-education-master']) {
  change('programs', id, { applyUrl: null }, 'Stored application URL has confirmed HTTP404; no verified replacement portal, so keep unknown.')
}
for (const [id, url, title, publisher, language] of [
  ['src-tju-foundation-2027-review', tjuUrl, 'Admission to Foundation Program of Tianjin University 2027', 'Tianjin University School of International Education', 'en'],
  ['src-hainan-degree-2026-review', hainanUrl, 'Hainan Medical University International Student Degree Program Admission Brochure 2026', 'Hainan Medical University', 'zh'],
] as const) insert('sources', { id, url, title, publisher, language, kind: 'program', official: true, accessedAt: today }, 'New official source ID; historical source and URL preserved.')
const hainanProgram = data.programs.find(item => item.id === 'prog-gap-local-strong-muhn-b-clinical-medicine-cn')!
change('programs', hainanProgram.id, { programUrl: hainanUrl, sourceIds: [...new Set([...hainanProgram.sourceIds, 'src-hainan-degree-2026-review'])] }, 'Replace missing programme page with exact current Clinical Medicine admission guide; keep stale status and dates.')
for (const id of ['sch-gap-local-strong-muhn-asean-scholarship', 'sch-gap-local-strong-muhn-hainan-government-scholarship']) {
  const record = data.scholarships.find(item => item.id === id)!
  change('scholarships', id, { applicationUrl: hainanUrl, sourceIds: [...new Set([...record.sourceIds, 'src-hainan-degree-2026-review'])] }, 'Replace dead instructions with the official guide section VI; scholarship facts remain stale.')
}
const tjuId = 'prog-gap-breadth-tju-foundation-one-year'
const tju = data.programs.find(item => item.id === tjuId)!
const reviewed = { status: 'verified' as const, verifiedAt: today, reviewAfter: '2026-10-06' }
change('programs', tjuId, {
  ...reviewed, programUrl: tjuUrl, sourceIds: [...new Set([...tju.sourceIds, 'src-tju-foundation-2027-review'])],
  durationMonths: 12, teachingLanguages: [], applyUrl: 'https://tju.at0086.cn/StuApplication/Login.aspx',
  languageRequirements: [{ test: 'other', minimum: 'HSK Level 3 or above, or a certificate of at least one year of Chinese learning, for the one-year foundation route.' }],
}, 'Reconcile all stored one-year-route fields against Program 2; teaching language remains unconfirmed.')
insert('admissionCycles', {
  id: 'cycle-tju-foundation-one-year-autumn-2027', programId: tjuId, academicYear: '2027-2028', intake: 'autumn',
  opensOn: '2027-03-15', closesOn: '2027-07-15', dateStatus: 'published', tuitionCny: 28900,
  tuitionPeriod: 'program', tuitionStatus: 'confirmed', applicationFeeCny: 500,
  evidenceBasis: 'cycle-specific', factScope: 'complete', sourceIds: ['src-tju-foundation-2027-review'], ...reviewed,
  notes: {
    en: 'One-year foundation route (Program 2), entering September 2027. Application and tuition fees are paid after admission. Medical insurance is CNY 400 per semester; accommodation is CNY 15–60 per bed per day. The separate spring one-semester route has different dates, tuition and language requirements.',
    zh: '一学年预科路线（项目2），2027年9月入学。申请费与学费在录取后缴纳。医疗保险每学期400元，住宿每床每天15—60元。春季一学期路线的日期、学费和语言要求不同。',
  },
}, 'Publish a new exact 2027 autumn cycle from the official Program 2 table; never roll a historical cycle forward.')
bundleSchema.parse(data)
const files = { universities: 'universities', programs: 'programs', scholarships: 'scholarships', admissionCycles: 'admission-cycles', cities: 'cities', sources: 'sources' } as const
if (process.argv.includes('--apply')) {
  if (getTodayDate() !== today) throw new Error('Dated importer requires a new evidence review on another day.')
  for (const [collection, file] of Object.entries(files)) if (changes.some(item => item.collection === collection)) writeFileSync(resolve('content/data', `${file}.json`), `${JSON.stringify(data[collection as keyof DataBundle], null, 2)}\n`)
  if (changes.length) writeFileSync(`quality/audit-${today}-data-changes.json`, `${JSON.stringify({ schemaVersion: 1, evaluatedForDate: today, generatedAt: new Date().toISOString(), officialReviews: reviews, changes }, null, 2)}\n`)
}
console.log(JSON.stringify({ apply: process.argv.includes('--apply'), officialReviews: reviews.length, changes: changes.length }, null, 2))
