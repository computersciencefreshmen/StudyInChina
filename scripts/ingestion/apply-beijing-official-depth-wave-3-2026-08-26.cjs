const fs = require('node:fs')
const path = require('node:path')

const checkedAt = '2026-08-26'
const urgentReviewAfter = '2026-08-29'
const weeklyReviewAfter = '2026-09-02'
const dataDir = process.env.STUDYINCHINA_DATA_DIR
  ? path.resolve(process.env.STUDYINCHINA_DATA_DIR)
  : path.join(process.cwd(), 'content', 'data')

const read = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'))
const write = (name, value) => fs.writeFileSync(
  path.join(dataDir, name),
  `${JSON.stringify(value, null, 2)}\n`,
  'utf8',
)
const localized = (en, zh) => ({ en, zh })

function upsertById(items, addition, preserveIdentity = false) {
  const index = items.findIndex((item) => item.id === addition.id)
  if (index === -1) {
    items.push(addition)
    return
  }

  const existing = items[index]
  items[index] = preserveIdentity
    ? { ...existing, ...addition, id: existing.id, slug: existing.slug }
    : { ...existing, ...addition, id: existing.id }
}

const thuChineseProgramId = 'program-tsinghua-university-chinese-language-program-language'
const thuVisitingProgramId = 'program-tsinghua-university-visiting-student-program-other'
const unsupportedBusinessProgramId = 'program-tsinghua-university-business-administration-master'

const thuChineseProgramUrl = 'https://intl-nondegree.tsinghua.edu.cn/f/yzlxs/yz_lxs_kstzb/view?id=254607'
const thuChineseGuidePdfUrl = 'https://intl-nondegree.tsinghua.edu.cn/b/yzlxs/yz_sys_xxfjb/download/file?id=531455'
const thuVisitingProgramUrl = 'https://intl-nondegree.tsinghua.edu.cn/f/yzlxs/yz_lxs_kstzb/view?id=264627'
const thuVisitingFeesPdfUrl = 'https://intl-nondegree.tsinghua.edu.cn/b/yzlxs/yz_sys_xxfjb/download/file?id=504171'
const thuNonDegreeApplicationUrl = 'https://intl-nondegree.tsinghua.edu.cn/f/login'
const thuGraduateProgramsUrl = 'https://yz.tsinghua.edu.cn/en/Programs/Graduate_Programs_in_English.htm'
const thuGraduateGuideUrl = 'https://yz.tsinghua.edu.cn/en/info/1035/1523.htm'
const thuGraduateTuitionUrl = 'https://yzbm.tsinghua.edu.cn/publish/s05/s0501/detail/dae20f4e-6f7a-42ee-9dad-24597411b6a4'
const pkuGraduateTuitionUrl = 'https://isd.pku.edu.cn/userfiles/editor/202510201755264616.pdf'

const sourceSpecs = [
  {
    id: 'src-thu-chinese-language-program-current',
    url: thuChineseProgramUrl,
    title: 'Admission to Chinese Language Program in THU — Spring 2027',
    publisher: 'Tsinghua University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'source-thu-clp-spring-2027-guide-pdf',
    url: thuChineseGuidePdfUrl,
    title: 'Introduction to CLP and Application Guide — Spring 2027',
    publisher: 'Tsinghua University',
    kind: 'admissions',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-thu-visiting-student-current',
    url: thuVisitingProgramUrl,
    title: 'Admission to Visiting Student Program of Tsinghua University 2027',
    publisher: 'Tsinghua University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'source-thu-visiting-fees-schedule',
    url: thuVisitingFeesPdfUrl,
    title: 'Tsinghua University International Non-Degree Programs Fees Schedule',
    publisher: 'Tsinghua University',
    kind: 'admissions',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-thu-graduate-programs-in-english-current',
    url: thuGraduateProgramsUrl,
    title: 'Graduate Programs in English',
    publisher: 'Tsinghua University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'source-thu-2026-international-graduate-admissions',
    url: thuGraduateGuideUrl,
    title: 'Admission to Graduate Programs of Tsinghua University 2026 (For International Students)',
    publisher: 'Tsinghua University',
    kind: 'admissions',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'source-thu-2026-international-graduate-tuition',
    url: thuGraduateTuitionUrl,
    title: 'Tuition Fees of Graduate Programs for International Students 2026',
    publisher: 'Tsinghua University',
    kind: 'admissions',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'source-pku-2026-international-graduate-tuition',
    url: pkuGraduateTuitionUrl,
    title: 'Tuition Fees of Graduate Programs for International Students 2026',
    publisher: 'Peking University',
    kind: 'admissions',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-gap-program-pku-depth-cs-master-english',
    url: 'https://www.isd.pku.edu.cn/en/detail.php?id=739',
    title: '2026 Application Guide for International Graduate Students in Computer Science at Peking University',
    publisher: 'Peking University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-gap-program-pku-depth-impa-cppic-master',
    url: 'https://www.isd.pku.edu.cn/en/detail.php?id=761',
    title: 'International Master of Public Administration Program at School of Government (2026 Entry)',
    publisher: 'Peking University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-gap-program-pku-depth-llm-chinese-law',
    url: 'https://www.isd.pku.edu.cn/en/detail.php?id=749',
    title: 'The Master of Laws (LL.M.) Program in Chinese Law at Peking University for 2026 Entry',
    publisher: 'Peking University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
]

const chineseLanguageRequirements = [{
  test: 'other',
  minimum: 'Placement is generally equivalent to HSK 3 or below for elementary, HSK 4–5 for intermediate, and HSK 5–6 for advanced classes; the official guide does not state a universal minimum HSK score.',
}]

const visitingLanguageRequirements = [
  { test: 'HSK', minimum: 'Level 5, score 210 for humanities and social-science disciplines' },
  { test: 'HSK', minimum: 'Level 5, score 180 for the Modern Chinese major' },
  { test: 'TOEFL', minimum: '90 for applicants from non-native English-speaking countries taking English-taught courses' },
  { test: 'IELTS', minimum: '6.5 for applicants from non-native English-speaking countries taking English-taught courses' },
]

const programSpecs = [
  {
    id: thuChineseProgramId,
    teachingLanguages: ['English', 'Chinese'],
    durationMonths: 4,
    durationMonthsMax: null,
    programUrl: thuChineseProgramUrl,
    applyUrl: thuNonDegreeApplicationUrl,
    languageRequirements: chineseLanguageRequirements,
    verificationScope: 'complete',
    details: {
      faculty: localized('Chinese Language Program, Non-degree Programs, Academic Affairs Office', '清华大学非学位项目汉语进修项目'),
      overview: localized('A semester-based Chinese-language program of approximately 18 weeks and 16 class units per week.', '按学期组织的汉语进修项目，每学期约18周、每周16课时。'),
      qualification: localized('Applicants must be foreign citizens aged 20–55 and be studying for, or already hold, a bachelor-equivalent degree.', '申请人须为20至55岁的外国公民，正在攻读或已经取得学士学位或同等学历。'),
      studyMode: 'full-time',
      languagePolicy: localized('Elementary classes are taught in English; intermediate and advanced classes are taught in Chinese.', '初级班使用英语授课，中级和高级班使用汉语授课。'),
      curriculumHighlights: [
        localized('Elementary, intermediate and advanced placement levels.', '设置初级、中级和高级三个层级。'),
        localized('Approximately 18 weeks and 16 class units per week.', '每学期约18周，每周约16课时。'),
      ],
      eligibility: [
        localized('Foreign citizen aged 20–55.', '20至55岁的外国公民。'),
        localized('Currently following a bachelor-equivalent program or already holding a bachelor-equivalent degree.', '正在攻读或已经取得学士学位或同等学历。'),
        localized('Good moral character and health, with willingness to follow Chinese laws and university rules.', '品行良好、身体健康，并遵守中国法律和学校规定。'),
      ],
      applicationMaterials: [
        localized('Passport information page and compliant ID photo.', '护照信息页和符合要求的证件照。'),
        localized('Official transcript and highest diploma or certificate of enrolment.', '正式成绩单以及最高学历证书或在读证明。'),
        localized('A 500–1,000 word personal statement and study plan in Chinese or English.', '500至1,000字的中英文个人陈述及学习计划。'),
      ],
      campus: localized('Tsinghua University, Beijing', '清华大学北京校区'),
    },
    sourceIds: ['src-thu-chinese-language-program-current', 'source-thu-clp-spring-2027-guide-pdf'],
    verifiedAt: checkedAt,
    reviewAfter: urgentReviewAfter,
    status: 'verified',
  },
  {
    id: thuVisitingProgramId,
    teachingLanguages: ['Chinese', 'English'],
    durationMonths: 5,
    durationMonthsMax: 24,
    programUrl: thuVisitingProgramUrl,
    applyUrl: thuNonDegreeApplicationUrl,
    languageRequirements: visitingLanguageRequirements,
    verificationScope: 'complete',
    details: {
      faculty: localized('Non-Degree Education Office', '非学位教育办公室'),
      overview: localized('A general or senior visiting-student route lasting from one semester to two years, including exchange and free-mover study.', '普通或高级访问学生项目，学制从一学期至两年，包含校际交换和个人申请路线。'),
      qualification: localized('General visitors must normally be at least second-year university students and no older than 45; senior visitors must be current PhD students, PhD candidates or PhD holders and are normally no older than 50.', '普通访问学生通常须达到大学二年级及以上且不超过45岁；高级访问学生须为在读博士、博士候选人或博士学位持有者，通常不超过50岁。'),
      studyMode: 'full-time',
      languagePolicy: localized('Chinese-taught routes use route-specific HSK 5 thresholds; non-native English speakers taking English-taught courses need TOEFL 90 or IELTS 6.5.', '中文路线按学科采用不同的HSK五级分数要求；非英语母语者修读英文课程须达到托福90或雅思6.5。'),
      curriculumHighlights: [
        localized('Access to more than 200 English-mediated courses, subject to department confirmation.', '可选范围包括200余门英文授课课程，具体以院系确认为准。'),
        localized('Official transcripts are issued after successful completion.', '完成学习并达到要求后可获得正式成绩单。'),
      ],
      eligibility: [
        localized('Non-Chinese citizen holding a valid ordinary passport.', '持有效普通护照的非中国籍公民。'),
        localized('General route: at least second-year university standing, normally age 45 or below.', '普通访问路线：至少大学二年级，通常不超过45岁。'),
        localized('Senior route: current PhD student, PhD candidate or PhD holder, normally age 50 or below.', '高级访问路线：在读博士、博士候选人或博士学位持有者，通常不超过50岁。'),
      ],
      applicationMaterials: [
        localized('Personal statement, preceding degree or enrolment certificate, and original transcripts.', '个人陈述、前置学历或在读证明以及正式成绩单。'),
        localized('Language certificate and passport photo page.', '语言能力证明和护照照片页。'),
        localized('Senior visitors also need an acceptance letter and two academic references.', '高级访问学生还须提交接收函和两封学术推荐信。'),
      ],
      campus: localized('Tsinghua University, Beijing', '清华大学北京校区'),
    },
    sourceIds: ['src-thu-visiting-student-current', 'source-thu-visiting-fees-schedule'],
    verifiedAt: checkedAt,
    reviewAfter: weeklyReviewAfter,
    status: 'verified',
  },
]

const visitingFeeNotes = localized(
  'Tuition varies by visitor category and discipline. General visitors pay CNY 30,000/year (science/engineering), 26,000 (economics/management), 25,000 (law/journalism/humanities/social sciences), or 40,000 (arts). Senior visitors pay CNY 33,000, 30,000, 28,000, or 45,000 respectively. One semester is half the annual rate; exchange and research-cooperation students are tuition-free. No single tuition value is published for this umbrella route.',
  '学费按访问学生类别和学科分别计算。普通访问学生理工科每年30,000元、经管26,000元、法学/新闻/人文社科25,000元、艺术40,000元；高级访问学生对应为33,000元、30,000元、28,000元和45,000元。一学期按年费一半计，交换生和科研合作学生免学费；本综合项目不发布单一学费值。',
)

const currentCycleSpecs = [
  {
    id: 'cycle-thu-chinese-language-spring-2027',
    programId: thuChineseProgramId,
    academicYear: '2026-2027',
    intake: 'spring',
    opensOn: '2026-09-29',
    closesOn: '2026-11-03',
    dateStatus: 'published',
    tuitionCny: 12600,
    tuitionPeriod: 'semester',
    tuitionStatus: 'confirmed',
    evidenceBasis: 'cycle-specific',
    factScope: 'complete',
    applicationFeeCny: 400,
    notes: localized(
      'Spring 2027 applications close at 11:00 Beijing time on 3 November 2026. The semester is approximately 18 weeks. This route is entirely self-funded and offers no scholarship.',
      '2027年春季申请于2026年11月3日北京时间11:00截止，学期约18周。本路线完全自费且不提供奖学金。',
    ),
    sourceIds: ['src-thu-chinese-language-program-current', 'source-thu-clp-spring-2027-guide-pdf'],
    verifiedAt: checkedAt,
    reviewAfter: urgentReviewAfter,
    status: 'verified',
  },
  {
    id: 'cycle-thu-visiting-student-spring-2027',
    programId: thuVisitingProgramId,
    academicYear: '2026-2027',
    intake: 'spring',
    opensOn: '2026-10-15',
    closesOn: '2026-11-30',
    dateStatus: 'published',
    tuitionCny: null,
    tuitionPeriod: null,
    tuitionStatus: null,
    evidenceBasis: 'cycle-specific',
    factScope: 'partial',
    applicationFeeCny: 400,
    notes: visitingFeeNotes,
    sourceIds: ['src-thu-visiting-student-current', 'source-thu-visiting-fees-schedule'],
    verifiedAt: checkedAt,
    reviewAfter: weeklyReviewAfter,
    status: 'verified',
  },
  {
    id: 'cycle-thu-visiting-student-autumn-2027',
    programId: thuVisitingProgramId,
    academicYear: '2027-2028',
    intake: 'autumn',
    opensOn: '2027-03-15',
    closesOn: '2027-05-15',
    dateStatus: 'published',
    tuitionCny: null,
    tuitionPeriod: null,
    tuitionStatus: null,
    evidenceBasis: 'cycle-specific',
    factScope: 'partial',
    applicationFeeCny: 400,
    notes: localized(
      `${visitingFeeNotes.en} CSC scholarship holders use the separately published 15 March–30 April 2027 window.`,
      `${visitingFeeNotes.zh} CSC奖学金持有者另按2027年3月15日至4月30日的窗口申请。`,
    ),
    sourceIds: ['src-thu-visiting-student-current', 'source-thu-visiting-fees-schedule'],
    verifiedAt: checkedAt,
    reviewAfter: weeklyReviewAfter,
    status: 'verified',
  },
]

function historicalFeeCycle({
  id,
  programId,
  tuitionCny,
  tuitionPeriod,
  applicationFeeCny,
  sourceIds,
  note,
}) {
  return {
    id,
    programId,
    academicYear: '2026-2027',
    intake: 'autumn',
    opensOn: null,
    closesOn: null,
    dateStatus: 'previous-cycle-reference',
    tuitionCny,
    tuitionPeriod: tuitionCny === null ? null : tuitionPeriod,
    tuitionStatus: tuitionCny === null ? null : 'reference',
    evidenceBasis: 'cycle-specific',
    factScope: 'partial',
    applicationFeeCny,
    notes: localized(
      `Historical 2026 intake reference only. ${note} No 2027 application date or fee is inferred.`,
      `仅作为2026年入学历史参考。${note} 未推断任何2027年申请日期或费用。`,
    ),
    sourceIds,
    verifiedAt: checkedAt,
    reviewAfter: checkedAt,
    status: 'stale',
  }
}

const thuHistoricalSources = [
  'source-thu-2026-international-graduate-tuition',
  'source-thu-2026-international-graduate-admissions',
]
const pkuTuitionSource = 'source-pku-2026-international-graduate-tuition'

const historicalCycleSpecs = [
  historicalFeeCycle({ id: 'cycle-thu-architecture-2026-2027-autumn-fee-reference', programId: 'program-tsinghua-university-masters-program-in-architecture-master', tuitionCny: 120000, tuitionPeriod: 'program', applicationFeeCny: 800, sourceIds: thuHistoricalSources, note: 'The official table gives CNY 80,000 for year one and CNY 40,000 for year two.' }),
  historicalFeeCycle({ id: 'cycle-thu-icpm-2026-2027-autumn-fee-reference', programId: 'program-tsinghua-university-masters-program-in-international-construction-and-project-management-master', tuitionCny: 158000, tuitionPeriod: 'program', applicationFeeCny: 800, sourceIds: thuHistoricalSources, note: 'The official table gives CNY 79,000 in each of two years.' }),
  historicalFeeCycle({ id: 'cycle-thu-environmental-science-master-2026-2027-autumn-fee-reference', programId: 'program-tsinghua-university-masters-program-in-environmental-science-engineering-and-management-master', tuitionCny: 78000, tuitionPeriod: 'program', applicationFeeCny: 800, sourceIds: thuHistoricalSources, note: 'The official table gives CNY 39,000 in each of two years.' }),
  historicalFeeCycle({ id: 'cycle-thu-vehicle-mobility-2026-2027-autumn-fee-reference', programId: 'program-tsinghua-university-masters-program-in-vehicle-and-mobility-master', tuitionCny: 78000, tuitionPeriod: 'program', applicationFeeCny: 800, sourceIds: thuHistoricalSources, note: 'The official table gives CNY 39,000 in each of two years.' }),
  historicalFeeCycle({ id: 'cycle-thu-global-manufacturing-2026-2027-autumn-fee-reference', programId: 'program-tsinghua-university-masters-program-in-global-manufacturing-and-analytics-master', tuitionCny: 78000, tuitionPeriod: 'program', applicationFeeCny: 800, sourceIds: thuHistoricalSources, note: 'The official table gives CNY 39,000 in each of two years.' }),
  historicalFeeCycle({ id: 'cycle-thu-imem-2026-2027-autumn-fee-reference', programId: 'program-tsinghua-university-international-master-of-engineering-management-master', tuitionCny: 78000, tuitionPeriod: 'program', applicationFeeCny: 800, sourceIds: thuHistoricalSources, note: 'The official table gives CNY 39,000 in each of two years.' }),
  historicalFeeCycle({ id: 'cycle-thu-advanced-computing-2026-2027-autumn-fee-reference', programId: 'program-tsinghua-university-masters-program-in-advanced-computing-master', tuitionCny: 39000, tuitionPeriod: 'academic-year', applicationFeeCny: 800, sourceIds: thuHistoricalSources, note: 'The official table publishes CNY 39,000 per academic year.' }),
  historicalFeeCycle({ id: 'cycle-thu-computer-science-phd-2026-2027-autumn-fee-reference', programId: 'program-tsinghua-university-doctoral-program-in-computer-science-and-technology-doctorate', tuitionCny: 40000, tuitionPeriod: 'academic-year', applicationFeeCny: 800, sourceIds: thuHistoricalSources, note: 'The official table publishes CNY 40,000 per academic year.' }),
  historicalFeeCycle({ id: 'cycle-thu-nuclear-engineering-management-2026-2027-autumn-fee-reference', programId: 'program-tsinghua-university-international-master-in-nuclear-engineering-and-management-master', tuitionCny: 78000, tuitionPeriod: 'program', applicationFeeCny: 800, sourceIds: thuHistoricalSources, note: 'The official table gives CNY 39,000 in each of two years.' }),
  historicalFeeCycle({ id: 'cycle-thu-global-mba-2026-2027-autumn-fee-reference', programId: 'program-tsinghua-university-tsinghua-global-mba-program-master', tuitionCny: 198000, tuitionPeriod: 'program', applicationFeeCny: 800, sourceIds: thuHistoricalSources, note: 'The official table gives CNY 99,000 in each of two years.' }),
  historicalFeeCycle({ id: 'cycle-thu-mid-2026-2027-autumn-fee-reference', programId: 'program-tsinghua-university-master-of-public-administration-in-international-development-master', tuitionCny: 120000, tuitionPeriod: 'program', applicationFeeCny: 800, sourceIds: thuHistoricalSources, note: 'The exact MID/MPP-SDG table row gives CNY 60,000 in each of two years; it is not the separate CNY 30,000 IMPA route.' }),
  historicalFeeCycle({ id: 'cycle-thu-llm-chinese-law-2026-2027-autumn-fee-reference', programId: 'program-tsinghua-university-ll-m-in-chinese-law-master', tuitionCny: 146000, tuitionPeriod: 'program', applicationFeeCny: 800, sourceIds: thuHistoricalSources, note: 'The official row groups LL.M. in Chinese Law with two other named English law tracks at CNY 146,000 for the full program.' }),
  historicalFeeCycle({ id: 'cycle-gap-pku-depth-cs-master-english-2026-2027-autumn-fee-reference', programId: 'prog-gap-pku-depth-cs-master-english', tuitionCny: 50000, tuitionPeriod: 'academic-year', applicationFeeCny: null, sourceIds: ['src-gap-program-pku-depth-cs-master-english', pkuTuitionSource], note: 'The official program page publishes CNY 50,000 per year and the official fee PDF gives CNY 150,000 total for three years.' }),
  historicalFeeCycle({ id: 'cycle-gap-pku-depth-cs-doctorate-english-2026-2027-autumn-fee-reference', programId: 'prog-gap-pku-depth-cs-doctorate-english', tuitionCny: 50000, tuitionPeriod: 'academic-year', applicationFeeCny: null, sourceIds: ['src-gap-program-pku-depth-cs-master-english', pkuTuitionSource], note: 'The official program page publishes CNY 50,000 per year; the official PDF gives CNY 200,000 for four years or CNY 250,000 for five years.' }),
  historicalFeeCycle({ id: 'cycle-gap-pku-depth-impa-cppic-master-2026-2027-autumn-fee-reference', programId: 'prog-gap-pku-depth-impa-cppic-master', tuitionCny: 190000, tuitionPeriod: 'academic-year', applicationFeeCny: 800, sourceIds: ['src-gap-program-pku-depth-impa-cppic-master', pkuTuitionSource], note: 'The English IMPA route is two years at CNY 190,000 per year, CNY 380,000 total.' }),
  historicalFeeCycle({ id: 'cycle-gap-pku-depth-llm-chinese-law-2026-2027-autumn-fee-reference', programId: 'prog-gap-pku-depth-llm-chinese-law', tuitionCny: 160000, tuitionPeriod: 'program', applicationFeeCny: 800, sourceIds: ['src-gap-program-pku-depth-llm-chinese-law', pkuTuitionSource], note: 'The LL.M. program page and official fee PDF publish CNY 160,000 for the full program.' }),
]

const sources = read('sources.json')
const programs = read('programs.json')
let admissionCycles = read('admission-cycles.json')

for (const source of sourceSpecs) upsertById(sources, source)

for (const program of programSpecs) {
  if (!programs.some((item) => item.id === program.id)) {
    throw new Error(`Expected Tsinghua program is missing: ${program.id}`)
  }
  upsertById(programs, program, true)
}

const unsupportedProgram = programs.find((item) => item.id === unsupportedBusinessProgramId)
if (!unsupportedProgram) {
  throw new Error(`Expected unsupported Tsinghua identity is missing: ${unsupportedBusinessProgramId}`)
}
upsertById(programs, {
  id: unsupportedBusinessProgramId,
  teachingLanguages: [],
  durationMonths: null,
  durationMonthsMax: null,
  applyUrl: null,
  languageRequirements: [],
  verificationScope: 'identity',
  verifiedAt: checkedAt,
  reviewAfter: checkedAt,
  status: 'archived',
}, true)

const cycleCountBeforeQuarantine = admissionCycles.length
admissionCycles = admissionCycles.filter((cycle) => cycle.programId !== unsupportedBusinessProgramId)
const unsupportedCyclesRemoved = cycleCountBeforeQuarantine - admissionCycles.length

for (const cycle of [...currentCycleSpecs, ...historicalCycleSpecs]) {
  upsertById(admissionCycles, cycle)
}

write('sources.json', sources)
write('programs.json', programs)
write('admission-cycles.json', admissionCycles)

console.log(JSON.stringify({
  checkedAt,
  sourcesUpserted: sourceSpecs.length,
  currentProgramsCompleted: programSpecs.length,
  currentCyclesUpserted: currentCycleSpecs.length,
  historicalCyclesUpserted: historicalCycleSpecs.length,
  unsupportedProgramsArchived: 1,
  unsupportedCyclesRemoved,
  visitingSingleTuitionValuesPublished: 0,
}, null, 2))
