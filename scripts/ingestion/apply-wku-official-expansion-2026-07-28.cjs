const fs = require('node:fs')
const path = require('node:path')

const DATA_DIR = path.join(process.cwd(), 'content', 'data')
const VERIFIED_AT = '2026-07-28'
const DYNAMIC_REVIEW_AFTER = '2026-08-27'
const CYCLE_REVIEW_AFTER = '2026-08-04'
const PROFILE_REVIEW_AFTER = '2027-01-24'

const localized = (en, zh, ru) => ({ en, zh, ru })

const source = (id, url, title, kind, language = 'en') => ({
  id,
  url,
  title,
  publisher: 'Wenzhou-Kean University',
  kind,
  language,
  official: true,
  accessedAt: VERIFIED_AT,
})

const sources = [
  source(
    'src-wku-university',
    'https://www.wku.edu.cn/en',
    'Wenzhou-Kean University',
    'university',
  ),
  source(
    'src-wku-international-admissions-2027',
    'https://admission.wku.edu.cn/en/internationalstudents',
    'International Students Admission',
    'admissions',
  ),
  source(
    'src-wku-finance-bs',
    'https://cbpm.wku.edu.cn/en/node/1839',
    'Bachelor of Science in Finance',
    'program',
  ),
  source(
    'src-wku-global-business-bs',
    'https://cbpm.wku.edu.cn/en/node/1845',
    'Bachelor of Science in Global Business',
    'program',
  ),
  source(
    'src-wku-computer-science-bs',
    'https://csmt.wku.edu.cn/en/node/1794',
    'Bachelor of Science in Computer Science',
    'program',
  ),
  source(
    'src-wku-biology-cell-molecular-bs',
    'https://csmt.wku.edu.cn/en/node/1809',
    'Bachelor of Science in Biology, Cell and Molecular Biology Option',
    'program',
  ),
  source(
    'src-wku-architecture-bfa',
    'https://design.wku.edu.cn/zh-hans/node/1846',
    'Bachelor of Fine Arts in Architecture',
    'program',
    'zh',
  ),
  source(
    'src-wku-freshman-scholarship-2026',
    'https://admission.wku.edu.cn/en/internationalstudents',
    'Freshman Scholarship for International Students',
    'scholarship',
  ),
]

const university = {
  sourceIds: ['src-wku-university', 'src-wku-international-admissions-2027'],
  verifiedAt: VERIFIED_AT,
  reviewAfter: PROFILE_REVIEW_AFTER,
  status: 'verified',
  id: 'uni-wenzhou-kean-university',
  slug: 'wenzhou-kean-university',
  name: localized(
    'Wenzhou-Kean University',
    '温州肯恩大学',
    'Вэньчжоуский университет Кин',
  ),
  cityId: 'city-wenzhou',
  region: 'east',
  officialUrl: 'https://www.wku.edu.cn/en',
  admissionsUrl: 'https://admission.wku.edu.cn/en/internationalstudents',
  summary: localized(
    'Wenzhou-Kean University publishes English-medium undergraduate programs and a dedicated official application route for international students.',
    '温州肯恩大学面向国际学生发布英文授课本科项目，并提供独立的官方申请通道。',
    'Вэньчжоуский университет Кин публикует англоязычные программы бакалавриата и отдельный официальный маршрут подачи заявлений для иностранных студентов.',
  ),
  featured: false,
}

const englishRequirements = [
  {
    test: 'TOEFL',
    minimum: 'iBT 79 or paper-based 550; tests after 2026-01-21 use minimum 4.0 on the new scale',
  },
  { test: 'IELTS', minimum: '6.0' },
  { test: 'other', minimum: 'Duolingo English Test 105' },
]

function program({
  id,
  name,
  discipline,
  programUrl,
  programSourceId,
}) {
  return {
    sourceIds: [programSourceId, 'src-wku-international-admissions-2027'],
    verifiedAt: VERIFIED_AT,
    reviewAfter: DYNAMIC_REVIEW_AFTER,
    status: 'verified',
    id,
    slug: id.replace(/^program-/, ''),
    universityId: university.id,
    name,
    degreeLevel: 'bachelor',
    discipline,
    teachingLanguages: ['English'],
    durationMonths: 48,
    programUrl,
    applyUrl: 'https://intlapply.wku.edu.cn/',
    languageRequirements: englishRequirements,
    verificationScope: 'facts',
  }
}

const programs = [
  program({
    id: 'program-wenzhou-kean-university-finance-bs',
    name: localized(
      'Bachelor of Science in Finance',
      '金融学理学学士',
      'Бакалавр наук по финансам',
    ),
    discipline: 'business',
    programUrl: 'https://cbpm.wku.edu.cn/en/node/1839',
    programSourceId: 'src-wku-finance-bs',
  }),
  program({
    id: 'program-wenzhou-kean-university-global-business-bs',
    name: localized(
      'Bachelor of Science in Global Business',
      '全球商务理学学士',
      'Бакалавр наук по глобальному бизнесу',
    ),
    discipline: 'business',
    programUrl: 'https://cbpm.wku.edu.cn/en/node/1845',
    programSourceId: 'src-wku-global-business-bs',
  }),
  program({
    id: 'program-wenzhou-kean-university-computer-science-bs',
    name: localized(
      'Bachelor of Science in Computer Science',
      '计算机科学理学学士',
      'Бакалавр наук по компьютерным наукам',
    ),
    discipline: 'engineering',
    programUrl: 'https://csmt.wku.edu.cn/en/node/1794',
    programSourceId: 'src-wku-computer-science-bs',
  }),
  program({
    id: 'program-wenzhou-kean-university-biology-cell-molecular-bs',
    name: localized(
      'Bachelor of Science in Biology (Cell and Molecular Biology Option)',
      '生物学理学学士（细胞与分子生物学方向）',
      'Бакалавр наук по биологии (клеточная и молекулярная биология)',
    ),
    discipline: 'science',
    programUrl: 'https://csmt.wku.edu.cn/en/node/1809',
    programSourceId: 'src-wku-biology-cell-molecular-bs',
  }),
  program({
    id: 'program-wenzhou-kean-university-architecture-bfa',
    name: localized(
      'Bachelor of Fine Arts in Architecture',
      '建筑学艺术学士',
      'Бакалавр изящных искусств по архитектуре',
    ),
    discipline: 'art-design',
    programUrl: 'https://design.wku.edu.cn/zh-hans/node/1846',
    programSourceId: 'src-wku-architecture-bfa',
  }),
]

const transferOnlyNotes = localized(
  'Spring 2027 entry is open to transfer students only. First-year students may enter only in the fall intake.',
  '2027年春季入学仅面向转学生；大学一年级新生只能申请秋季入学。',
  'Набор весной 2027 года открыт только для переводных студентов; первокурсники могут поступать только осенью.',
)

const cycles = programs.map((item) => ({
  sourceIds: ['src-wku-international-admissions-2027'],
  verifiedAt: VERIFIED_AT,
  reviewAfter: CYCLE_REVIEW_AFTER,
  status: 'verified',
  id: `cycle-2027-${item.slug}-spring-transfer`,
  programId: item.id,
  academicYear: '2026-2027',
  intake: 'spring',
  opensOn: null,
  closesOn: '2026-11-01',
  dateStatus: 'published',
  tuitionCny: 68000,
  tuitionPeriod: 'academic-year',
  tuitionStatus: 'confirmed',
  evidenceBasis: 'cycle-specific',
  factScope: 'complete',
  applicationFeeCny: 400,
  notes: transferOnlyNotes,
}))

const scholarship = {
  sourceIds: ['src-wku-freshman-scholarship-2026'],
  verifiedAt: VERIFIED_AT,
  reviewAfter: DYNAMIC_REVIEW_AFTER,
  status: 'verified',
  id: 'scholarship-wku-freshman-2026',
  slug: 'wku-freshman-2026',
  name: localized(
    'WKU Freshman Scholarship',
    '温州肯恩大学新生奖学金',
    'Стипендия первокурсникам WKU',
  ),
  providerType: 'university',
  universityIds: [university.id],
  programIds: [],
  coverage: {
    tuition: 'partial',
    accommodation: 'unknown',
    insurance: 'unknown',
    stipendCnyPerMonth: null,
  },
  deadline: '2026-06-30',
  applicationUrl: 'https://admission.wku.edu.cn/en/internationalstudents',
  summary: localized(
    'For admitted fall freshmen, the first-class award reduces tuition by 60% and the second-class award by 30%. The award may be renewed annually during the four-year program, subject to annual review. Only admitted students are eligible for scholarship review.',
    '面向秋季录取新生，一等奖减免60%学费，二等奖减免30%学费；在四年学制内可按年度评审续奖，只有已录取学生才有资格参加奖学金评审。',
    'Для зачисленных осенью первокурсников первая категория снижает плату за обучение на 60%, вторая — на 30%. Стипендия может ежегодно продлеваться в течение четырёхлетней программы после проверки; к рассмотрению на стипендию допускаются только зачисленные студенты.',
  ),
}

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, fileName), 'utf8'))
}

function writeJson(fileName, value) {
  fs.writeFileSync(
    path.join(DATA_DIR, fileName),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  )
}

function upsertById(current, additions) {
  const additionsById = new Map(additions.map((item) => [item.id, item]))
  const output = current.map((item) => additionsById.get(item.id) ?? item)
  const currentIds = new Set(current.map((item) => item.id))
  output.push(...additions.filter((item) => !currentIds.has(item.id)))
  return output
}

function apply() {
  const updatedSources = upsertById(readJson('sources.json'), sources)
  const updatedUniversities = upsertById(readJson('universities.json'), [university])
  const updatedPrograms = upsertById(readJson('programs.json'), programs)
  const updatedCycles = upsertById(readJson('admission-cycles.json'), cycles)
  const updatedScholarships = upsertById(readJson('scholarships.json'), [scholarship])

  writeJson('sources.json', updatedSources)
  writeJson('universities.json', updatedUniversities)
  writeJson('programs.json', updatedPrograms)
  writeJson('admission-cycles.json', updatedCycles)
  writeJson('scholarships.json', updatedScholarships)

  console.log(JSON.stringify({
    sources: updatedSources.length,
    universities: updatedUniversities.length,
    programs: updatedPrograms.length,
    admissionCycles: updatedCycles.length,
    scholarships: updatedScholarships.length,
  }, null, 2))
}

apply()
