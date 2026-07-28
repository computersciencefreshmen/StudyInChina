const fs = require('node:fs')
const path = require('node:path')

const DATA_DIR = path.join(process.cwd(), 'content', 'data')
const VERIFIED_AT = '2026-07-28'
const DYNAMIC_REVIEW_AFTER = '2026-08-27'
const CYCLE_REVIEW_AFTER = '2026-08-04'
const PROFILE_REVIEW_AFTER = '2027-01-24'
const BROCHURE_URL = 'https://xxgk.bupt.edu.cn/__local/4/9D/6D/1EB441EB8B730D5E91D1635D888_A9DEF37C_2D5B4.pdf'

const localized = (en, zh, ru) => ({ en, zh, ru })

const sources = [
  {
    id: 'src-bupt-university',
    url: 'https://www.bupt.edu.cn/',
    title: 'Beijing University of Posts and Telecommunications',
    publisher: 'Beijing University of Posts and Telecommunications',
    kind: 'university',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-bupt-international-admissions',
    url: 'https://ois.bupt.edu.cn/',
    title: 'BUPT International Student Application System',
    publisher: 'Beijing University of Posts and Telecommunications',
    kind: 'admissions',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-bupt-2026-international-brochure',
    url: BROCHURE_URL,
    title: '2026 Admission Brochure for International Students',
    publisher: 'Beijing University of Posts and Telecommunications',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-bupt-chinese-government-scholarship',
    url: 'https://ois.bupt.edu.cn/Scholarships/Chinese_government_scholarship.htm',
    title: 'Chinese Government Scholarship',
    publisher: 'Beijing University of Posts and Telecommunications',
    kind: 'scholarship',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
]

const university = {
  sourceIds: [
    'src-bupt-university',
    'src-bupt-international-admissions',
    'src-bupt-2026-international-brochure',
  ],
  verifiedAt: VERIFIED_AT,
  reviewAfter: PROFILE_REVIEW_AFTER,
  status: 'verified',
  id: 'uni-beijing-university-of-posts-and-telecommunications',
  slug: 'beijing-university-of-posts-and-telecommunications',
  name: localized(
    'Beijing University of Posts and Telecommunications',
    '北京邮电大学',
    'Пекинский университет почты и телекоммуникаций',
  ),
  cityId: 'city-beijing',
  region: 'north',
  officialUrl: 'https://www.bupt.edu.cn/',
  admissionsUrl: 'https://ois.bupt.edu.cn/',
  summary: localized(
    'BUPT publishes a dedicated official brochure for international applicants, including English-medium computing, business and information-engineering degrees.',
    '北京邮电大学发布面向国际申请人的官方招生简章，包含英文授课的计算机、商科与信息工程学历项目。',
    'BUPT публикует отдельный официальный справочник для иностранных абитуриентов с англоязычными программами в вычислительной технике, бизнесе и информационной инженерии.',
  ),
  featured: false,
}

const englishRequirements = [
  { test: 'TOEFL', minimum: '80' },
  { test: 'IELTS', minimum: '6.0' },
]

function program({
  id,
  name,
  degreeLevel,
  discipline,
  durationMonths,
  tuitionCny,
  eligibilityNotes,
}) {
  return {
    record: {
      sourceIds: ['src-bupt-2026-international-brochure'],
      verifiedAt: VERIFIED_AT,
      reviewAfter: DYNAMIC_REVIEW_AFTER,
      status: 'verified',
      id,
      slug: id.replace(/^program-/, ''),
      universityId: university.id,
      name,
      degreeLevel,
      discipline,
      teachingLanguages: ['English'],
      durationMonths,
      programUrl: BROCHURE_URL,
      applyUrl: 'https://ois.bupt.edu.cn/',
      languageRequirements: englishRequirements,
      verificationScope: 'facts',
    },
    tuitionCny,
    eligibilityNotes,
  }
}

const programEntries = [
  program({
    id: 'program-bupt-computer-science-and-technology-bachelor-english',
    name: localized(
      'Computer Science and Technology',
      '计算机科学与技术',
      'Компьютерные науки и технологии',
    ),
    degreeLevel: 'bachelor',
    discipline: 'engineering',
    durationMonths: 48,
    tuitionCny: 24600,
    eligibilityNotes: localized(
      'The 2026 brochure requires a high-school diploma, age 30 or below, a CSCA certificate, and TOEFL 80 or IELTS 6. It describes the application window only as October 20 to April 20 of the following year, without absolute dates; confirm the current deadline in the official system.',
      '2026简章要求高中毕业、年龄不超过30岁、提交CSCA成绩，并达到TOEFL 80或IELTS 6。简章仅写明“10月20日至次年4月20日”，未给出绝对年份；当期截止日期须在官方系统确认。',
      'Справочник 2026 года требует аттестат средней школы, возраст не старше 30 лет, сертификат CSCA и TOEFL 80 или IELTS 6. Период указан лишь как с 20 октября по 20 апреля следующего года без абсолютных дат; актуальный срок нужно проверить в официальной системе.',
    ),
  }),
  program({
    id: 'program-bupt-computer-technology-master-english',
    name: localized(
      'Computer Technology',
      '计算机技术',
      'Компьютерные технологии',
    ),
    degreeLevel: 'master',
    discipline: 'engineering',
    durationMonths: 24,
    tuitionCny: 32800,
    eligibilityNotes: localized(
      'The 2026 brochure requires a bachelor’s degree, age 35 or below, and TOEFL 80 or IELTS 6. It gives no absolute current-cycle deadline; confirm dates in the official system.',
      '2026简章要求具有学士学位、年龄不超过35岁，并达到TOEFL 80或IELTS 6；简章未给出当期绝对截止日期，请在官方系统确认。',
      'Справочник 2026 года требует степень бакалавра, возраст не старше 35 лет и TOEFL 80 или IELTS 6. Абсолютный срок текущего цикла не указан; проверьте даты в официальной системе.',
    ),
  }),
  program({
    id: 'program-bupt-international-business-master-english',
    name: localized(
      'International Business',
      '国际商务',
      'Международный бизнес',
    ),
    degreeLevel: 'master',
    discipline: 'business',
    durationMonths: 24,
    tuitionCny: 32800,
    eligibilityNotes: localized(
      'The 2026 brochure requires a bachelor’s degree, age 35 or below, and TOEFL 80 or IELTS 6. It gives no absolute current-cycle deadline; confirm dates in the official system.',
      '2026简章要求具有学士学位、年龄不超过35岁，并达到TOEFL 80或IELTS 6；简章未给出当期绝对截止日期，请在官方系统确认。',
      'Справочник 2026 года требует степень бакалавра, возраст не старше 35 лет и TOEFL 80 или IELTS 6. Абсолютный срок текущего цикла не указан; проверьте даты в официальной системе.',
    ),
  }),
  program({
    id: 'program-bupt-information-and-communication-engineering-doctorate-english',
    name: localized(
      'Information and Communication Engineering',
      '信息与通信工程',
      'Информационная и коммуникационная инженерия',
    ),
    degreeLevel: 'doctorate',
    discipline: 'engineering',
    durationMonths: 48,
    tuitionCny: 41000,
    eligibilityNotes: localized(
      'The 2026 brochure requires a master’s degree, age 40 or below, and TOEFL 80 or IELTS 6. It gives no absolute current-cycle deadline; confirm dates in the official system.',
      '2026简章要求具有硕士学位、年龄不超过40岁，并达到TOEFL 80或IELTS 6；简章未给出当期绝对截止日期，请在官方系统确认。',
      'Справочник 2026 года требует степень магистра, возраст не старше 40 лет и TOEFL 80 или IELTS 6. Абсолютный срок текущего цикла не указан; проверьте даты в официальной системе.',
    ),
  }),
  program({
    id: 'program-bupt-computer-science-and-technology-doctorate-english',
    name: localized(
      'Computer Science and Technology',
      '计算机科学与技术',
      'Компьютерные науки и технологии',
    ),
    degreeLevel: 'doctorate',
    discipline: 'engineering',
    durationMonths: 48,
    tuitionCny: 41000,
    eligibilityNotes: localized(
      'The 2026 brochure requires a master’s degree, age 40 or below, and TOEFL 80 or IELTS 6. It gives no absolute current-cycle deadline; confirm dates in the official system.',
      '2026简章要求具有硕士学位、年龄不超过40岁，并达到TOEFL 80或IELTS 6；简章未给出当期绝对截止日期，请在官方系统确认。',
      'Справочник 2026 года требует степень магистра, возраст не старше 40 лет и TOEFL 80 или IELTS 6. Абсолютный срок текущего цикла не указан; проверьте даты в официальной системе.',
    ),
  }),
]

const programs = programEntries.map((entry) => entry.record)

const cycles = programEntries.map((entry) => ({
  sourceIds: ['src-bupt-2026-international-brochure'],
  verifiedAt: VERIFIED_AT,
  reviewAfter: CYCLE_REVIEW_AFTER,
  status: 'verified',
  id: `cycle-2026-${entry.record.slug}-autumn`,
  programId: entry.record.id,
  academicYear: '2026-2027',
  intake: 'autumn',
  opensOn: null,
  closesOn: null,
  dateStatus: 'not-announced',
  tuitionCny: entry.tuitionCny,
  tuitionPeriod: 'academic-year',
  tuitionStatus: 'confirmed',
  evidenceBasis: 'cycle-specific',
  factScope: 'partial',
  applicationFeeCny: 500,
  notes: entry.eligibilityNotes,
}))

const scholarship = {
  sourceIds: ['src-bupt-chinese-government-scholarship'],
  verifiedAt: VERIFIED_AT,
  reviewAfter: DYNAMIC_REVIEW_AFTER,
  status: 'verified',
  id: 'scholarship-bupt-chinese-government',
  slug: 'bupt-chinese-government',
  name: localized(
    'Chinese Government Scholarship at BUPT',
    '北京邮电大学中国政府奖学金',
    'Стипендия правительства Китая в BUPT',
  ),
  providerType: 'csc',
  universityIds: [university.id],
  programIds: [],
  coverage: {
    tuition: 'unknown',
    accommodation: 'unknown',
    insurance: 'unknown',
    stipendCnyPerMonth: null,
  },
  deadline: null,
  applicationUrl: 'https://ois.bupt.edu.cn/Scholarships/Chinese_government_scholarship.htm',
  summary: localized(
    'The official BUPT scholarship portal confirms this application route. The current BUPT-specific deadline and benefit package have not been separately confirmed, so applicants must use the official portal for the active notice.',
    '北京邮电大学官方奖学金入口确认了该申请路线；当前校级截止日期和资助方案尚未单独核实，申请人须通过官方入口查看当期通知。',
    'Официальный портал BUPT подтверждает этот маршрут подачи. Актуальные университетские сроки и состав финансирования отдельно не подтверждены; следует проверить действующее объявление на официальном портале.',
  ),
}

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, fileName), 'utf8'))
}

function writeJson(fileName, value) {
  fs.writeFileSync(path.join(DATA_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
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
