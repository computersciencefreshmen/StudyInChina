import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTodayDate } from '../../src/lib/data/freshness'
import { bundleSchema } from '../../src/lib/data/schema'
import { readAuditData } from './comprehensive-data-audit'
import type { DataBundle } from '../../src/lib/data/types'

const today = '2026-09-28'
const data = readAuditData(process.cwd())
const receipts = JSON.parse(readFileSync(`quality/audit-${today}-data-source-receipts.json`, 'utf8')) as {
  receipts: { url: string; receivedAt?: string; status?: number; sha256?: string; localSnapshot?: string }[]
}
const changes: { collection: string; id: string; reason: string; before: unknown; after: unknown }[] = []
const reviews: { url: string; receivedAt: string; sha256: string; locator: string; conclusion: string }[] = []
const reviewed = { status: 'verified' as const, verifiedAt: today, reviewAfter: '2026-10-05' }
const reviewedSoon = { ...reviewed, reviewAfter: '2026-10-01' }

function evidence(url: string, locator: string, conclusion: string) {
  const receipt = receipts.receipts.find(item => item.url === url)
  if (!receipt?.receivedAt || !receipt.localSnapshot || receipt.status !== 200) throw new Error(`Missing successful capture: ${url}`)
  if (getTodayDate(new Date(receipt.receivedAt)) !== today) throw new Error(`Capture date mismatch: ${url}`)
  const sha256 = createHash('sha256').update(readFileSync(receipt.localSnapshot)).digest('hex')
  if (sha256 !== receipt.sha256) throw new Error(`Snapshot checksum mismatch: ${url}`)
  reviews.push({ url, receivedAt: receipt.receivedAt, sha256, locator, conclusion })
}
function change<K extends keyof DataBundle>(collection: K, id: string, patch: Partial<DataBundle[K][number]>, reason: string) {
  const record = data[collection].find(item => item.id === id)
  if (!record) throw new Error(`Unknown record ${collection}:${id}`)
  const before = Object.fromEntries(Object.keys(patch).map(key => [key, (record as unknown as Record<string, unknown>)[key]]))
  if (JSON.stringify(before) === JSON.stringify(patch)) return
  Object.assign(record, patch)
  changes.push({ collection, id, reason, before, after: patch })
}
function insert<K extends keyof DataBundle>(collection: K, record: DataBundle[K][number], reason: string) {
  if (data[collection].some(item => item.id === record.id)) return
  ;(data[collection] as DataBundle[K][number][]).push(record)
  changes.push({ collection, id: record.id, reason, before: null, after: record })
}

evidence('https://studyathit.hit.edu.cn/ShortwTermPrograms/list.htm', 'III–VI: duration, fees, eligibility and application', 'Winter 28 December 2026–22 January 2027; deadline 30 November; tuition 3500/4 weeks, application fee 500, insurance 160 and accommodation 1000–1200/month/bed remain supported. Application route is apply.hit.edu.cn.')
evidence('https://oec.xmu.edu.cn/en/Program1/Chinese_Language_Programs.htm', 'Program Overview; Fees; Eligibility; Documents; Deadline', 'Spring February–June 2027, deadline 30 December 2026, tuition 13000/semester. The 400 charge is enrolment, not a separately priced application fee. Age 18–55, high-school qualification, placement and optional HSK confirmed.')
evidence('https://intl-nondegree.tsinghua.edu.cn/f/yzlxs/yz_lxs_kstzb/view?id=264627', 'Sections 1–4 and 12', 'Visiting qualifications, language thresholds, 15 October–30 November 2026 spring window, 15 March–15 May 2027 autumn window, and 400 application fee reviewed. No attachment-derived tuition is renewed.')
evidence('https://admission.blcu.edu.cn/en/2026/0303/c1148a3044/page.htm', '2.5; 3; 4 Application Procedures', 'Spring 2027 five-month award, HSK3 180 and HSKK required; October 31 deadline. Online registration explicitly starts March 1, 2026, which supports opensOn rather than inferring it from a future deadline.')
evidence('https://iso.fudan.edu.cn/_upload/article/files/ec/db/98f894064930aeeec752ae6440b4/c5ee1e57-ef19-4b80-824e-d52ce48a22b5.pdf', 'Pages 1–2: B, deadlines, application procedures and checklist', 'March 2027 one-semester Chinese language/literature, up to five months, HSK3 180 and HSKK required; deadline October 31 and explicit registration opening March 1, 2026.')
evidence('https://iie.gdufs.edu.cn/info/1087/1536.htm', '二.3; 三; 六; 附录1', 'Spring March 2027, five months, October 31 deadline; HSK3 180, HSKK, recommendation and phone interview. Central and school applications required. Tuition/accommodation/insurance and 2500 monthly allowance supported.')
evidence('https://www.oisa.shisu.edu.cn/index.php/index/newscontent/cid/39/id/666.html', '二.2.5; 三; 四; 五', 'Spring 2027 five-month study and October 31 deadline; route-specific HSK/HSKK, tuition waiver, accommodation reduction, 2500 monthly stipend and semester insurance reviewed. Process text mentions only March 1–May 15, so the spring opening remains unresolved; do not label open.')
evidence('https://lxs.szu.edu.cn/info/1169/6947.htm', 'II One-Semester; III deadlines and application; Chinese and English text', 'March 2027, October 31 deadline, five-month tuition/accommodation/insurance and 2500/month supported. HSKK is required in Chinese but preferred in English; the program remains stale.')
evidence('https://pmplatform.chinese.cn/tmp/2026/2/6/94005b2e-f2e9-438e-85e7-12212f0e9968.pdf', 'Pages 2–3 and 6–7: one semester, deadlines and benefits', 'Central March 2027 deadline is October 31, 2026; one-semester stipend 2500/month and tuition/accommodation/insurance are supported. This does not resolve the conflicting BFSU school dates.')
evidence('https://osao.bfsu.edu.cn/info/2462/6812.htm', 'II.d and deadline table', 'BFSU still conflicts internally between January and March 2027 and lists December 30 against the central October 31 deadline. Keep the cycle stale.')
const sigsUrl = 'https://www.sigs.tsinghua.edu.cn/_t195/2026/0918/c7769a293366/page.psp'
evidence(sigsUrl, 'Publication date 2026-09-18; II programme list; III application dates; VIII fee table', 'Exact existing identities mapped: doctoral 0830J2 Environmental Science and New Energy Technology and 0812J3 Data Science and Information Technology, master 085700 Green Environmental Infrastructure, master 125604 Logistics Engineering and Management. Effective immediately on September 18 until May 15, 2027 at 17:00 Beijing time. Fees independently cross-reviewed: application 800, engineering doctorates 40000/year, Green Environmental Infrastructure 62000/year, Logistics Engineering and Management 30000/year. No general engineering-master price is propagated and no old program facts are refreshed.')

// Deterministic expiry never changes original source-check timestamps.
for (const collection of ['universities', 'programs', 'admissionCycles', 'scholarships', 'cities'] as const) {
  for (const record of data[collection]) {
    if (record.status === 'verified' && record.reviewAfter < today) change(collection, record.id, { status: 'stale' }, 'Review deadline elapsed; original dates preserved.')
  }
}
for (const id of [
  'program-xmu-long-term-chinese-language-spring-2027',
  'program-blcu-iclt-one-semester-spring-2027',
  'program-tsinghua-university-visiting-student-program-other',
  'prog-gap-wave8-hit-winter-short-term-chinese-2026',
  'program-guangdong-university-of-foreign-studies-iclt-one-semester-language',
  'program-sisu-iclt-one-semester-spring-2027',
  'program-fudan-university-international-chinese-language-teachers-scholarship-one',
]) change('programs', id, reviewed, 'Existing exposed program fields compared against current official body; unrelated programs not renewed.')
for (const id of [
  'cycle-2027-shenzhen-iclt-one-semester-spring', 'cycle-blcu-iclt-one-semester-spring-2027',
  'cycle-2027-gdufs-iclt-one-semester-spring', 'cycle-sisu-iclt-one-semester-spring-2027',
  'cycle-2026-3ff111b197cd',
]) change('admissionCycles', id, reviewedSoon, 'Exact spring intake and October 31 deadline reviewed; three-day review cadence.')
for (const id of [
  'cycle-xmu-long-term-chinese-language-spring-2027', 'cycle-thu-visiting-student-spring-2027',
  'cycle-thu-visiting-student-autumn-2027', 'cycle-gap-wave8-hit-winter-short-term-chinese-2026-2026-2027-other',
]) change('admissionCycles', id, reviewed, 'Exact official future intake dates and remaining exposed cycle fields reviewed.')
for (const id of [
  'scholarship-shenzhen-university-iclt-spring-2027', 'scholarship-gdufs-iclt-one-semester-2027',
  'scholarship-sisu-iclt-one-semester-spring-2027', 'scholarship-blcu-iclt-one-semester-spring-2027',
]) change('scholarships', id, reviewedSoon, 'School-specific benefits, route and deadline reviewed; three-day cadence.')
for (const id of ['cycle-blcu-iclt-one-semester-spring-2027', 'cycle-2026-3ff111b197cd']) {
  change('admissionCycles', id, { opensOn: '2026-03-01' }, 'Official school guide explicitly opens registration on March 1, 2026 for the listed scholarship categories.')
}
change('admissionCycles', 'cycle-sisu-iclt-one-semester-spring-2027', {
  notes: {
    en: 'Spring 2027 deadline: 31 October 2026. The process section describes a March 1–May 15 registration period without a separate spring opening, so opening remains unconfirmed. Both central and SISU scholarship submissions and a school application fee are required; the fee amount is not stated.',
    zh: '2027年春季截止日为2026年10月31日。流程部分仅列3月1日至5月15日注册期，未单列春季开放日，因此开放时间仍待确认。须同时完成中央奖学金系统和上外奖学金通道申请并缴纳学校申请费；金额未说明。',
  },
}, 'Expose the unresolved spring opening instead of assuming the autumn procedure applies.')
change('scholarships', 'scholarship-blcu-iclt-one-semester-spring-2027', {
  summary: {
    en: 'Spring 2027 five-month award covering tuition, accommodation, CNY 2,500/month and medical insurance. Apply through the central scholarship system with an eligible recommending institution; the BLCU guide does not require a second university application.',
    zh: '2027年春季五个月奖学金覆盖学费、住宿、每月2500元生活费与医疗保险。须由具备资格的机构推荐并通过中央奖学金系统申请；北语简章未要求第二次校级系统申请。',
  },
}, 'Remove an ambiguous second-system instruction not required by the reviewed BLCU guide; preserve translation fallback.')

const sigsSourceId = 'src-thu-sigs-international-graduate-2027'
insert('sources', {
  id: sigsSourceId, url: sigsUrl, title: 'Tsinghua SIGS 2027 International Graduate Admissions',
  publisher: 'Tsinghua University Shenzhen International Graduate School', kind: 'admissions',
  language: 'zh', official: true, accessedAt: today,
}, 'Register a current school-specific official guide with a captured checksum receipt.')
const sigsMappings = [
  ['doctoral-program-in-environmental-science-and-new-energy-technology-doctorate', '0830J2', 40000],
  ['doctoral-program-in-data-science-and-information-technology-doctorate', '0812J3', 40000],
  ['masters-program-in-green-environmental-infrastructure-master', '085700', 62000],
  ['logistics-engineering-and-management-master', '125604', 30000],
] as const
for (const [suffix, code, tuition] of sigsMappings) {
  const programId = `program-tsinghua-university-${suffix}`
  if (!data.programs.some(item => item.id === programId)) throw new Error(`Missing exact SIGS identity: ${programId}`)
  insert('admissionCycles', {
    id: `cycle-thu-sigs-${code.toLowerCase()}-autumn-2027`, programId,
    academicYear: '2027-2028', intake: 'autumn', opensOn: '2026-09-18', closesOn: '2027-05-15',
    dateStatus: 'published', tuitionCny: tuition, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed',
    evidenceBasis: 'cycle-specific', factScope: 'partial', applicationFeeCny: 800,
    notes: {
      en: `Shenzhen campus; official programme code ${code}. Applications close at 17:00 Beijing time on 15 May 2027. Opening date follows the notice's "effective immediately" wording and its 18 September 2026 publication date. Scholarship applicants are advised to apply before December 2026; this is not a separate guaranteed scholarship deadline. Programme-specific language and eligibility requirements must be confirmed in the official catalogue; old profile facts have not been renewed.`,
      zh: `深圳校区，官方专业代码${code}。申请于2027年5月15日北京时间17:00截止。开放日依据2026年9月18日发布的简章“即日起”表述。奖学金申请者宜于2026年12月前申请，这并非另行保证的奖学金截止日。具体语言及资格条件须核对官方专业目录，旧项目资料未随新周期续期。`,
    },
    sourceIds: [sigsSourceId], ...reviewed,
  }, `Exact SIGS programme identity ${code} mapped to the current official programme and fee tables.`)
}
const reviewedUrls = new Set(reviews.map(item => item.url))
for (const source of data.sources) {
  if (reviewedUrls.has(source.url)) change('sources', source.id, { accessedAt: today }, 'This exact official URL was captured and its relevant body reviewed; dependent records do not auto-renew.')
}
bundleSchema.parse(data)
const files = { universities: 'universities', programs: 'programs', scholarships: 'scholarships', admissionCycles: 'admission-cycles', cities: 'cities', sources: 'sources' } as const
if (process.argv.includes('--apply')) {
  if (getTodayDate() !== today) throw new Error('Dated importer cannot refresh records on another date; capture and review new evidence.')
  for (const [collection, file] of Object.entries(files)) {
    if (changes.some(item => item.collection === collection)) writeFileSync(resolve('content/data', `${file}.json`), `${JSON.stringify(data[collection as keyof DataBundle], null, 2)}\n`)
  }
  if (changes.length) {
    const baseline = JSON.parse(readFileSync(`quality/audit-${today}-data.before.json`, 'utf8')) as { records: { collection: string; id: string; findings: { code: string }[] }[] }
    writeFileSync(`quality/audit-${today}-data-changes.json`, `${JSON.stringify({ schemaVersion: 1, evaluatedForDate: today, generatedAt: new Date().toISOString(), officialReviews: reviews, staleRollover: baseline.records.filter(item => item.findings.some(finding => finding.code === 'verified_overdue')).map(item => ({ collection: item.collection, id: item.id, before: 'verified', after: 'stale', datesPreserved: true })), changes, unresolved: ['BFSU contradictory deadline/intake remains stale.', 'SZU HSKK Chinese/English mismatch remains stale.', 'SISU spring opening remains unconfirmed.', 'The cycle schema stores calendar dates; the SIGS 17:00 cutoff is preserved prominently in notes.', 'Other university 2027 guides require precise programme-level reconciliation before publication.'] }, null, 2)}\n`)
  }
}
console.log(JSON.stringify({ apply: process.argv.includes('--apply'), officialSourceReviews: reviews.length, changes: changes.length, byCollection: Object.fromEntries(Object.keys(files).map(key => [key, changes.filter(item => item.collection === key).length])) }, null, 2))
