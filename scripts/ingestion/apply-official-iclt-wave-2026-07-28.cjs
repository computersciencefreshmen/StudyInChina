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
    id: 'src-hznu-iclt-2026',
    url: 'https://gjjyxy.hznu.edu.cn/c/2026-03-01/2996148.shtml',
    title: 'Hangzhou Normal University International Chinese Language Teachers Scholarship 2026',
    publisher: 'Hangzhou Normal University',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-sjtu-iclt-2026',
    url: 'https://isc.sjtu.edu.cn/kindeditor/Upload/file/20260325/20260325161952_0808.pdf',
    title: 'Shanghai Jiao Tong University International Chinese Language Teachers Scholarship 2026',
    publisher: 'Shanghai Jiao Tong University',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-hunnu-iclt-2026',
    url: 'https://oiec.hunnu.edu.cn/info/1061/4240.htm',
    title: 'Hunan Normal University International Chinese Language Teachers Scholarship 2026',
    publisher: 'Hunan Normal University',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-imnu-iclt-2026',
    url: 'https://gjjl.imnu.edu.cn/info/1065/5164.htm',
    title: 'Inner Mongolia Normal University International Chinese Language Teachers Scholarship 2026',
    publisher: 'Inner Mongolia Normal University',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-bfsu-beijing-government-scholarship',
    url: 'https://osao.bfsu.edu.cn/info/2472/6842.htm',
    title: 'Beijing Government Scholarship for International Students at BFSU',
    publisher: 'Beijing Foreign Studies University',
    kind: 'scholarship',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
]

const universities = [
  {
    sourceIds: ['src-hznu-iclt-2026'],
    verifiedAt: VERIFIED_AT,
    reviewAfter: PROFILE_REVIEW_AFTER,
    status: 'verified',
    id: 'uni-hangzhou-normal-university',
    slug: 'hangzhou-normal-university',
    name: localized(
      'Hangzhou Normal University',
      '杭州师范大学',
      'Ханчжоуский педагогический университет',
    ),
    cityId: 'city-hangzhou',
    region: 'east',
    officialUrl: 'https://www.hznu.edu.cn/',
    admissionsUrl: 'https://gjjyxy.hznu.edu.cn/',
    summary: localized(
      'Hangzhou Normal University publishes a verified Spring 2027 scholarship route for individual international applicants.',
      '杭州师范大学已发布面向国际个人申请人的2027年春季奖学金研修项目。',
      'Ханчжоуский педагогический университет опубликовал подтверждённый стипендиальный маршрут на весну 2027 года для иностранных заявителей.',
    ),
    featured: false,
  },
  {
    sourceIds: ['src-imnu-iclt-2026'],
    verifiedAt: VERIFIED_AT,
    reviewAfter: PROFILE_REVIEW_AFTER,
    status: 'verified',
    id: 'uni-inner-mongolia-normal-university',
    slug: 'inner-mongolia-normal-university',
    name: localized(
      'Inner Mongolia Normal University',
      '内蒙古师范大学',
      'Педагогический университет Внутренней Монголии',
    ),
    cityId: 'city-hohhot',
    region: 'north',
    officialUrl: 'https://www.imnu.edu.cn/',
    admissionsUrl: 'https://gjjl.imnu.edu.cn/',
    summary: localized(
      'Inner Mongolia Normal University publishes a verified Spring 2027 Chinese-language and tourism-management scholarship study route.',
      '内蒙古师范大学已发布可核验的2027年春季“汉语+旅游管理”奖学金研修项目。',
      'Педагогический университет Внутренней Монголии опубликовал подтверждённую стипендиальную программу «китайский язык + управление туризмом» на весну 2027 года.',
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

function icltRecord({
  key,
  universityId,
  sourceId,
  school,
  programUrl,
  applyUrl = ICLT_PORTAL,
  direction,
  languageRequirements,
  routeNote,
  accommodation = 'full',
  stipendCnyPerMonth = null,
  scholarshipSummary,
}) {
  const programId = `program-${key}`
  const sourceIds = [sourceId, ICLT_STANDARD_SOURCE_ID]

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
      applyUrl,
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
        `${direction.en}. ${routeNote.en}`,
        `${direction.zh}。${routeNote.zh}`,
        `${direction.ru}. ${routeNote.ru}`,
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

const hznu = icltRecord({
  key: 'hznu-iclt-one-semester-spring-2027',
  universityId: 'uni-hangzhou-normal-university',
  sourceId: 'src-hznu-iclt-2026',
  school: localized(
    'Hangzhou Normal University',
    '杭州师范大学',
    'Ханчжоуском педагогическом университете',
  ),
  programUrl: 'https://gjjyxy.hznu.edu.cn/c/2026-03-01/2996148.shtml',
  direction: localized(
    'Directions include International Chinese Language Education, Chinese Language and Literature, Chinese History and Chinese Philosophy',
    '方向包括国际中文教育、汉语言文学、中国历史和中国哲学',
    'Направления включают международное преподавание китайского языка, китайский язык и литературу, историю Китая и китайскую философию',
  ),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180' },
    { test: 'other', minimum: 'HSKK required' },
  ],
  routeNote: localized(
    'Apply through the central scholarship portal and select Hangzhou Normal University. The page does not state a list-price tuition, application fee or exact living-allowance amount.',
    '通过奖学金中央系统申请并选择杭州师范大学；页面未公布标价学费、申请费和生活费具体金额。',
    'Заявка подаётся через центральный портал с выбором университета; прейскурантная стоимость, сбор и точная сумма пособия не указаны.',
  ),
  scholarshipSummary: localized(
    'The official route covers tuition, accommodation, living allowance and medical insurance; the school page does not state the cash amount.',
    '官方路线覆盖学费、住宿、生活费和医疗保险；学校页面未公布生活费具体金额。',
    'Официальный маршрут покрывает обучение, проживание, пособие и медицинскую страховку; точная сумма выплаты не указана.',
  ),
})

const sjtu = icltRecord({
  key: 'sjtu-iclt-one-semester-spring-2027',
  universityId: 'uni-shanghai-jiao-tong-university',
  sourceId: 'src-sjtu-iclt-2026',
  school: localized(
    'Shanghai Jiao Tong University',
    '上海交通大学',
    'Шанхайском университете Цзяотун',
  ),
  programUrl: 'https://isc.sjtu.edu.cn/kindeditor/Upload/file/20260325/20260325161952_0808.pdf',
  direction: localized(
    'One-semester Chinese Language and Literature study',
    '一学期汉语言文学研修',
    'Семестровая программа по китайскому языку и литературе',
  ),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180' },
    { test: 'other', minimum: 'HSKK required' },
  ],
  routeNote: localized(
    'Apply through the central scholarship portal; one-semester applicants complete the university nomination step after preliminary review.',
    '通过奖学金中央系统申请；一学期申请人通过学校初审后按通知完成校方提名步骤。',
    'Заявка подаётся через центральный портал; после предварительной проверки кандидат завершает этап университетской номинации.',
  ),
  accommodation: 'partial',
  stipendCnyPerMonth: 2500,
  scholarshipSummary: localized(
    'Coverage includes full tuition, a CNY 1,100 monthly accommodation subsidy, a CNY 2,500 monthly allowance and CNY 400 semester medical insurance.',
    '资助包括全额学费、每月1,100元住宿补贴、每月2,500元生活费及每学期400元医疗保险。',
    'Покрытие включает полную оплату обучения, 1 100 юаней в месяц на проживание, 2 500 юаней ежемесячного пособия и 400 юаней на медицинскую страховку за семестр.',
  ),
})

const hunnu = icltRecord({
  key: 'hunnu-iclt-one-semester-spring-2027',
  universityId: 'uni-hunan-normal-university',
  sourceId: 'src-hunnu-iclt-2026',
  school: localized(
    'Hunan Normal University',
    '湖南师范大学',
    'Хунаньском педагогическом университете',
  ),
  programUrl: 'https://oiec.hunnu.edu.cn/info/1061/4240.htm',
  applyUrl: 'https://hunnu.at0086.cn/student',
  direction: localized(
    'One-semester International Chinese Language Education study',
    '一学期国际中文教育研修',
    'Семестровая программа по международному преподаванию китайского языка',
  ),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180' },
    { test: 'other', minimum: 'HSKK required' },
  ],
  routeNote: localized(
    'Submit in both the central portal and the Hunan Normal University system, including a Chinese or English introduction video of no more than five minutes.',
    '须同时在中央系统和湖南师范大学系统提交，并上传不超过5分钟的中／英文自我介绍视频。',
    'Заявка подаётся в центральной и университетской системах; требуется видео-представление на китайском или английском длительностью до пяти минут.',
  ),
  scholarshipSummary: localized(
    'The route covers full tuition, on-campus accommodation, living allowance and medical insurance; the school page does not state the allowance amount.',
    '该路线覆盖全额学费、校内住宿、生活费和医疗保险；学校页面未公布生活费具体金额。',
    'Маршрут покрывает обучение, проживание в кампусе, пособие и медицинскую страховку; точная сумма пособия не указана.',
  ),
})

const imnu = icltRecord({
  key: 'imnu-chinese-tourism-management-spring-2027',
  universityId: 'uni-inner-mongolia-normal-university',
  sourceId: 'src-imnu-iclt-2026',
  school: localized(
    'Inner Mongolia Normal University',
    '内蒙古师范大学',
    'Педагогическом университете Внутренней Монголии',
  ),
  programUrl: 'https://gjjl.imnu.edu.cn/info/1065/5164.htm',
  direction: localized(
    'Chinese Language plus Tourism Management is one integrated study direction',
    '“汉语+旅游管理”为一个完整研修方向',
    '«Китайский язык + управление туризмом» является единым направлением обучения',
  ),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180' },
    { test: 'other', minimum: 'HSKK required' },
  ],
  routeNote: localized(
    'Apply through the central scholarship portal. The receiving institution review deadline is November 10, 2026.',
    '通过奖学金中央系统申请；接收院校审核截止日期为2026年11月10日。',
    'Заявка подаётся через центральный портал; проверка принимающим вузом завершается 10 ноября 2026 года.',
  ),
  stipendCnyPerMonth: 2500,
  scholarshipSummary: localized(
    'Coverage includes full tuition, on-campus accommodation or an approved CNY 700 monthly off-campus subsidy, a CNY 2,500 monthly allowance and CNY 400 medical insurance.',
    '资助包括全额学费、校内住宿或经批准的每月700元校外住宿补贴、每月2,500元生活费及400元医疗保险。',
    'Покрытие включает обучение, кампусное проживание или одобренную выплату 700 юаней в месяц, пособие 2 500 юаней и медицинскую страховку 400 юаней.',
  ),
})

const bfsuBeijingGovernment = audited({
  sourceIds: ['src-bfsu-beijing-government-scholarship'],
  id: 'scholarship-bfsu-beijing-government-annual',
  slug: 'bfsu-beijing-government-annual',
  name: localized(
    'Beijing Government Scholarship for International Students at BFSU',
    '北京外国语大学北京市外国留学生奖学金',
    'Стипендия правительства Пекина для иностранных студентов в BFSU',
  ),
  providerType: 'city',
  universityIds: ['uni-beijing-foreign-studies-university'],
  programIds: [],
  coverage: {
    tuition: 'unknown',
    accommodation: 'unknown',
    insurance: 'unknown',
    stipendCnyPerMonth: null,
  },
  deadline: null,
  applicationUrl: 'https://study.bfsu.edu.cn/',
  summary: localized(
    'The official recurring rule sets November 30 as the spring-intake deadline. Award A covers tuition, accommodation, living allowance and insurance; B omits living allowance; C covers tuition and insurance. Bachelor’s, master’s and non-degree recipients are normally limited to C, so no single tier is promised here.',
    '官方年度规则规定春季入学截止日期为11月30日。A类覆盖学费、住宿、生活费和保险，B类不含生活费，C类覆盖学费和保险；本科、硕士及非学历获奖者原则上仅授予C类，因此本记录不承诺单一资助档位。',
    'Ежегодное правило устанавливает 30 ноября как срок для весеннего набора. Категория A покрывает обучение, проживание, пособие и страховку; B — без пособия; C — обучение и страховку. Бакалавры, магистры и слушатели обычно получают только C, поэтому конкретная категория не обещается.',
  ),
})

const groups = [hznu, sjtu, hunnu, imnu]
const programs = groups.map((group) => group.program)
const cycles = groups.map((group) => group.cycle)
const scholarships = [
  ...groups.map((group) => group.scholarship),
  bfsuBeijingGovernment,
]

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
    programs: upsertById(readJson('programs.json'), programs),
    admissionCycles: upsertById(readJson('admission-cycles.json'), cycles),
    scholarships: upsertById(readJson('scholarships.json'), scholarships),
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
    newPrograms: programs.length,
    newScholarships: scholarships.length,
  }, null, 2))
}

apply()
