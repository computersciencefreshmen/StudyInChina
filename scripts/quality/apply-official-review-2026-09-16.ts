import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTodayDate } from '../../src/lib/data/freshness'
import { bundleSchema } from '../../src/lib/data/schema'
import { readAuditData } from './comprehensive-data-audit'
import type { DataBundle } from '../../src/lib/data/types'

const today = '2026-09-16'
const receipts = JSON.parse(readFileSync('quality/audit-2026-09-16-data-source-receipts.json', 'utf8')) as {
  receipts: { url: string; receivedAt?: string; status?: number; sha256?: string; localSnapshot?: string }[]
}
const data = readAuditData(process.cwd())
const changes: { collection: string; id: string; reason: string; before: unknown; after: unknown }[] = []
const reviews: { url: string; sha256: string; receivedAt: string; locator: string; conclusion: string; independentReview?: string }[] = []

function evidence(url: string, locator: string, conclusion: string, independentReview?: string) {
  const receipt = receipts.receipts.find(receipt => receipt.url === url)
  if (!receipt?.localSnapshot || !receipt.receivedAt || receipt.status !== 200) throw new Error(`Missing successful capture: ${url}`)
  if (getTodayDate(new Date(receipt.receivedAt)) !== today) throw new Error(`Capture was not performed on ${today}: ${url}`)
  const sha256 = createHash('sha256').update(readFileSync(receipt.localSnapshot)).digest('hex')
  if (sha256 !== receipt.sha256) throw new Error(`Snapshot checksum mismatch: ${url}`)
  reviews.push({ url, sha256, receivedAt: receipt.receivedAt, locator, conclusion, ...(independentReview ? { independentReview } : {}) })
}
function change<K extends keyof DataBundle>(collection: K, id: string, patch: Partial<DataBundle[K][number]>, reason: string) {
  const record = data[collection].find(record => record.id === id)
  if (!record) throw new Error(`Missing expected ${collection} record: ${id}`)
  const before = Object.fromEntries(Object.keys(patch).map(key => [key, (record as unknown as Record<string, unknown>)[key]]))
  if (JSON.stringify(before) === JSON.stringify(patch)) return
  Object.assign(record, patch)
  changes.push({ collection, id, reason, before, after: patch })
}
const reviewed = { verifiedAt: today, reviewAfter: '2026-09-23', status: 'verified' as const }
const reviewedDeadlineSoon = { ...reviewed, reviewAfter: '2026-09-19' }

evidence('https://studyathit.hit.edu.cn/ShortwTermPrograms/list.htm', 'III Program Duration; IV Fees; V Eligibility; VI Application Process', 'Winter end is 2027-01-22, application fee is CNY 500 and accommodation is CNY 1,000–1,200/month/bed. Tuition remains CNY 3,500/4 weeks; deadline remains 2026-11-30. The page does not substantiate the old blanket non-refundability claim.', 'Root agent separately opened the official page and independently confirmed all changed amounts and dates.')
evidence('https://lxs.szu.edu.cn/info/1169/6947.htm', 'II One-Semester Program; III Application Procedures and Deadlines', 'Spring 2027 deadline 2026-10-31, five-month award, tuition/accommodation/insurance and CNY 2,500 monthly stipend confirmed. Chinese HSKK requirement and English preference wording differ, so the program requirements remain stale.')
evidence('https://oec.xmu.edu.cn/en/Program1/Chinese_Language_Programs.htm', 'Program Overview; Fees; Eligibility; Application Procedure; Application Deadline', 'Spring study February–June 2027; deadline 2026-12-30; tuition CNY 13,000/semester. CNY 400 is labelled an enrolment fee, so it is not represented as a confirmed application fee.')
evidence('https://admission.blcu.edu.cn/en/2026/0303/c1148a3044/page.htm', '2.5 One-Semester Study; 3 Coverage; 4 Application Procedures', 'Spring 2027 five-month study and 2026-10-31 deadline confirmed. HSK 3 score 180 and HSKK report required. Teaching language and application-fee amount are not explicitly published.')
evidence('https://intl-nondegree.tsinghua.edu.cn/f/yzlxs/yz_lxs_kstzb/view?id=264627', '2 Qualifications; 3 Application Schedule; 4 Documents; 12 Costs', 'Spring 2027 window 2026-10-15 to 2026-11-30, autumn window 2027-03-15 to 2027-05-15 and CNY 400 application fee confirmed. Detailed tuition amounts in the unreviewed attachment are withheld.')
evidence('https://iie.gdufs.edu.cn/info/1087/1536.htm', '二.3 一学期研修生; 三 办理流程; 附录1', '2027-03 intake, five months, 2026-10-31 deadline and scholarship benefits confirmed. Both central and school submissions plus a telephone interview are required.')
evidence('https://www.oisa.shisu.edu.cn/index.php/index/newscontent/cid/39/id/666.html', '二.2.5; 三 资助内容; 四 截止日期; 五 申请流程', 'Spring deadline 2026-10-31, five-month term, CNY 2,500/month, tuition waiver and accommodation reduction confirmed. School-system submission and a fee are required, but the fee amount is not stated.')
evidence('https://iso.fudan.edu.cn/_upload/article/files/ec/db/98f894064930aeeec752ae6440b4/c5ee1e57-ef19-4b80-824e-d52ce48a22b5.pdf', 'PDF page 1: section B and Application Deadlines; page 2: Application Checklist', 'One-semester Chinese language/literature award admits March 2027, five-month maximum, HSK 3 score 180 and HSKK report; deadline 2026-10-31.')
evidence('https://pmplatform.chinese.cn/tmp/2026/2/6/94005b2e-f2e9-438e-85e7-12212f0e9968.pdf', 'PDF page 3: application deadlines; page 6: attachment 1', 'CLEC states 2026-10-31 for March 2027 applicants and CNY 2,500/month for one-semester scholars. This conflicts with the BFSU page deadline of 2026-12-30.')
evidence('https://osao.bfsu.edu.cn/info/2462/6812.htm', 'II.d One-Semester; application deadlines table', 'The page conflicts internally on January versus March entry, and its 2026-12-30 deadline disagrees with the cited CLEC deadline. No deadline is promoted as current.')

// Expiry is deterministic maintenance, not a claim that 792 sources were checked.
for (const collection of ['universities', 'programs', 'scholarships', 'admissionCycles', 'cities'] as const) {
  for (const record of data[collection]) {
    if (record.status === 'verified' && record.reviewAfter < today) change(collection, record.id, { status: 'stale' }, 'Review deadline elapsed; original verification and review dates preserved.')
  }
}

const programIds = [
  'program-xmu-long-term-chinese-language-spring-2027',
  'program-blcu-iclt-one-semester-spring-2027',
  'program-tsinghua-university-visiting-student-program-other',
  'prog-gap-wave8-hit-winter-short-term-chinese-2026',
  'program-guangdong-university-of-foreign-studies-iclt-one-semester-language',
  'program-sisu-iclt-one-semester-spring-2027',
  'program-fudan-university-international-chinese-language-teachers-scholarship-one',
]
for (const id of programIds) change('programs', id, reviewed, 'Program fields individually reviewed against the captured official guide; no other programs renewed.')
for (const id of [
  'cycle-2027-shenzhen-iclt-one-semester-spring', 'cycle-blcu-iclt-one-semester-spring-2027',
  'cycle-2027-gdufs-iclt-one-semester-spring', 'cycle-sisu-iclt-one-semester-spring-2027',
  'cycle-2026-3ff111b197cd',
]) change('admissionCycles', id, reviewedDeadlineSoon, 'Existing October 31 deadline checked against the precise official spring intake; three-day review cadence.')
for (const id of [
  'cycle-xmu-long-term-chinese-language-spring-2027',
  'cycle-thu-visiting-student-spring-2027', 'cycle-thu-visiting-student-autumn-2027',
  'cycle-gap-wave8-hit-winter-short-term-chinese-2026-2026-2027-other',
]) change('admissionCycles', id, reviewed, 'Existing future application dates and remaining published fields checked against the exact official intake.')
for (const id of ['scholarship-shenzhen-university-iclt-spring-2027', 'scholarship-gdufs-iclt-one-semester-2027', 'scholarship-sisu-iclt-one-semester-spring-2027', 'scholarship-blcu-iclt-one-semester-spring-2027']) change('scholarships', id, reviewedDeadlineSoon, 'Benefits and deadline independently checked on the exact school route and applicable provider standard.')

change('programs', 'prog-gap-wave8-hit-winter-short-term-chinese-2026', { applyUrl: 'https://apply.hit.edu.cn/' }, 'Use the application system explicitly named in the program application procedure.')
change('admissionCycles', 'cycle-gap-wave8-hit-winter-short-term-chinese-2026-2026-2027-other', {
  applicationFeeCny: 500,
  notes: {
    en: 'Winter study runs from 28 December 2026 to 22 January 2027. Insurance is CNY 160. Accommodation is CNY 1,000–1,200 per month per bed, including utilities; availability is limited. The current page does not state a blanket refund policy. Evidence: Program Duration; Fees; Application Process.',
    zh: '冬季课程为2026年12月28日至2027年1月22日。保险费160元；住宿1000—1200元/月/床，包含水电，床位有限。当前页面未说明统一退款政策。证据定位：项目时间、费用、申请流程。',
  },
}, 'Correct changed application fee, study end date and accommodation; remove unsupported refund wording in every prior translation.')
change('admissionCycles', 'cycle-xmu-long-term-chinese-language-spring-2027', {
  applicationFeeCny: null, factScope: 'partial',
  notes: {
    en: 'Spring study runs from February to June 2027. The official guide labels CNY 400 as a non-refundable new-student enrolment fee; it does not separately price the application fee. On-campus accommodation is not provided. HSK is submitted if available.',
    zh: '学习期为2027年2月至6月。官网将400元列为新生入学注册费且不退，未单独给出申请费金额。项目不提供校内住宿；已有HSK证书者提交。',
  },
}, 'Separate the official enrolment charge from an unconfirmed application fee instead of relabelling it.')
for (const id of ['cycle-thu-visiting-student-spring-2027', 'cycle-thu-visiting-student-autumn-2027']) change('admissionCycles', id, {
  notes: {
    en: 'The current admissions page confirms the application window and application fee. Tuition depends on visitor category and discipline; the linked fee attachment was not reverified in this audit, so no category-specific price is presented as current. CSC holders use the separate 15 March–30 April 2027 window.',
    zh: '本轮已核验招生网页中的申请窗口和申请费。学费按访问类别与学科区分；本轮未重新核验费用附件，因此不将其中分类金额展示为当前学费。CSC持有者另按2027年3月15日至4月30日窗口申请。',
  },
}, 'Prevent stale attachment-derived tuition figures from resurfacing when a date-only source is rechecked.')
const gdufs = data.programs.find(record => record.id === 'program-guangdong-university-of-foreign-studies-iclt-one-semester-language')!
change('programs', gdufs.id, { languageRequirements: [
  ...gdufs.languageRequirements.filter(requirement => !requirement.minimum?.includes('telephone interview')),
  { test: 'other', minimum: 'The university telephone interview is required.' },
] }, 'Fill the school-specific telephone interview requirement stated in section 二.3.')
change('scholarships', 'scholarship-blcu-iclt-one-semester-spring-2027', {
  name: { ...data.scholarships.find(record => record.id === 'scholarship-blcu-iclt-one-semester-spring-2027')!.name, en: 'International Chinese Language Teachers Scholarship at Beijing Language and Culture University — Spring 2027' },
}, 'Use the official university English name.')
change('admissionCycles', 'cycle-bfsu-iclt-one-semester-spring-2027', {
  status: 'stale',
  notes: {
    en: 'Source conflict reviewed on 2026-09-16: the BFSU table gives 30 December 2026, whereas the cited CLEC 2026 guide gives 31 October 2026 for March 2027 entry. The BFSU page also conflicts internally on January versus March entry. Deadline and intake details remain unavailable pending official clarification; historical values are retained only for audit.',
    zh: '2026年9月16日复核发现来源冲突：北外表格列2026年12月30日，所引语合中心2026办法对2027年3月入学列2026年10月31日；北外页面还存在1月与3月开学的内部冲突。截止日及入学细节等待官方澄清，旧值仅留作审计。',
  },
}, 'Do not select the later deadline when two cited official sources disagree.')

const checkedUrls = new Set(reviews.map(review => review.url))
for (const source of data.sources) if (checkedUrls.has(source.url)) change('sources', source.id, { accessedAt: today }, 'This exact source URL was opened and its official content checked; dependent records are not automatically renewed.')

bundleSchema.parse(data)
const fileNames = { universities: 'universities', programs: 'programs', scholarships: 'scholarships', admissionCycles: 'admission-cycles', cities: 'cities', sources: 'sources' } as const
if (process.argv.includes('--apply')) {
  if (getTodayDate() !== today) throw new Error('This dated evidence importer cannot renew records on a different day; perform a new source review.')
  for (const [collection, file] of Object.entries(fileNames)) {
    if (changes.some(change => change.collection === collection)) writeFileSync(resolve('content/data', `${file}.json`), `${JSON.stringify(data[collection as keyof DataBundle], null, 2)}\n`)
  }
  if (changes.length) writeFileSync('quality/audit-2026-09-16-data-changes.json', `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), evaluatedForDate: today, officialReviews: reviews, changes, unresolved: ['SZU Chinese and English HSKK instructions disagree; program remains stale.', 'BFSU deadline and start month conflict; cycle remains stale.', 'Remaining records need independent source review; no bulk verification date changes were made.'] }, null, 2)}\n`)
}
console.log(JSON.stringify({ apply: process.argv.includes('--apply'), officialSourceReviews: reviews.length, changes: changes.length, byCollection: Object.fromEntries(Object.keys(fileNames).map(key => [key, changes.filter(change => change.collection === key).length])) }, null, 2))
