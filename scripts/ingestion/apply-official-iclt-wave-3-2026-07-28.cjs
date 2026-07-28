const fs = require('node:fs')
const path = require('node:path')

const DATA_DIR = path.join(process.cwd(), 'content', 'data')
const VERIFIED_AT = '2026-07-28'
const REVIEW_AFTER = '2026-08-27'
const PROFILE_REVIEW_AFTER = '2027-01-24'
const CITY_REVIEW_AFTER = '2027-07-28'
const ICLT_STANDARD_SOURCE_ID = 'src-clec-iclt-2026-standard'
const ICLT_PORTAL = 'https://pmplatform.chinese.cn/ui/start/#/login'

const localized = (en, zh, ru) => ({ en, zh, ru })

const sources = [
  {
    id: 'src-city-guiyang',
    url: 'https://english.guiyang.gov.cn/profile.html',
    title: 'Official city profile — Guiyang',
    publisher: "Guiyang Municipal People's Government",
    kind: 'city',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-city-kunming',
    url: 'https://en.www.km.gov.cn/index.html',
    title: 'Official city information — Kunming',
    publisher: "Kunming Municipal People's Government",
    kind: 'city',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-gzu-iclt-2026',
    url: 'https://cie.gzu.edu.cn/2026/0217/c8268a264962/pagem.htm',
    title: 'Guizhou University International Chinese Language Teachers Scholarship 2026',
    publisher: 'Guizhou University',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-gzu-iclt-2026-pdf',
    url: 'https://cie.gzu.edu.cn/_upload/article/files/f1/e3/b35c020d43d1b9555b3f35fee500/e177e925-fd51-47d7-ae2f-5bfe993c60b0.pdf',
    title: 'Guizhou University ICLT Scholarship 2026 official guide PDF',
    publisher: 'Guizhou University',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-cupb-iclt-2026',
    url: 'https://www.cup.edu.cn/overseas/cn/zsxx/jxjjs/gjzwjsjxj/index.htm',
    title: 'China University of Petroleum (Beijing) International Chinese Language Teachers Scholarship 2026',
    publisher: 'China University of Petroleum (Beijing)',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-ynu-iclt-2026-index',
    url: 'https://english.ynu.edu.cn/ynuscholarships.html',
    title: 'Yunnan University scholarship admissions index 2026',
    publisher: 'Yunnan University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-ynu-iclt-2026-pdf',
    url: 'https://www.chinadaily.com.cn/specials/ynu/YunnanUniversityAdmissionsforInternationalChineseLanguageTeachersScholarshipProgram2026.pdf',
    title: 'Yunnan University Admissions for International Chinese Language Teachers Scholarship Program 2026',
    publisher: 'Yunnan University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
]

function audited(record, reviewAfter = REVIEW_AFTER) {
  return {
    sourceIds: record.sourceIds,
    verifiedAt: VERIFIED_AT,
    reviewAfter,
    status: 'verified',
    ...record,
  }
}

const cities = [
  audited({
    sourceIds: ['src-city-guiyang'],
    id: 'city-guiyang',
    slug: 'guiyang',
    name: localized('Guiyang', '贵阳', 'Гуйян'),
    province: localized('Guizhou', '贵州省', 'Гуйчжоу'),
    region: 'southwest',
    coordinates: { lat: 26.647, lng: 106.6302 },
    overview: localized(
      'The capital of Guizhou is a mountainous education and technology center known for a mild summer climate.',
      '贵州省会，是一座山地教育与科技中心，以夏季凉爽著称。',
      'Столица Гуйчжоу — горный образовательный и технологический центр с мягким летом.',
    ),
    climate: localized(
      'A humid subtropical highland climate with mild summers and cool, damp winters.',
      '湿润的亚热带高原气候，夏季温和，冬季湿冷。',
      'Влажный субтропический высокогорный климат с мягким летом и прохладной влажной зимой.',
    ),
    foodHighlights: [
      localized('Sour-soup fish', '酸汤鱼', 'Рыба в кислом бульоне'),
      localized('Silk dolls', '丝娃娃', 'Овощные рулетики сывава'),
    ],
    sights: [
      localized('Jiaxiu Tower', '甲秀楼', 'Башня Цзясю'),
      localized('Qianling Mountain Park', '黔灵山公园', 'Парк горы Цяньлин'),
    ],
  }, CITY_REVIEW_AFTER),
  audited({
    sourceIds: ['src-city-kunming'],
    id: 'city-kunming',
    slug: 'kunming',
    name: localized('Kunming', '昆明', 'Куньмин'),
    province: localized('Yunnan', '云南省', 'Юньнань'),
    region: 'southwest',
    coordinates: { lat: 25.0389, lng: 102.7183 },
    overview: localized(
      'Yunnan provincial capital and a major gateway for study and exchange with South and Southeast Asia.',
      '云南省会，也是面向南亚、东南亚开展学习与交流的重要门户。',
      'Столица Юньнани и важный центр обучения и обменов с Южной и Юго-Восточной Азией.',
    ),
    climate: localized(
      'A subtropical highland climate with mild temperatures through most of the year.',
      '亚热带高原气候，全年大部分时间气温温和。',
      'Субтропический высокогорный климат с мягкой температурой большую часть года.',
    ),
    foodHighlights: [
      localized('Crossing-the-bridge rice noodles', '过桥米线', 'Рисовая лапша «через мост»'),
      localized('Wild-mushroom hotpot', '野生菌火锅', 'Хот-пот с лесными грибами'),
    ],
    sights: [
      localized('Dianchi Lake', '滇池', 'Озеро Дяньчи'),
      localized('Yunnan Stone Forest', '云南石林', 'Каменный лес Юньнани'),
    ],
  }, CITY_REVIEW_AFTER),
]

const universities = [
  audited({
    sourceIds: ['src-gzu-iclt-2026'],
    id: 'uni-guizhou-university',
    slug: 'guizhou-university',
    name: localized('Guizhou University', '贵州大学', 'Гуйчжоуский университет'),
    cityId: 'city-guiyang',
    region: 'southwest',
    officialUrl: 'https://www.gzu.edu.cn/',
    admissionsUrl: 'https://cie.gzu.edu.cn/',
    summary: localized(
      'A Double First-Class university in Guiyang with an officially published Spring 2027 Chinese-language scholarship route.',
      '位于贵阳的双一流高校，已发布可核验的2027年春季中文研修奖学金项目。',
      'Университет программы Double First-Class в Гуйяне с подтверждённой стипендиальной программой китайского языка на весну 2027 года.',
    ),
    featured: false,
  }, PROFILE_REVIEW_AFTER),
  audited({
    sourceIds: ['src-cupb-iclt-2026'],
    id: 'uni-china-university-of-petroleum-beijing',
    slug: 'china-university-of-petroleum-beijing',
    name: localized(
      'China University of Petroleum (Beijing)',
      '中国石油大学（北京）',
      'Китайский нефтяной университет (Пекин)',
    ),
    cityId: 'city-beijing',
    region: 'north',
    officialUrl: 'https://www.cup.edu.cn/',
    admissionsUrl: 'https://www.cup.edu.cn/overseas/',
    summary: localized(
      'A Double First-Class engineering university with a school-specific Spring 2027 Chinese-language scholarship guide.',
      '双一流工科高校，已发布校级2027年春季中文研修奖学金指南。',
      'Инженерный университет программы Double First-Class с собственной стипендиальной программой китайского языка на весну 2027 года.',
    ),
    featured: false,
  }, PROFILE_REVIEW_AFTER),
  audited({
    sourceIds: ['src-ynu-iclt-2026-index', 'src-ynu-iclt-2026-pdf'],
    id: 'uni-yunnan-university',
    slug: 'yunnan-university',
    name: localized('Yunnan University', '云南大学', 'Юньнаньский университет'),
    cityId: 'city-kunming',
    region: 'southwest',
    officialUrl: 'https://www.ynu.edu.cn/',
    admissionsUrl: 'https://english.ynu.edu.cn/',
    summary: localized(
      'A Double First-Class comprehensive university in Kunming with an officially indexed Spring scholarship intake for Chinese-language study.',
      '位于昆明的双一流综合性大学，官方奖学金目录已发布春季中文研修申请批次。',
      'Университет программы Double First-Class в Куньмине с официально опубликованным весенним стипендиальным набором на китайский язык.',
    ),
    featured: false,
  }, PROFILE_REVIEW_AFTER),
]

function createIclt({
  key,
  universityId,
  sourceIds,
  school,
  programUrl,
  directions,
  languageRequirements,
  route,
  scholarshipSummary,
  accommodation = 'full',
  insurance = true,
  stipendCnyPerMonth = 2500,
  cycleEvidence,
}) {
  const allSourceIds = [...sourceIds, ICLT_STANDARD_SOURCE_ID]
  const programId = `program-${key}`
  return {
    program: audited({
      sourceIds: allSourceIds,
      id: programId,
      slug: key,
      universityId,
      name: localized(
        'International Chinese Language Teachers Scholarship — One-Semester Study (Spring 2027)',
        '国际中文教师奖学金一学期研修项目（2027年春季）',
        'Семестровая программа стипендии для преподавателей китайского языка (весна 2027)',
      ),
      degreeLevel: 'language',
      discipline: 'chinese-education',
      teachingLanguages: [],
      durationMonths: 5,
      programUrl,
      applyUrl: ICLT_PORTAL,
      languageRequirements,
      verificationScope: 'facts',
    }),
    cycle: audited({
      sourceIds: allSourceIds,
      id: `cycle-${key}`,
      programId,
      academicYear: '2026-2027',
      intake: 'spring',
      opensOn: null,
      closesOn: '2026-10-31',
      dateStatus: 'published',
      tuitionCny: null,
      tuitionPeriod: null,
      tuitionStatus: null,
      evidenceBasis: 'cycle-specific',
      factScope: 'dates-only',
      applicationFeeCny: null,
      notes: localized(
        `${directions.en}. ${route.en} ${cycleEvidence?.en ?? ''}`.trim(),
        `${directions.zh}。${route.zh}${cycleEvidence?.zh ? ` ${cycleEvidence.zh}` : ''}`,
        `${directions.ru}. ${route.ru}${cycleEvidence?.ru ? ` ${cycleEvidence.ru}` : ''}`,
      ),
    }),
    scholarship: audited({
      sourceIds: allSourceIds,
      id: `scholarship-${key}`,
      slug: key,
      name: localized(
        `International Chinese Language Teachers Scholarship at ${school.en} — Spring 2027`,
        `${school.zh}国际中文教师奖学金（2027年春季）`,
        `Стипендия для преподавателей китайского языка в ${school.ru} — весна 2027`,
      ),
      providerType: 'other',
      universityIds: [universityId],
      programIds: [programId],
      coverage: {
        tuition: 'full',
        accommodation,
        insurance,
        stipendCnyPerMonth,
      },
      deadline: '2026-10-31',
      applicationUrl: ICLT_PORTAL,
      summary: scholarshipSummary,
    }),
  }
}

const gzu = createIclt({
  key: 'gzu-iclt-one-semester-spring-2027',
  universityId: 'uni-guizhou-university',
  sourceIds: ['src-gzu-iclt-2026', 'src-gzu-iclt-2026-pdf'],
  school: localized('Guizhou University', '贵州大学', 'Гуйчжоуском университете'),
  programUrl: 'https://cie.gzu.edu.cn/2026/0217/c8268a264962/pagem.htm',
  directions: localized(
    'Directions include International Chinese Language Education and Taiji Culture',
    '方向包括国际中文教育和太极文化',
    'Направления включают международное преподавание китайского языка и культуру тайцзи',
  ),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180 for International Chinese Language Education; an HSK score is required for Taiji Culture' },
    { test: 'other', minimum: 'HSKK required for International Chinese Language Education; preferred for Taiji Culture' },
  ],
  route: localized(
    'Submit through the central scholarship portal and the Guizhou University international student system.',
    '须通过奖学金中央系统和贵州大学国际学生系统提交。',
    'Заявка подаётся через центральный портал и систему иностранных студентов университета.',
  ),
  scholarshipSummary: localized(
    'Coverage includes registration and tuition fees, on-campus accommodation, CNY 2,500 monthly living allowance and comprehensive medical insurance.',
    '资助包括报名费和学费、校内住宿、每月2,500元生活费及综合医疗保险。',
    'Покрытие включает регистрационный сбор и обучение, проживание, пособие 2 500 юаней в месяц и медицинскую страховку.',
  ),
})

const cupb = createIclt({
  key: 'cupb-iclt-one-semester-spring-2027',
  universityId: 'uni-china-university-of-petroleum-beijing',
  sourceIds: ['src-cupb-iclt-2026'],
  school: localized(
    'China University of Petroleum (Beijing)',
    '中国石油大学（北京）',
    'Китайском нефтяном университете (Пекин)',
  ),
  programUrl: 'https://www.cup.edu.cn/overseas/cn/zsxx/jxjjs/gjzwjsjxj/index.htm',
  directions: localized(
    'Directions include International Chinese Language Education, Chinese Language and Literature, Chinese History, Chinese Philosophy, Traditional Chinese Medicine and Taiji Culture',
    '方向包括国际中文教育、汉语言文学、中国历史、中国哲学、中医和太极文化',
    'Направления включают международное преподавание китайского языка, китайский язык и литературу, историю и философию Китая, китайскую медицину и тайцзи',
  ),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180 for language/history/philosophy directions; an HSK score is required for TCM and Taiji' },
    { test: 'other', minimum: 'HSKK required for language/history/philosophy directions; preferred for TCM and Taiji' },
  ],
  route: localized(
    'Submit through the central scholarship portal. The school review deadline is November 10, 2026.',
    '通过奖学金中央系统提交；学校审核截止日期为2026年11月10日。',
    'Заявка подаётся через центральный портал; проверка университета завершается 10 ноября 2026 года.',
  ),
  scholarshipSummary: localized(
    'Coverage includes tuition, a shared on-campus room or approved CNY 700 monthly off-campus subsidy, CNY 2,500 monthly living allowance and CNY 400 semester insurance.',
    '资助包括学费、校内双人间或经批准的每月700元校外住宿补贴、每月2,500元生活费及每学期400元保险。',
    'Покрытие включает обучение, комнату в кампусе или 700 юаней в месяц на внешнее жильё, пособие 2 500 юаней и страховку 400 юаней за семестр.',
  ),
})

const ynu = createIclt({
  key: 'ynu-iclt-one-semester-spring-2027',
  universityId: 'uni-yunnan-university',
  sourceIds: ['src-ynu-iclt-2026-index', 'src-ynu-iclt-2026-pdf'],
  school: localized('Yunnan University', '云南大学', 'Юньнаньском университете'),
  programUrl: 'https://english.ynu.edu.cn/ynuscholarships.html',
  directions: localized(
    'International Chinese Language Education',
    '国际中文教育',
    'Международное преподавание китайского языка',
  ),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180' },
    { test: 'other', minimum: 'HSKK required' },
  ],
  route: localized(
    'Submit through the central scholarship portal and Yunnan University international student system.',
    '须通过奖学金中央系统和云南大学国际学生系统提交。',
    'Заявка подаётся через центральный портал и систему иностранных студентов университета.',
  ),
  scholarshipSummary: localized(
    'The university guide states coverage of tuition, accommodation, living allowance and comprehensive medical insurance; it does not state a monthly allowance amount.',
    '校方简章明确覆盖学费、住宿、生活费和综合医疗保险，但未公布每月生活费金额。',
    'Руководство университета указывает оплату обучения, проживания, пособия и страховки, но не приводит ежемесячную сумму.',
  ),
  stipendCnyPerMonth: null,
  cycleEvidence: localized(
    'The Spring 2027 cycle label follows the guide year, its published spring intake and the October 31, 2026 deadline. A template error in the unrelated four-week section is excluded.',
    '“2027年春季”由简章年度、已公布的春季批次及2026年10月31日截止日期共同对应；无关四周项目中的模板错误已隔离。',
    'Метка «весна 2027» основана на годе руководства, весеннем наборе и сроке 31 октября 2026 года; ошибка шаблона в другом четырёхнедельном разделе исключена.',
  ),
})

const groups = [gzu, cupb, ynu]

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
  const currentIds = new Set(current.map((item) => item.id))
  return [
    ...current.map((item) => additionsById.get(item.id) ?? item),
    ...additions.filter((item) => !currentIds.has(item.id)),
  ]
}

function apply() {
  const updated = {
    sources: upsertById(readJson('sources.json'), sources),
    cities: upsertById(readJson('cities.json'), cities),
    universities: upsertById(readJson('universities.json'), universities),
    programs: upsertById(
      readJson('programs.json'),
      groups.map((group) => group.program),
    ),
    admissionCycles: upsertById(
      readJson('admission-cycles.json'),
      groups.map((group) => group.cycle),
    ),
    scholarships: upsertById(
      readJson('scholarships.json'),
      groups.map((group) => group.scholarship),
    ),
  }

  writeJson('sources.json', updated.sources)
  writeJson('cities.json', updated.cities)
  writeJson('universities.json', updated.universities)
  writeJson('programs.json', updated.programs)
  writeJson('admission-cycles.json', updated.admissionCycles)
  writeJson('scholarships.json', updated.scholarships)

  console.log(JSON.stringify({
    sources: updated.sources.length,
    cities: updated.cities.length,
    universities: updated.universities.length,
    programs: updated.programs.length,
    admissionCycles: updated.admissionCycles.length,
    scholarships: updated.scholarships.length,
    newCities: cities.length,
    newUniversities: universities.length,
    newPrograms: groups.length,
    newScholarships: groups.length,
  }, null, 2))
}

apply()
