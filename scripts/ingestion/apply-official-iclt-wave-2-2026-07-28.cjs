const fs = require('node:fs')
const path = require('node:path')

const DATA_DIR = path.join(process.cwd(), 'content', 'data')
const VERIFIED_AT = '2026-07-28'
const REVIEW_AFTER = '2026-08-27'
const PROFILE_REVIEW_AFTER = '2027-01-24'
const ICLT_STANDARD_SOURCE_ID = 'src-clec-iclt-2026-standard'
const ICLT_PORTAL = 'https://pmplatform.chinese.cn/ui/start/#/login'

const localized = (en, zh, ru) => ({ en, zh, ru })

const sources = [
  {
    id: 'src-sisu-iclt-2026',
    url: 'https://www.oisa.shisu.edu.cn/index.php/index/newscontent/cid/39/id/666.html',
    title: 'Shanghai International Studies University International Chinese Language Teachers Scholarship 2026',
    publisher: 'Shanghai International Studies University',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-tjnu-iclt-2026',
    url: 'https://gjjl.tjnu.edu.cn/info/1265/6540.htm',
    title: 'Tianjin Normal University International Chinese Language Teachers Scholarship 2026',
    publisher: 'Tianjin Normal University',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-zcmu-iclt-2026',
    url: 'https://iec.zcmu.edu.cn/index.php/cn/notice',
    title: 'Zhejiang Chinese Medical University International Chinese Language Teachers Scholarship 2026',
    publisher: 'Zhejiang Chinese Medical University',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-shutcm-iclt-2026',
    url: 'https://iec.shutcm.edu.cn/gjzwjsjxjxm/list.htm',
    title: 'Shanghai University of Traditional Chinese Medicine International Chinese Language Teachers Scholarship 2026',
    publisher: 'Shanghai University of Traditional Chinese Medicine',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-neu-iclt-2026',
    url: 'https://studyinneu.neu.edu.cn/html/article_content/202603/C7259436AAA44266BC8D502AA5E58E50.shtml',
    title: 'Northeastern University International Chinese Language Teachers Scholarship 2026',
    publisher: 'Northeastern University',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-hust-iclt-2026',
    url: 'https://iso.hust.edu.cn/info/1194/4957.htm',
    title: 'Huazhong University of Science and Technology International Chinese Language Teachers Scholarship 2026',
    publisher: 'Huazhong University of Science and Technology',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
]

const universities = [
  {
    sourceIds: ['src-tjnu-iclt-2026'],
    verifiedAt: VERIFIED_AT,
    reviewAfter: PROFILE_REVIEW_AFTER,
    status: 'verified',
    id: 'uni-tianjin-normal-university',
    slug: 'tianjin-normal-university',
    name: localized(
      'Tianjin Normal University',
      '天津师范大学',
      'Тяньцзиньский педагогический университет',
    ),
    cityId: 'city-tianjin',
    region: 'north',
    officialUrl: 'https://www.tjnu.edu.cn/',
    admissionsUrl: 'https://gjjl.tjnu.edu.cn/',
    summary: localized(
      'Tianjin Normal University publishes a verified Spring 2027 scholarship route for international Chinese-language study.',
      '天津师范大学已发布可核验的2027年春季国际中文研修奖学金项目。',
      'Тяньцзиньский педагогический университет опубликовал подтверждённую стипендиальную программу китайского языка на весну 2027 года.',
    ),
    featured: false,
  },
  {
    sourceIds: ['src-zcmu-iclt-2026'],
    verifiedAt: VERIFIED_AT,
    reviewAfter: PROFILE_REVIEW_AFTER,
    status: 'verified',
    id: 'uni-zhejiang-chinese-medical-university',
    slug: 'zhejiang-chinese-medical-university',
    name: localized(
      'Zhejiang Chinese Medical University',
      '浙江中医药大学',
      'Чжэцзянский университет китайской медицины',
    ),
    cityId: 'city-hangzhou',
    region: 'east',
    officialUrl: 'https://www.zcmu.edu.cn/',
    admissionsUrl: 'https://iec.zcmu.edu.cn/',
    summary: localized(
      'Zhejiang Chinese Medical University publishes a verified Spring 2027 language and Chinese-culture scholarship route for international applicants.',
      '浙江中医药大学已发布面向国际申请人的2027年春季语言与中国文化奖学金研修项目。',
      'Чжэцзянский университет китайской медицины опубликовал подтверждённую языковую и культурную стипендиальную программу на весну 2027 года.',
    ),
    featured: false,
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

function createIclt({
  key,
  universityId,
  sourceId,
  school,
  programUrl,
  direction,
  languageRequirements,
  route,
  scholarshipSummary,
  accommodation = 'full',
  stipendCnyPerMonth = 2500,
}) {
  const sourceIds = [sourceId, ICLT_STANDARD_SOURCE_ID]
  const programId = `program-${key}`
  return {
    program: audited({
      sourceIds,
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
      sourceIds,
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
        `${direction.en}. ${route.en}`,
        `${direction.zh}。${route.zh}`,
        `${direction.ru}. ${route.ru}`,
      ),
    }),
    scholarship: audited({
      sourceIds,
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
        insurance: true,
        stipendCnyPerMonth,
      },
      deadline: '2026-10-31',
      applicationUrl: ICLT_PORTAL,
      summary: scholarshipSummary,
    }),
  }
}

const sisu = createIclt({
  key: 'sisu-iclt-one-semester-spring-2027',
  universityId: 'uni-shanghai-international-studies-university',
  sourceId: 'src-sisu-iclt-2026',
  school: localized(
    'Shanghai International Studies University',
    '上海外国语大学',
    'Шанхайском университете иностранных языков',
  ),
  programUrl: 'https://www.oisa.shisu.edu.cn/index.php/index/newscontent/cid/39/id/666.html',
  direction: localized(
    'Directions include International Chinese Language Education, Chinese Language and Literature, Chinese History, Chinese Philosophy, Traditional Chinese Medicine and Taiji Culture',
    '方向包括国际中文教育、汉语言文学、中国历史、中国哲学、中医和太极文化',
    'Направления включают международное преподавание китайского языка, китайский язык и литературу, историю Китая, китайскую философию, китайскую медицину и тайцзи',
  ),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180 for language/history/philosophy directions; HSK score required for TCM and Taiji' },
    { test: 'other', minimum: 'HSKK required for language/history/philosophy directions; preferred for TCM and Taiji' },
  ],
  route: localized(
    'Submit through the central scholarship portal and the SISU scholarship application channel. The ordinary self-funded CNY 500 fee and CNY 10,000 tuition are outside this route and are not copied here.',
    '须通过奖学金中央系统及上外奖学金专用通道提交；普通自费项目的500元报名费和10,000元学费不属于本路线，未予套用。',
    'Заявка подаётся через центральный портал и специальный канал SISU; сбор 500 юаней и обучение 10 000 юаней обычной платной программы к этому маршруту не переносятся.',
  ),
  scholarshipSummary: localized(
    'Coverage includes tuition, accommodation, a CNY 2,500 monthly allowance and CNY 400 semester medical insurance.',
    '资助覆盖学费、住宿、每月2,500元生活费及每学期400元医疗保险。',
    'Покрытие включает обучение, проживание, пособие 2 500 юаней в месяц и медицинскую страховку 400 юаней за семестр.',
  ),
})

const tjnu = createIclt({
  key: 'tjnu-iclt-one-semester-spring-2027',
  universityId: 'uni-tianjin-normal-university',
  sourceId: 'src-tjnu-iclt-2026',
  school: localized(
    'Tianjin Normal University',
    '天津师范大学',
    'Тяньцзиньском педагогическом университете',
  ),
  programUrl: 'https://gjjl.tjnu.edu.cn/info/1265/6540.htm',
  direction: localized(
    'One-semester international Chinese-language study',
    '一学期国际中文研修',
    'Семестровая программа китайского языка',
  ),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180' },
    { test: 'other', minimum: 'HSKK required' },
  ],
  route: localized(
    'Apply through the central scholarship portal. The school guide does not state the list-price tuition, application fee or teaching language.',
    '通过奖学金中央系统申请；学校简章未公布标价学费、申请费和授课语言。',
    'Заявка подаётся через центральный портал; прейскурантная стоимость, сбор и язык обучения не указаны.',
  ),
  scholarshipSummary: localized(
    'The official scholarship standard covers tuition, accommodation, a monthly living allowance and medical insurance.',
    '官方奖学金标准覆盖学费、住宿、按月生活费和医疗保险。',
    'Официальный стандарт покрывает обучение, проживание, ежемесячное пособие и медицинскую страховку.',
  ),
})

const zcmu = createIclt({
  key: 'zcmu-iclt-one-semester-spring-2027',
  universityId: 'uni-zhejiang-chinese-medical-university',
  sourceId: 'src-zcmu-iclt-2026',
  school: localized(
    'Zhejiang Chinese Medical University',
    '浙江中医药大学',
    'Чжэцзянском университете китайской медицины',
  ),
  programUrl: 'https://iec.zcmu.edu.cn/index.php/cn/notice',
  direction: localized(
    'Directions include International Chinese Language Education, Chinese Language and Literature, Chinese History, Chinese Philosophy, Traditional Chinese Medicine and Taiji Culture',
    '方向包括国际中文教育、汉语言文学、中国历史、中国哲学、中医和太极文化',
    'Направления включают международное преподавание китайского языка, китайский язык и литературу, историю Китая, китайскую философию, китайскую медицину и тайцзи',
  ),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180 for language/history/philosophy directions; HSK score required for TCM and Taiji' },
    { test: 'other', minimum: 'HSKK required for language/history/philosophy directions; preferred for TCM and Taiji' },
  ],
  route: localized(
    'Submit through the central portal and the ZCMU application system. The host review deadline is November 10, 2026.',
    '须通过中央系统和浙江中医药大学申请系统提交；接收院校审核截止日期为2026年11月10日。',
    'Заявка подаётся через центральную и университетскую системы; проверка принимающим вузом завершается 10 ноября 2026 года.',
  ),
  scholarshipSummary: localized(
    'Coverage includes tuition, accommodation, living allowance and medical insurance; no list-price tuition or application fee is inferred.',
    '资助包括学费、住宿、生活费和医疗保险；本记录不推断标价学费或申请费。',
    'Покрытие включает обучение, проживание, пособие и медицинскую страховку; прейскурантная стоимость и сбор не выводятся.',
  ),
})

const shutcm = createIclt({
  key: 'shutcm-iclt-one-semester-spring-2027',
  universityId: 'uni-shanghai-university-of-traditional-chinese-medicine',
  sourceId: 'src-shutcm-iclt-2026',
  school: localized(
    'Shanghai University of Traditional Chinese Medicine',
    '上海中医药大学',
    'Шанхайском университете традиционной китайской медицины',
  ),
  programUrl: 'https://iec.shutcm.edu.cn/gjzwjsjxjxm/list.htm',
  direction: localized(
    'Directions include Chinese Language and Literature and Traditional Chinese Medicine',
    '方向包括汉语言文学和中医',
    'Направления включают китайский язык и литературу и традиционную китайскую медицину',
  ),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180 for Chinese Language and Literature; HSK score required for TCM' },
    { test: 'other', minimum: 'HSKK required for Chinese Language and Literature; preferred for TCM' },
  ],
  route: localized(
    'Submit through the central portal and the SHUTCM application system. Group-only four-week routes are excluded.',
    '须通过中央系统和上海中医药大学申请系统提交；仅接受团体申请的四周项目已排除。',
    'Заявка подаётся через центральную и университетскую системы; групповые четырёхнедельные маршруты исключены.',
  ),
  scholarshipSummary: localized(
    'The official scholarship standard covers tuition, accommodation, living allowance and medical insurance.',
    '官方奖学金标准覆盖学费、住宿、生活费和医疗保险。',
    'Официальный стандарт покрывает обучение, проживание, пособие и медицинскую страховку.',
  ),
})

const neu = createIclt({
  key: 'neu-iclt-one-semester-spring-2027',
  universityId: 'uni-northeastern-university-china',
  sourceId: 'src-neu-iclt-2026',
  school: localized(
    'Northeastern University',
    '东北大学',
    'Северо-Восточном университете',
  ),
  programUrl: 'https://studyinneu.neu.edu.cn/html/article_content/202603/C7259436AAA44266BC8D502AA5E58E50.shtml',
  direction: localized(
    'One-semester international Chinese-language study',
    '一学期国际中文研修',
    'Семестровая программа китайского языка',
  ),
  languageRequirements: [
    { test: 'other', minimum: 'Official Chinese and English versions conflict; confirm the required HSK score with NEU' },
  ],
  route: localized(
    'Apply through the central scholarship portal; the NEU guide states that a separate NEU application is not required at the application stage. The Chinese table and English text conflict on the HSK score, so no score is published here.',
    '通过奖学金中央系统申请；东北大学指南明确申请阶段无需另行在校内系统报名。中文表格与英文正文的HSK分数冲突，因此本记录不发布具体分数。',
    'Заявка подаётся через центральный портал; отдельная заявка NEU на этом этапе не требуется. Китайская таблица и английский текст расходятся по баллу HSK, поэтому число не публикуется.',
  ),
  scholarshipSummary: localized(
    'Coverage includes tuition, a free shared room or approved CNY 700 monthly off-campus subsidy, a CNY 2,500 monthly allowance and CNY 400 semester insurance.',
    '资助包括学费、免费双人间或经批准的每月700元校外住宿补贴、每月2,500元生活费和每学期400元保险。',
    'Покрытие включает обучение, бесплатную комнату или 700 юаней в месяц на внешнее жильё, пособие 2 500 юаней и страховку 400 юаней за семестр.',
  ),
})

const hust = createIclt({
  key: 'hust-iclt-one-semester-spring-2027',
  universityId: 'uni-huazhong-university-of-science-and-technology',
  sourceId: 'src-hust-iclt-2026',
  school: localized(
    'Huazhong University of Science and Technology',
    '华中科技大学',
    'Хуачжунском университете науки и технологий',
  ),
  programUrl: 'https://iso.hust.edu.cn/info/1194/4957.htm',
  direction: localized(
    'One-semester Chinese-language study',
    '一学期中文研修',
    'Семестровая программа китайского языка',
  ),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180' },
    { test: 'other', minimum: 'HSKK required' },
  ],
  route: localized(
    'Submit through the central portal and the HUST international application system, including the scholarship form as proof for the registration-payment item. The ordinary CNY 600 self-funded fee is not copied to this route.',
    '须通过中央系统和华中科技大学国际申请系统提交，并将奖学金申请表作为注册付款项证明上传；普通自费项目600元申请费不套用于本路线。',
    'Заявка подаётся через центральную и университетскую системы с формой стипендии как подтверждением оплаты регистрации; сбор 600 юаней обычной платной программы не переносится.',
  ),
  scholarshipSummary: localized(
    'The official route covers tuition, accommodation, living allowance and medical insurance; list-price tuition and an application fee remain unannounced.',
    '官方路线覆盖学费、住宿、生活费和医疗保险；标价学费和申请费仍未公布。',
    'Официальный маршрут покрывает обучение, проживание, пособие и медицинскую страховку; прейскурантная стоимость и сбор не объявлены.',
  ),
})

const groups = [sisu, tjnu, zcmu, shutcm, neu, hust]

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
  writeJson('universities.json', updated.universities)
  writeJson('programs.json', updated.programs)
  writeJson('admission-cycles.json', updated.admissionCycles)
  writeJson('scholarships.json', updated.scholarships)

  console.log(JSON.stringify({
    sources: updated.sources.length,
    universities: updated.universities.length,
    programs: updated.programs.length,
    admissionCycles: updated.admissionCycles.length,
    scholarships: updated.scholarships.length,
    newUniversities: universities.length,
    newPrograms: groups.length,
    newScholarships: groups.length,
  }, null, 2))
}

apply()
