const fs = require('node:fs')
const path = require('node:path')

const DATA_DIR = path.join(process.cwd(), 'content', 'data')
const VERIFIED_AT = '2026-07-28'
const DYNAMIC_REVIEW_AFTER = '2026-08-27'
const PROFILE_REVIEW_AFTER = '2027-01-24'
const ICLT_PORTAL = 'https://pmplatform.chinese.cn/ui/start/#/login'
const ICLT_STANDARD_URL =
  'https://pmplatform.chinese.cn/tmp/2026/2/6/94005b2e-f2e9-438e-85e7-12212f0e9968.pdf'

const localized = (en, zh, ru) => ({ en, zh, ru })

const sources = [
  {
    id: 'src-urumqi-government',
    url: 'https://www.urumqi.gov.cn/wlmqs/c119048/sq.shtml',
    title: 'Urumqi City Profile',
    publisher: 'Urumqi Municipal People’s Government',
    kind: 'city',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-xju-university-profile',
    url: 'https://www.xju.edu.cn/xxgk/xdjj.htm',
    title: 'Xinjiang University Profile',
    publisher: 'Xinjiang University',
    kind: 'university',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-snnu-university',
    url: 'https://www.snnu.edu.cn/',
    title: 'Shaanxi Normal University',
    publisher: 'Shaanxi Normal University',
    kind: 'university',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-blcu-university',
    url: 'https://www.blcu.edu.cn/',
    title: 'Beijing Language University',
    publisher: 'Beijing Language University',
    kind: 'university',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-clec-iclt-2026-standard',
    url: ICLT_STANDARD_URL,
    title: '2026 International Chinese Language Teachers Scholarship Application Guidelines',
    publisher: 'Center for Language Education and Cooperation',
    kind: 'government',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-xmu-long-term-chinese-2026-2027',
    url: 'https://oec.xmu.edu.cn/en/Program1/Chinese_Language_Programs.htm',
    title: 'Admissions Guide for the Long-Term Chinese Language Program in 2026–2027',
    publisher: 'Xiamen University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-xmu-iclt-2026',
    url: 'https://admissions.xmu.edu.cn/info/1061/4020.htm',
    title: 'International Chinese Language Teachers Scholarship 2026, Xiamen University',
    publisher: 'Xiamen University',
    kind: 'scholarship',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-dhu-winter-chinese-2027',
    url: 'https://english.dhu.edu.cn/_t1264/2021/0702/c5220a369798/page.psp',
    title: '2027 Winter Chinese Program',
    publisher: 'Donghua University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-dhu-iclt-2026',
    url: 'https://english.dhu.edu.cn/_t1264/2021/0119/c5221a273256/page.psp',
    title: 'International Chinese Language Teachers Scholarship Application Guide',
    publisher: 'Donghua University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-shu-iclt-2026',
    url: 'https://apply.shu.edu.cn/upload/shangda/2/c/0/Application%20Guide%20for%20International%20Chinese%20Language%20Teachers%20Scholarship%20of%20Shanghai%20University%202026.pdf',
    title: 'International Chinese Language Teachers Scholarship of Shanghai University 2026',
    publisher: 'Shanghai University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-xju-iclt-2026',
    url: 'https://gjjl.xju.edu.cn/info/1015/2558.htm',
    title: 'Xinjiang University International Chinese Language Teachers Scholarship 2026',
    publisher: 'Xinjiang University',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-snnu-iclt-2026',
    url: 'https://study.snnu.edu.cn/info/1066/1238.htm',
    title: 'Shaanxi Normal University International Chinese Language Teachers Scholarship 2026',
    publisher: 'Shaanxi Normal University',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-blcu-iclt-2026',
    url: 'https://admission.blcu.edu.cn/en/2026/0303/c1148a3044/page.htm',
    title: '2026 BLCU International Chinese Language Teachers Scholarship Application Guide',
    publisher: 'Beijing Language University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-bfsu-chinese-training',
    url: 'https://osao.bfsu.edu.cn/info/2832/5592.htm',
    title: 'BFSU Chinese Training Programs',
    publisher: 'Beijing Foreign Studies University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-bfsu-iclt-2026',
    url: 'https://osao.bfsu.edu.cn/info/2462/6812.htm',
    title: 'BFSU International Chinese Language Teachers Scholarship 2026',
    publisher: 'Beijing Foreign Studies University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-uibe-international-foundation',
    url: 'https://sie.uibe.edu.cn/en/Prgr/FouCouBacProCh/FouCouBacProChiSelf/cf60f17e393347278a43068323179bd3.htm',
    title: 'UIBE International Foundation Program for International Students',
    publisher: 'University of International Business and Economics',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-tju-iclt-2026',
    url: 'https://sie.tju.edu.cn/en/jxj/ChineseLanguageTeachers/202602/t20260206_324551.html',
    title: 'Tianjin University International Chinese Language Teachers Scholarship 2026',
    publisher: 'Tianjin University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
  {
    id: 'src-nankai-iclt-2026',
    url: 'https://ensie.nankai.edu.cn/info/1043/1317.htm',
    title: 'International Chinese Language Teachers Scholarship of Nankai University 2026',
    publisher: 'Nankai University',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: VERIFIED_AT,
  },
]

const cities = [
  {
    sourceIds: ['src-urumqi-government'],
    verifiedAt: VERIFIED_AT,
    reviewAfter: PROFILE_REVIEW_AFTER,
    status: 'verified',
    id: 'city-urumqi',
    slug: 'urumqi',
    name: localized('Urumqi', '乌鲁木齐', 'Урумчи'),
    province: localized(
      'Xinjiang Uyghur Autonomous Region',
      '新疆维吾尔自治区',
      'Синьцзян-Уйгурский автономный район',
    ),
    region: 'northwest',
    coordinates: { lat: 43.8256, lng: 87.6168 },
    overview: localized(
      'The capital of Xinjiang and a major education, transport and trade centre connecting China with Central Asia.',
      '新疆维吾尔自治区首府，是连接中国与中亚的重要教育、交通和商贸中心。',
      'Столица Синьцзяна и важный образовательный, транспортный и торговый центр на направлении к Центральной Азии.',
    ),
    climate: localized(
      'A dry continental climate with warm summers, cold winters and large seasonal temperature differences.',
      '温带大陆性干旱气候，夏季温暖、冬季寒冷，季节温差较大。',
      'Сухой континентальный климат с тёплым летом, холодной зимой и значительными сезонными перепадами температуры.',
    ),
    foodHighlights: [
      localized('Xinjiang pilaf', '新疆抓饭', 'Синьцзянский плов'),
      localized('Lamb kebabs', '羊肉串', 'Шашлык из баранины'),
    ],
    sights: [
      localized('Xinjiang Regional Museum', '新疆维吾尔自治区博物馆', 'Музей Синьцзян-Уйгурского автономного района'),
      localized('Red Hill Park', '红山公园', 'Парк Красная гора'),
    ],
  },
]

const universities = [
  {
    sourceIds: ['src-xju-university-profile', 'src-xju-iclt-2026'],
    verifiedAt: VERIFIED_AT,
    reviewAfter: PROFILE_REVIEW_AFTER,
    status: 'verified',
    id: 'uni-xinjiang-university',
    slug: 'xinjiang-university',
    name: localized('Xinjiang University', '新疆大学', 'Синьцзянский университет'),
    cityId: 'city-urumqi',
    region: 'northwest',
    officialUrl: 'https://www.xju.edu.cn/',
    admissionsUrl: 'https://gjjl.xju.edu.cn/',
    summary: localized(
      'Xinjiang University publishes a dedicated international admissions site and a verified Spring 2027 scholarship study route.',
      '新疆大学设有国际学生招生官网，并已发布可核验的2027年春季奖学金研修项目。',
      'Синьцзянский университет ведёт официальный сайт международного приёма и опубликовал проверяемую стипендиальную программу на весну 2027 года.',
    ),
    featured: false,
  },
  {
    sourceIds: ['src-snnu-university', 'src-snnu-iclt-2026'],
    verifiedAt: VERIFIED_AT,
    reviewAfter: PROFILE_REVIEW_AFTER,
    status: 'verified',
    id: 'uni-shaanxi-normal-university',
    slug: 'shaanxi-normal-university',
    name: localized('Shaanxi Normal University', '陕西师范大学', 'Шэньсийский педагогический университет'),
    cityId: 'city-xian',
    region: 'northwest',
    officialUrl: 'https://www.snnu.edu.cn/',
    admissionsUrl: 'https://study.snnu.edu.cn/en/',
    summary: localized(
      'Shaanxi Normal University publishes official international admissions and a verified Spring 2027 Chinese-language scholarship route.',
      '陕西师范大学发布国际学生官方招生信息，并提供可核验的2027年春季中文研修奖学金申请路线。',
      'Шэньсийский педагогический университет публикует официальную информацию для иностранных абитуриентов и подтверждённый стипендиальный маршрут на весну 2027 года.',
    ),
    featured: false,
  },
  {
    sourceIds: ['src-blcu-university', 'src-blcu-iclt-2026'],
    verifiedAt: VERIFIED_AT,
    reviewAfter: PROFILE_REVIEW_AFTER,
    status: 'verified',
    id: 'uni-beijing-language-university',
    slug: 'beijing-language-university',
    name: localized('Beijing Language University', '北京语言大学', 'Пекинский университет языка и культуры'),
    cityId: 'city-beijing',
    region: 'north',
    officialUrl: 'https://www.blcu.edu.cn/',
    admissionsUrl: 'https://admission.blcu.edu.cn/en/',
    summary: localized(
      'Beijing Language University specialises in language education and publishes a verified Spring 2027 scholarship study route for international applicants.',
      '北京语言大学以语言教育见长，并已发布面向国际申请人的2027年春季奖学金研修项目。',
      'Пекинский университет языка и культуры специализируется на языковом образовании и опубликовал проверяемую стипендиальную программу на весну 2027 года.',
    ),
    featured: false,
  },
]

function audited(record) {
  return {
    sourceIds: record.sourceIds,
    verifiedAt: VERIFIED_AT,
    reviewAfter: DYNAMIC_REVIEW_AFTER,
    status: 'verified',
    ...record,
  }
}

function icltProgram({
  id,
  universityId,
  sourceId,
  programUrl,
  applyUrl,
  school,
  teachingLanguages = [],
  languageRequirements,
  directions,
  extraNotes,
  applicationFeeCny = null,
  opensOn = null,
  closesOn = '2026-10-31',
}) {
  const name = localized(
    'International Chinese Language Teachers Scholarship — One-Semester Study (Spring 2027)',
    '国际中文教师奖学金一学期研修项目（2027年春季）',
    'Семестровая программа стипендии для преподавателей китайского языка (весна 2027)',
  )
  return {
    program: audited({
      sourceIds: [sourceId, 'src-clec-iclt-2026-standard'],
      id,
      slug: id.replace(/^program-/, ''),
      universityId,
      name,
      degreeLevel: 'language',
      discipline: 'chinese-education',
      teachingLanguages,
      durationMonths: 5,
      programUrl,
      applyUrl,
      languageRequirements,
      verificationScope: 'facts',
    }),
    cycle: audited({
      sourceIds: [sourceId, 'src-clec-iclt-2026-standard'],
      id: `cycle-${id.replace(/^program-/, '')}`,
      programId: id,
      academicYear: '2026-2027',
      intake: 'spring',
      opensOn,
      closesOn,
      dateStatus: 'published',
      tuitionCny: null,
      tuitionPeriod: null,
      tuitionStatus: null,
      evidenceBasis: 'cycle-specific',
      factScope: applicationFeeCny === null ? 'dates-only' : 'partial',
      applicationFeeCny,
      notes: localized(
        `${directions.en}. ${extraNotes.en}`,
        `${directions.zh}。${extraNotes.zh}`,
        `${directions.ru}. ${extraNotes.ru}`,
      ),
    }),
    scholarship: audited({
      sourceIds: [sourceId, 'src-clec-iclt-2026-standard'],
      id: `scholarship-${id.replace(/^program-/, '')}`,
      slug: id.replace(/^program-/, ''),
      name: localized(
        `International Chinese Language Teachers Scholarship at ${school.en} — Spring 2027`,
        `${school.zh}国际中文教师奖学金（2027年春季）`,
        `Стипендия для преподавателей китайского языка в ${school.ru} — весна 2027`,
      ),
      providerType: 'other',
      universityIds: [universityId],
      programIds: [id],
      coverage: {
        tuition: 'full',
        accommodation: 'full',
        insurance: true,
        stipendCnyPerMonth: 2500,
      },
      deadline: closesOn,
      applicationUrl: ICLT_PORTAL,
      summary: localized(
        `The verified Spring 2027 route covers tuition, accommodation, a CNY 2,500 monthly allowance and medical insurance. A recommending institution is required; follow the ${school.en} guide for any second application system.`,
        '经核验的2027年春季申请路线覆盖学费、住宿、每月2,500元生活费和医疗保险。申请人须通过推荐机构，并按学校简章完成可能要求的第二报名系统。',
        'Проверенный маршрут на весну 2027 года покрывает обучение, проживание, ежемесячную выплату 2 500 юаней и медицинскую страховку. Требуется рекомендующая организация; при необходимости нужно также подать заявку в системе вуза.',
      ),
    }),
  }
}

const xmuProgramId = 'program-xmu-long-term-chinese-language-spring-2027'
const xmuProgram = audited({
  sourceIds: ['src-xmu-long-term-chinese-2026-2027'],
  id: xmuProgramId,
  slug: 'xmu-long-term-chinese-language-spring-2027',
  universityId: 'uni-xiamen-university',
  name: localized(
    'Long-Term Chinese Language Program — Spring 2027',
    '长期汉语进修项目（2027年春季）',
    'Долгосрочная программа китайского языка — весна 2027',
  ),
  degreeLevel: 'language',
  discipline: 'chinese-education',
  teachingLanguages: ['Chinese'],
  durationMonths: 5,
  programUrl: 'https://oec.xmu.edu.cn/en/Program1/Chinese_Language_Programs.htm',
  applyUrl: 'https://mcc.xmu.edu.cn/login.aspx',
  languageRequirements: [
    { test: 'other', minimum: 'No HSK minimum; placement is based on Chinese proficiency' },
  ],
  verificationScope: 'complete',
  details: {
    faculty: localized(
      'Chinese International Education College / Overseas Education College',
      '国际中文教育学院／海外教育学院',
      'Институт международного образования на китайском языке / Институт зарубежного образования',
    ),
    overview: localized(
      'A full-time semester for beginning, intermediate and advanced learners, with 18–24 class hours each week.',
      '面向初级、中级和高级学习者的全日制学期项目，每周约18至24课时。',
      'Очная семестровая программа для начального, среднего и продвинутого уровней с нагрузкой 18–24 часа в неделю.',
    ),
    qualification: localized(
      'Xiamen University Certificate of Completion in Continuing Education and transcript',
      '厦门大学继续教育结业证书和成绩单',
      'Сертификат Сямэньского университета о завершении программы и ведомость оценок',
    ),
    studyMode: 'full-time',
    languagePolicy: localized(
      'Chinese proficiency is assessed for class placement; the official guide states no minimum HSK score.',
      '学校根据汉语水平分班；官方简章未设置最低HSK分数。',
      'Распределение по группам проводится по уровню китайского языка; минимальный балл HSK в официальном руководстве не установлен.',
    ),
    curriculumHighlights: [
      localized(
        'Intensive Chinese, oral Chinese, listening, reading and writing',
        '综合汉语、汉语口语、听力、阅读和写作',
        'Интенсивный китайский, устная речь, аудирование, чтение и письмо',
      ),
      localized(
        'HSK tutoring and electives in culture, history, arts and translation',
        'HSK辅导及文化、历史、艺术和翻译类选修课',
        'Подготовка к HSK и курсы по культуре, истории, искусству и переводу',
      ),
    ],
    eligibility: [
      localized(
        'Non-Chinese citizens, including overseas Chinese, aged 18–55 and in good physical and mental health',
        '18至55周岁、身心健康的非中国籍申请人（含华侨华人）',
        'Иностранные граждане, включая зарубежных китайцев, в возрасте 18–55 лет и в хорошем физическом и психическом состоянии',
      ),
      localized(
        'High-school diploma or equivalent',
        '高中毕业或同等学历',
        'Аттестат о среднем образовании или эквивалент',
      ),
    ],
    applicationMaterials: [
      localized(
        'ID photo, valid passport scan and birth certificate',
        '证件照、有效护照扫描件和出生证明',
        'Фото, скан действующего паспорта и свидетельство о рождении',
      ),
      localized(
        'Highest diploma and transcripts with Chinese or English notarised translations where required',
        '最高学历证明和成绩单，必要时附中文或英文公证译件',
        'Документ о высшем образовании и выписка оценок с нотариальным переводом на китайский или английский при необходимости',
      ),
      localized(
        'Physical examination, financial guarantee and a criminal-record certificate',
        '体检材料、经济担保证明和无犯罪记录证明',
        'Медицинская справка, финансовая гарантия и справка об отсутствии судимости',
      ),
    ],
    campus: localized('Xiang’an Campus', '翔安校区', 'Кампус Сянъань'),
  },
})

const xmuCycle = audited({
  sourceIds: ['src-xmu-long-term-chinese-2026-2027'],
  id: 'cycle-xmu-long-term-chinese-language-spring-2027',
  programId: xmuProgramId,
  academicYear: '2026-2027',
  intake: 'spring',
  opensOn: null,
  closesOn: '2026-12-30',
  dateStatus: 'published',
  tuitionCny: 13000,
  tuitionPeriod: 'semester',
  tuitionStatus: 'confirmed',
  evidenceBasis: 'cycle-specific',
  factScope: 'complete',
  applicationFeeCny: 400,
  notes: localized(
    'Study runs from February to June 2027. The CNY 400 new-student enrolment/application fee is non-refundable. On-campus accommodation is not provided. HSK is submitted only if already held.',
    '学习时间为2027年2月至6月。新生400元报名／申请费不退；该项目不提供校内住宿。HSK证书仅在已取得时提交，不是最低门槛。',
    'Обучение проходит с февраля по июнь 2027 года. Регистрационный сбор для новых студентов 400 юаней не возвращается; общежитие не предоставляется. Сертификат HSK подаётся только при наличии.',
  ),
})

const xmuScholarship = audited({
  sourceIds: ['src-xmu-iclt-2026', 'src-clec-iclt-2026-standard'],
  id: 'scholarship-xmu-iclt-one-semester-spring-2027',
  slug: 'xmu-iclt-one-semester-spring-2027',
  name: localized(
    'International Chinese Language Teachers Scholarship at Xiamen University — Spring 2027',
    '厦门大学国际中文教师奖学金（2027年春季一学期研修）',
    'Стипендия для преподавателей китайского языка в Сямэньском университете — весна 2027',
  ),
  providerType: 'other',
  universityIds: ['uni-xiamen-university'],
  programIds: [xmuProgramId],
  coverage: {
    tuition: 'full',
    accommodation: 'full',
    insurance: true,
    stipendCnyPerMonth: 2500,
  },
  deadline: '2026-10-31',
  applicationUrl: ICLT_PORTAL,
  summary: localized(
    'For International Chinese Language Education, applicants need HSK Level 3 with at least 180 points and an HSKK score. The award lasts up to five months and requires a recommending institution; the host review deadline is November 10, 2026.',
    '国际中文教育方向要求HSK三级至少180分并具有HSKK成绩。资助期限最长5个月，须通过推荐机构申请；学校和推荐机构审核截止为2026年11月10日。',
    'Для направления международного преподавания китайского требуется HSK 3 не менее 180 баллов и результат HSKK. Срок финансирования — до пяти месяцев; требуется рекомендующая организация, срок проверки — 10 ноября 2026 года.',
  ),
})

const dhuWinterId = 'program-dhu-winter-chinese-2027'
const dhuWinterProgram = audited({
  sourceIds: ['src-dhu-winter-chinese-2027'],
  id: dhuWinterId,
  slug: 'dhu-winter-chinese-2027',
  universityId: 'uni-donghua-university',
  name: localized(
    '2027 Winter Chinese Program',
    '2027年冬季汉语项目',
    'Зимняя программа китайского языка 2027',
  ),
  degreeLevel: 'language',
  discipline: 'chinese-education',
  teachingLanguages: ['Chinese'],
  durationMonths: 1,
  programUrl: 'https://english.dhu.edu.cn/_t1264/2021/0702/c5220a369798/page.psp',
  applyUrl: 'https://admissions.dhu.edu.cn/index',
  languageRequirements: [
    { test: 'other', minimum: 'No prior Chinese level required; classes start from beginner' },
  ],
  verificationScope: 'facts',
})

const dhuWinterCycle = audited({
  sourceIds: ['src-dhu-winter-chinese-2027'],
  id: 'cycle-dhu-winter-chinese-2027',
  programId: dhuWinterId,
  academicYear: '2026-2027',
  intake: 'other',
  opensOn: '2026-07-10',
  closesOn: '2026-11-30',
  dateStatus: 'published',
  tuitionCny: 3600,
  tuitionPeriod: 'program',
  tuitionStatus: 'confirmed',
  evidenceBasis: 'cycle-specific',
  factScope: 'complete',
  applicationFeeCny: 600,
  notes: localized(
    'Classes run January 6–26, 2027, and include a final exam and completion certificate. Current or former DHU students, and new applicants recommended by a DHU student, may receive an application-fee waiver.',
    '课程时间为2027年1月6日至26日，包含期末考试并颁发结业证书。东华大学在读或往届学生，以及由东华大学学生推荐的新申请人，可申请免报名费。',
    'Занятия проходят с 6 по 26 января 2027 года, включая итоговый экзамен и сертификат. Текущие и бывшие студенты DHU, а также рекомендованные ими новые заявители могут получить освобождение от сбора.',
  ),
})

const xju = icltProgram({
  id: 'program-xju-iclt-one-semester-spring-2027',
  universityId: 'uni-xinjiang-university',
  sourceId: 'src-xju-iclt-2026',
  programUrl: 'https://gjjl.xju.edu.cn/info/1015/2558.htm',
  applyUrl: 'https://xju.at0086.cn/StuApplication/Login.aspx',
  school: localized('Xinjiang University', '新疆大学', 'Синьцзянском университете'),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180' },
    { test: 'other', minimum: 'HSKK required' },
  ],
  directions: localized(
    'Directions: International Chinese Language Education, Chinese Language and Literature, Chinese History, and Chinese Philosophy',
    '方向：国际中文教育、汉语言文学、中国历史和中国哲学',
    'Направления: международное преподавание китайского, китайский язык и литература, история Китая и китайская философия',
  ),
  extraNotes: localized(
    'Applicants must use both the central scholarship portal and the Xinjiang University system. The official guide does not state the teaching language, list-price tuition or application fee.',
    '申请人须同时使用奖学金中央系统和新疆大学系统。官方简章未公布授课语言、标价学费和申请费。',
    'Заявку необходимо подать и в центральной системе стипендии, и в системе университета. Язык обучения, прейскурантная стоимость и сбор официально не указаны.',
  ),
})

const snnu = icltProgram({
  id: 'program-snnu-iclt-one-semester-spring-2027',
  universityId: 'uni-shaanxi-normal-university',
  sourceId: 'src-snnu-iclt-2026',
  programUrl: 'https://study.snnu.edu.cn/info/1066/1238.htm',
  applyUrl: 'https://snnu.17gz.org/member/login.do',
  school: localized('Shaanxi Normal University', '陕西师范大学', 'Шэньсийском педагогическом университете'),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180' },
    { test: 'other', minimum: 'HSKK required' },
  ],
  directions: localized(
    'Directions: International Chinese Language Education, Chinese Language and Literature, Chinese History, and Chinese Philosophy',
    '方向：国际中文教育、汉语言文学、中国历史和中国哲学',
    'Направления: международное преподавание китайского, китайский язык и литература, история Китая и китайская философия',
  ),
  extraNotes: localized(
    'Applicants must submit in both the central scholarship portal and the SNNU system. The official guide does not state the teaching language, list-price tuition or application fee.',
    '申请人须同时在奖学金中央系统和陕西师范大学系统提交申请。官方简章未公布授课语言、标价学费和申请费。',
    'Заявку необходимо подать и в центральной системе стипендии, и в системе SNNU. Язык обучения, прейскурантная стоимость и сбор официально не указаны.',
  ),
})

const blcu = icltProgram({
  id: 'program-blcu-iclt-one-semester-spring-2027',
  universityId: 'uni-beijing-language-university',
  sourceId: 'src-blcu-iclt-2026',
  programUrl: 'https://admission.blcu.edu.cn/en/2026/0303/c1148a3044/page.htm',
  applyUrl: ICLT_PORTAL,
  school: localized('Beijing Language University', '北京语言大学', 'Пекинском университете языка и культуры'),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180' },
    { test: 'other', minimum: 'HSKK required' },
  ],
  directions: localized(
    'Directions: International Chinese Language Education and Chinese Language and Literature',
    '方向：国际中文教育和汉语言文学',
    'Направления: международное преподавание китайского, китайский язык и литература',
  ),
  extraNotes: localized(
    'Applicants need a recommending institution. The official guide does not require a second BLCU application system and does not state the teaching language, list-price tuition or application fee.',
    '申请人须通过推荐机构。官方简章未要求第二个北语报名系统，也未公布授课语言、标价学费和申请费。',
    'Требуется рекомендующая организация. Руководство не требует второй системы BLCU и не указывает язык обучения, прейскурантную стоимость или сбор.',
  ),
})

const dhuIclt = icltProgram({
  id: 'program-dhu-iclt-one-semester-spring-2027',
  universityId: 'uni-donghua-university',
  sourceId: 'src-dhu-iclt-2026',
  programUrl: 'https://english.dhu.edu.cn/_t1264/2021/0119/c5221a273256/page.psp',
  applyUrl: ICLT_PORTAL,
  school: localized('Donghua University', '东华大学', 'Университете Дунхуа'),
  teachingLanguages: ['Chinese'],
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180' },
    { test: 'other', minimum: 'HSKK required' },
  ],
  directions: localized(
    'Direction: Chinese Language and Literature in General Chinese Program A',
    '方向：普通汉语A项目中的汉语言文学',
    'Направление: китайский язык и литература в программе General Chinese A',
  ),
  extraNotes: localized(
    'Applicants holding an X1 or X2 visa are not eligible. A recommending institution is required; list-price tuition and an application fee are not stated for this scholarship route.',
    '持X1或X2签证者不符合申请条件。申请须通过推荐机构；该奖学金路线未公布标价学费和申请费。',
    'Владельцы виз X1 или X2 не могут участвовать. Требуется рекомендующая организация; прейскурантная стоимость и сбор для этого маршрута не указаны.',
  ),
})

const shu = icltProgram({
  id: 'program-shu-iclt-one-semester-spring-2027',
  universityId: 'uni-shanghai-university',
  sourceId: 'src-shu-iclt-2026',
  programUrl: sources.find((item) => item.id === 'src-shu-iclt-2026').url,
  applyUrl: ICLT_PORTAL,
  school: localized('Shanghai University', '上海大学', 'Шанхайском университете'),
  teachingLanguages: ['Chinese'],
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180 for four language/history/philosophy directions; score required for TCM and Taiji' },
    { test: 'other', minimum: 'HSKK required for four language/history/philosophy directions; preferred for TCM and Taiji' },
  ],
  directions: localized(
    'Directions: International Chinese Language Education, Chinese Language and Literature, Chinese History, Chinese Philosophy, Traditional Chinese Medicine, and Taiji Culture',
    '方向：国际中文教育、汉语言文学、中国历史、中国哲学、中医和太极文化',
    'Направления: международное преподавание китайского, китайский язык и литература, история Китая, китайская философия, традиционная китайская медицина и тайцзи',
  ),
  extraNotes: localized(
    'Non-degree applicants use the central scholarship system. Four-week group-only routes are excluded from the public individual-application catalog.',
    '非学历申请人使用奖学金中央系统。仅接受团体申请的四周项目不进入个人申请公开目录。',
    'Для программ без степени используется центральная система стипендии. Четырёхнедельные групповые маршруты исключены из каталога индивидуальных заявок.',
  ),
})

const tju = icltProgram({
  id: 'program-tianjin-university-one-semester-chinese-language-study-spring-language',
  universityId: 'uni-tianjin-university',
  sourceId: 'src-tju-iclt-2026',
  programUrl: 'https://sie.tju.edu.cn/en/jxj/ChineseLanguageTeachers/202602/t20260206_324551.html',
  applyUrl: 'https://tju.at0086.cn/student',
  school: localized('Tianjin University', '天津大学', 'Тяньцзиньском университете'),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180 for International Chinese Language Education and Chinese Language and Literature; score required for Taiji' },
    { test: 'other', minimum: 'HSKK required for two language directions; preferred for Taiji Culture' },
  ],
  directions: localized(
    'Directions: International Chinese Language Education, Chinese Language and Literature, and Taiji Culture',
    '方向：国际中文教育、汉语言文学和太极文化',
    'Направления: международное преподавание китайского, китайский язык и литература, культура тайцзи',
  ),
  extraNotes: localized(
    'Applications opened March 1, 2026 and must be submitted in both the central portal and the TJU system. The official guide does not state the teaching language, list-price tuition or application fee.',
    '申请于2026年3月1日开放，须同时在中央系统和天津大学系统提交。官方简章未公布授课语言、标价学费和申请费。',
    'Приём заявок открыт 1 марта 2026 года; заявку нужно подать в центральной системе и системе TJU. Язык обучения, прейскурантная стоимость и сбор не указаны.',
  ),
  opensOn: '2026-03-01',
})

tju.cycle.id = 'cycle-2026-de698abe4893'

const nankai = icltProgram({
  id: 'program-nankai-iclt-one-semester-spring-2027',
  universityId: 'uni-nankai-university',
  sourceId: 'src-nankai-iclt-2026',
  programUrl: 'https://ensie.nankai.edu.cn/info/1043/1317.htm',
  applyUrl: 'https://nankai.at0086.cn/StuApplication/Login.aspx',
  school: localized('Nankai University', '南开大学', 'Нанькайском университете'),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180 for four language/history/philosophy directions; score required for Taiji' },
    { test: 'other', minimum: 'HSKK required for four language/history/philosophy directions; preferred for Taiji Culture' },
  ],
  directions: localized(
    'Directions: Teaching Chinese to Speakers of Other Languages, Chinese Language and Literature, Chinese History, Chinese Philosophy, and Taiji Culture',
    '方向：国际中文教育、汉语言文学、中国历史、中国哲学和太极文化',
    'Направления: преподавание китайского как иностранного, китайский язык и литература, история Китая, китайская философия и культура тайцзи',
  ),
  extraNotes: localized(
    'Applicants must first submit in the Nankai system and pay the CNY 400 non-degree application fee, then submit through the central scholarship portal. X1/X2 visa holders are not eligible.',
    '申请人须先在南开大学系统提交并支付非学历项目400元申请费，再通过奖学金中央系统提交。持X1/X2签证者不符合条件。',
    'Сначала нужно подать заявку в системе Нанькайского университета и уплатить сбор 400 юаней, затем подать заявку в центральной системе. Владельцы виз X1/X2 не допускаются.',
  ),
  applicationFeeCny: 400,
})

const bfsuTrainingProgramId = 'program-bfsu-general-chinese-training-spring-2027'
const bfsuTrainingProgram = audited({
  sourceIds: ['src-bfsu-chinese-training'],
  id: bfsuTrainingProgramId,
  slug: 'bfsu-general-chinese-training-spring-2027',
  universityId: 'uni-beijing-foreign-studies-university',
  name: localized(
    'General Chinese Training Program — Spring 2027',
    '普通汉语进修项目（2027年春季）',
    'Общая программа китайского языка — весна 2027',
  ),
  degreeLevel: 'language',
  discipline: 'chinese-education',
  teachingLanguages: [],
  durationMonths: 4,
  programUrl: 'https://osao.bfsu.edu.cn/info/2832/5592.htm',
  applyUrl: 'https://study.bfsu.edu.cn/',
  languageRequirements: [
    { test: 'other', minimum: 'BFSU School of Chinese Language and Literature entrance examination' },
  ],
  verificationScope: 'facts',
})

const bfsuTrainingCycle = audited({
  sourceIds: ['src-bfsu-chinese-training'],
  id: 'cycle-bfsu-general-chinese-training-spring-2027',
  programId: bfsuTrainingProgramId,
  academicYear: '2026-2027',
  intake: 'spring',
  opensOn: null,
  closesOn: '2026-12-15',
  dateStatus: 'published',
  tuitionCny: 12000,
  tuitionPeriod: 'semester',
  tuitionStatus: 'confirmed',
  evidenceBasis: 'recurring-official-rule',
  factScope: 'complete',
  applicationFeeCny: 800,
  notes: localized(
    'The official rule is “Spring: December 15, each year”; this 2027 spring cycle applies that published recurring rule. One semester is about 18 weeks; the one-academic-year option costs CNY 24,000. The official page does not state the teaching language.',
    '官方规则为“春季：每年12月15日”；本周期按该公开年度规则对应2027年春季。一学期约18周，一学年选项学费24,000元。官方页面未明确授课语言。',
    'Официальное правило: «весна — 15 декабря каждого года»; дата цикла весны 2027 применяет это опубликованное правило. Семестр длится около 18 недель, годовая опция стоит 24 000 юаней. Язык обучения не указан.',
  ),
})

const bfsuIclt = icltProgram({
  id: 'program-bfsu-iclt-one-semester-spring-2027',
  universityId: 'uni-beijing-foreign-studies-university',
  sourceId: 'src-bfsu-iclt-2026',
  programUrl: 'https://osao.bfsu.edu.cn/info/2462/6812.htm',
  applyUrl: ICLT_PORTAL,
  school: localized('Beijing Foreign Studies University', '北京外国语大学', 'Пекинском университете иностранных языков'),
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180' },
    { test: 'other', minimum: 'HSKK required' },
  ],
  directions: localized(
    'One-semester Chinese-language scholarship study',
    '一学期中文奖学金研修',
    'Семестровая стипендиальная программа китайского языка',
  ),
  extraNotes: localized(
    'The official page conflicts on a January versus March start month; the Spring 2027 intake, five-month maximum and December 30, 2026 deadline are confirmed, but applicants must verify the exact start date. X1/X2 visa holders are not eligible.',
    '官方页面对1月或3月开学存在冲突；可确认2027年春季入学、最长5个月及2026年12月30日截止，但具体开学日期须向学校核实。持X1/X2签证者不符合条件。',
    'На официальной странице есть противоречие между январём и мартом. Подтверждены весенний набор 2027 года, срок до пяти месяцев и дедлайн 30 декабря 2026 года; точную дату начала нужно уточнить. Владельцы виз X1/X2 не допускаются.',
  ),
  closesOn: '2026-12-30',
})

const uibeProgramId = 'program-uibe-international-foundation-spring-2027'
const uibeProgram = audited({
  sourceIds: ['src-uibe-international-foundation'],
  id: uibeProgramId,
  slug: 'uibe-international-foundation-spring-2027',
  universityId: 'uni-university-of-international-business-and-economics',
  name: localized(
    'International Foundation Program — Spring 2027',
    '国际学生预科项目（2027年春季）',
    'Международная подготовительная программа — весна 2027',
  ),
  degreeLevel: 'foundation',
  discipline: 'business',
  teachingLanguages: [],
  durationMonths: 4,
  programUrl: sources.find((item) => item.id === 'src-uibe-international-foundation').url,
  applyUrl: 'https://isa.uibe.edu.cn/',
  languageRequirements: [
    { test: 'other', minimum: 'No language-test threshold is stated on the official program page' },
  ],
  verificationScope: 'facts',
})

const uibeCycle = audited({
  sourceIds: ['src-uibe-international-foundation'],
  id: 'cycle-uibe-international-foundation-spring-2027',
  programId: uibeProgramId,
  academicYear: '2026-2027',
  intake: 'spring',
  opensOn: '2026-10-01',
  closesOn: '2026-12-31',
  dateStatus: 'published',
  tuitionCny: 15600,
  tuitionPeriod: 'semester',
  tuitionStatus: 'confirmed',
  evidenceBasis: 'recurring-official-rule',
  factScope: 'complete',
  applicationFeeCny: 660,
  notes: localized(
    'The official recurring window is October 1–December 31 for the February–June spring semester and may close earlier when places are filled. The program lasts about 16 weeks. A CNY 2,000 non-refundable tuition deposit is credited toward tuition; the one-year option costs CNY 30,300.',
    '官方年度规则为春季学期（2月至6月）在10月1日至12月31日申请，名额满时可能提前关闭；项目约16周。2,000元不可退学费定金计入学费，一学年选项学费30,300元。',
    'Официальное ежегодное окно для весеннего семестра (февраль–июнь) — с 1 октября по 31 декабря, но набор может закрыться раньше при заполнении мест. Длительность около 16 недель. Невозвратный депозит 2 000 юаней засчитывается в обучение; годовая опция стоит 30 300 юаней.',
  ),
})

const programGroups = [xju, snnu, blcu, dhuIclt, shu, tju, nankai, bfsuIclt]
const programs = [
  xmuProgram,
  dhuWinterProgram,
  bfsuTrainingProgram,
  uibeProgram,
  ...programGroups.map((group) => group.program),
]
const cycles = [
  xmuCycle,
  dhuWinterCycle,
  bfsuTrainingCycle,
  uibeCycle,
  ...programGroups.map((group) => group.cycle),
]
const scholarships = [
  xmuScholarship,
  ...programGroups.map((group) => group.scholarship),
]

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
  const updatedCities = upsertById(readJson('cities.json'), cities)
  const updatedUniversities = upsertById(readJson('universities.json'), universities)
  const updatedPrograms = upsertById(readJson('programs.json'), programs)
  const updatedCycles = upsertById(
    readJson('admission-cycles.json').filter(
      (item) => item.id !== 'cycle-tianjin-university-one-semester-chinese-language-study-spring-language',
    ),
    cycles,
  )
  const updatedScholarships = upsertById(readJson('scholarships.json'), scholarships)

  writeJson('sources.json', updatedSources)
  writeJson('cities.json', updatedCities)
  writeJson('universities.json', updatedUniversities)
  writeJson('programs.json', updatedPrograms)
  writeJson('admission-cycles.json', updatedCycles)
  writeJson('scholarships.json', updatedScholarships)

  console.log(JSON.stringify({
    sources: updatedSources.length,
    cities: updatedCities.length,
    universities: updatedUniversities.length,
    programs: updatedPrograms.length,
    admissionCycles: updatedCycles.length,
    scholarships: updatedScholarships.length,
    expandedPrograms: programs.length,
    expandedScholarships: scholarships.length,
  }, null, 2))
}

apply()
