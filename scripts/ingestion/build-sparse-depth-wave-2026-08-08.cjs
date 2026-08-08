const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const checkedAt = '2026-08-08'
const outputDirectory = path.join(root, 'quality', 'multiversity-expansion-wave-2026-08-08')
const outputPath = path.join(outputDirectory, 'sparse-depth-and-scholarships.json')
const sourceFile = 'sparse-depth-and-scholarships.json'

function unavailableFact(extra = {}) {
  return { value: null, status: 'officially_not_announced', ...extra }
}

function knownFact(value) {
  return { value, status: 'known' }
}

function knownTuition(amount, period = 'academic-year', qualifier = undefined) {
  return {
    amount,
    currency: 'CNY',
    period,
    status: 'known',
    ...(qualifier ? { qualifier } : {}),
  }
}

function unknownTuition() {
  return {
    amount: null,
    currency: 'CNY',
    period: null,
    status: 'officially_not_announced',
  }
}

function evidence({ officialUrl, sourceTitle, locator, quote, summary }) {
  return {
    officialUrl,
    sourceTitle,
    checkedAt,
    locator,
    quote,
    summary,
  }
}

function program({
  id,
  institutionSlug,
  name,
  level,
  programType = 'degree',
  teachingLanguage = unavailableFact(),
  duration = unavailableFact(),
  tuition = unknownTuition(),
  evidence: primaryEvidence,
  additionalEvidence = [],
  applicationUrl = null,
  riskFlags = ['current_application_cycle_not_published'],
}) {
  return {
    candidateId: id,
    candidateIds: [id],
    institutionSlug,
    name,
    programType,
    level,
    teachingLanguage,
    duration,
    tuition,
    cycles: [],
    evidence: evidence(primaryEvidence),
    additionalEvidence,
    applicationUrl,
    recommendedAction: 'publish_program_identity_without_open_cycle',
    qualityTier: 'A',
    riskFlags,
    sourceFiles: [sourceFile],
  }
}

function scholarship({
  id,
  institutionSlug,
  name,
  scholarshipType,
  scope,
  applicableLevels,
  tiers,
  evidence: primaryEvidence,
  applicationUrl = null,
  applicationRouteStatus = 'not_confirmed',
  riskFlags = ['closed_or_unannounced_application_cycle_not_materialized'],
}) {
  return {
    candidateId: id,
    candidateIds: [id],
    institutionSlug,
    name,
    scholarshipType,
    scope,
    applicableLevels,
    programCandidateIds: [],
    funding: { status: 'known', tiers },
    cycles: [],
    evidence: evidence(primaryEvidence),
    additionalEvidence: [],
    applicationUrl,
    applicationRouteStatus,
    recommendedAction: 'publish_scholarship_identity_without_open_cycle',
    qualityTier: 'A',
    riskFlags,
    sourceFiles: [sourceFile],
  }
}

const programCandidates = [
  program({
    id: 'sparse-depth-0808-csu-computing-science-bachelor',
    institutionSlug: 'central-south-university',
    name: {
      en: 'Computing Science',
      zh: '计算科学',
      ru: 'Вычислительная наука',
    },
    level: 'bachelor',
    teachingLanguage: knownFact('English'),
    duration: knownFact('4 years'),
    tuition: knownTuition(69000),
    evidence: {
      officialUrl: 'https://intl.csu.edu.cn/English/Admission/Undergraduate_Programs/English_taught_Programs.htm',
      sourceTitle: '2026 CSU English-taught Undergraduate Programs',
      locator: 'Sections II and IV: catalogue, duration, tuition and application procedure',
      quote: 'CSU offers five English-taught undergraduate programs: Civil Engineering, Mathematics, Computing Science, Mechanical Engineering, and Mechanical Engineering with Transportation.',
      summary: {
        en: 'The 2026 official international guide lists Computing Science among CSU\'s English-taught four-year undergraduate programs and publishes tuition of CNY 69,000 per year. The May 31 application deadline is closed and is not exposed as a current cycle.',
        zh: '2026年官方国际生简章将计算科学列为中南大学四年制英语授课本科项目，学费为每年69000元。5月31日截止期已关闭，不作为当前周期展示。',
        ru: 'Официальное руководство 2026 года включает Computing Science в число четырёхлетних англоязычных бакалаврских программ; плата — 69 000 CNY в год. Закрытый срок не публикуется как текущий.',
      },
    },
    applicationUrl: 'https://csu.17gz.org/',
    riskFlags: ['2026_application_deadline_closed_identity_and_fee_reference_only'],
  }),
  program({
    id: 'sparse-depth-0808-csu-mechanical-engineering-bachelor',
    institutionSlug: 'central-south-university',
    name: {
      en: 'Mechanical Engineering',
      zh: '机械工程',
      ru: 'Механическая инженерия',
    },
    level: 'bachelor',
    teachingLanguage: knownFact('English'),
    duration: knownFact('4 years'),
    tuition: knownTuition(69000),
    evidence: {
      officialUrl: 'https://intl.csu.edu.cn/English/Admission/Undergraduate_Programs/English_taught_Programs.htm',
      sourceTitle: '2026 CSU English-taught Undergraduate Programs',
      locator: 'Sections II and IV: catalogue, duration, tuition and application procedure',
      quote: 'CSU offers five English-taught undergraduate programs: Civil Engineering, Mathematics, Computing Science, Mechanical Engineering, and Mechanical Engineering with Transportation.',
      summary: {
        en: 'The 2026 official international guide lists Mechanical Engineering as a four-year English-taught undergraduate program with reference tuition of CNY 69,000 per year. Its closed 2026 deadline is withheld.',
        zh: '2026年官方国际生简章列出四年制英语授课机械工程本科，参考学费为每年69000元；已关闭的2026年截止期不展示。',
        ru: 'Официальное руководство 2026 года указывает четырёхлетний англоязычный бакалавриат по Mechanical Engineering с ориентировочной платой 69 000 CNY в год; закрытый срок 2026 года скрыт.',
      },
    },
    applicationUrl: 'https://csu.17gz.org/',
    riskFlags: ['2026_application_deadline_closed_identity_and_fee_reference_only'],
  }),
  program({
    id: 'sparse-depth-0808-csu-chinese-language',
    institutionSlug: 'central-south-university',
    name: {
      en: 'Chinese Language Program',
      zh: '汉语进修项目',
      ru: 'Программа китайского языка',
    },
    level: 'language',
    programType: 'language',
    duration: knownFact('One semester or one academic year'),
    evidence: {
      officialUrl: 'https://intl.csu.edu.cn/info/1141/3799.htm',
      sourceTitle: '2026 CSU Chinese Language Program for International Students',
      locator: 'Sections I, II and III: duration, eligibility and funding route',
      quote: 'One academic year: September 2026 - July 2027; One semester: September 2026 - January 2027.',
      summary: {
        en: 'CSU\'s official 2026 guide confirms an individually applicable Chinese-language route for non-Chinese citizens in one-semester and one-academic-year formats. The June 10 deadline is closed and omitted.',
        zh: '中南大学2026年官方简章确认面向非中国籍申请者的一学期和一学年汉语进修路线；6月10日截止期已关闭并已隐藏。',
        ru: 'Официальное руководство CSU 2026 года подтверждает индивидуальную подачу иностранцев на семестровую или годичную программу; закрытый срок 10 июня скрыт.',
      },
    },
    applicationUrl: 'https://csu.17gz.org/',
    riskFlags: ['2026_application_deadline_closed_identity_only'],
  }),

  program({
    id: 'sparse-depth-0808-ccmusic-music-education-vocal-bachelor',
    institutionSlug: 'china-conservatory-of-music',
    name: {
      en: 'Music Education (Vocal Specialty)',
      zh: '音乐教育（声乐特长）',
      ru: 'Музыкальное образование (вокальная специализация)',
    },
    level: 'bachelor',
    duration: knownFact('4 years'),
    tuition: knownTuition(32000),
    evidence: {
      officialUrl: 'https://gjjl.ccmusic.edu.cn/docs/2026-01/143de8ad89dd4daf90d199deb54228b0.pdf',
      sourceTitle: 'China Conservatory of Music 2026 International Undergraduate Admission Guide',
      locator: 'PDF page 4 program table; pages 5-6 eligibility, application and fees',
      quote: '教育学院：音乐教育（声乐特长），学制四年。',
      summary: {
        en: 'The official 2026 international undergraduate guide lists Music Education (Vocal Specialty), a four-year route with tuition of CNY 32,000 per year. Its January application window is closed.',
        zh: '2026年官方留学生本科简章列出音乐教育（声乐特长）四年制项目，学费为每年32000元；1月申请期已关闭。',
        ru: 'Официальное руководство 2026 года указывает четырёхлетнюю программу Music Education (Vocal Specialty) с платой 32 000 CNY в год; январский приём закрыт.',
      },
    },
    riskFlags: ['2026_application_deadline_closed_identity_and_fee_reference_only'],
  }),
  program({
    id: 'sparse-depth-0808-ccmusic-composition-bachelor',
    institutionSlug: 'china-conservatory-of-music',
    name: {
      en: 'Composition and Composition Theory',
      zh: '作曲与作曲技术理论',
      ru: 'Композиция и теория композиции',
    },
    level: 'bachelor',
    duration: knownFact('5 years'),
    tuition: knownTuition(32000),
    evidence: {
      officialUrl: 'https://gjjl.ccmusic.edu.cn/docs/2026-01/143de8ad89dd4daf90d199deb54228b0.pdf',
      sourceTitle: 'China Conservatory of Music 2026 International Undergraduate Admission Guide',
      locator: 'PDF page 4 program table; pages 5-6 eligibility, application and fees',
      quote: '作曲系：作曲与作曲技术理论，学制五年。',
      summary: {
        en: 'The 2026 international guide names Composition and Composition Theory as a five-year undergraduate route and publishes annual tuition of CNY 32,000. No expired deadline is materialized.',
        zh: '2026年国际生简章将作曲与作曲技术理论列为五年制本科项目，每年学费32000元；已过期截止日不落库。',
        ru: 'Руководство 2026 года подтверждает пятилетний бакалавриат Composition and Composition Theory с платой 32 000 CNY в год; просроченная дата не импортируется.',
      },
    },
    riskFlags: ['2026_application_deadline_closed_identity_and_fee_reference_only'],
  }),
  program({
    id: 'sparse-depth-0808-ccmusic-conducting-bachelor',
    institutionSlug: 'china-conservatory-of-music',
    name: {
      en: 'Music Performance (Conducting)',
      zh: '音乐表演（指挥）',
      ru: 'Музыкальное исполнительство (дирижирование)',
    },
    level: 'bachelor',
    duration: knownFact('5 years'),
    tuition: knownTuition(32000),
    evidence: {
      officialUrl: 'https://gjjl.ccmusic.edu.cn/docs/2026-01/143de8ad89dd4daf90d199deb54228b0.pdf',
      sourceTitle: 'China Conservatory of Music 2026 International Undergraduate Admission Guide',
      locator: 'PDF page 4 program table; pages 5-6 eligibility, application and fees',
      quote: '指挥系：音乐表演（指挥），学制五年。',
      summary: {
        en: 'The official international guide confirms Music Performance (Conducting) as a five-year undergraduate route with CNY 32,000 annual tuition. The January 2026 application period is not presented as open.',
        zh: '官方国际生简章确认音乐表演（指挥）为五年制本科，每年学费32000元；2026年1月申请期不作为开放周期展示。',
        ru: 'Официальный справочник подтверждает пятилетний бакалавриат Music Performance (Conducting) с платой 32 000 CNY в год; январский приём 2026 года не считается открытым.',
      },
    },
    riskFlags: ['2026_application_deadline_closed_identity_and_fee_reference_only'],
  }),

  program({
    id: 'sparse-depth-0808-gxu-chinese-language-student',
    institutionSlug: 'guangxi-university',
    name: {
      en: 'Chinese Language Program',
      zh: '汉语进修生项目',
      ru: 'Программа китайского языка',
    },
    level: 'language',
    programType: 'language',
    tuition: knownTuition(10500, 'academic-year', 'The same official fee page also lists CNY 5,250 per semester.'),
    evidence: {
      officialUrl: 'https://gjxy.gxu.edu.cn/LXXD/sfbz.htm',
      sourceTitle: 'Guangxi University International Student Fee Standards',
      locator: 'Tuition section (I), Chinese Language Student',
      quote: '汉语进修生 Chinese Language Student: 5250 yuan/semester; 10500 yuan/academic year.',
      summary: {
        en: 'The official international-student fee page explicitly identifies the Chinese Language Student category and publishes CNY 5,250 per semester or CNY 10,500 per academic year. The current application deadline is not stated on this page.',
        zh: '官方国际生收费页明确列出汉语进修生类别，学费为每学期5250元或每学年10500元；该页未公布当前申请截止日。',
        ru: 'Официальная страница тарифов для иностранцев прямо указывает Chinese Language Student: 5 250 CNY за семестр или 10 500 CNY за учебный год; текущий срок не указан.',
      },
    },
    applicationUrl: null,
    riskFlags: ['current_application_cycle_not_published_fee_reference_only'],
  }),
  program({
    id: 'sparse-depth-0808-gxu-chinese-language-major-bachelor',
    institutionSlug: 'guangxi-university',
    name: {
      en: 'Chinese Language Major',
      zh: '汉语言专业',
      ru: 'Китайский язык',
    },
    level: 'bachelor',
    tuition: knownTuition(11000),
    evidence: {
      officialUrl: 'https://gjxy.gxu.edu.cn/LXXD/sfbz.htm',
      sourceTitle: 'Guangxi University International Student Fee Standards',
      locator: 'Tuition section (II), Undergraduate Student, item 1',
      quote: '汉语言专业11000元/年 Chinese Language Major 11000 yuan/year.',
      summary: {
        en: 'Guangxi University\'s official international-student fee standard lists the Chinese Language Major as an undergraduate category at CNY 11,000 per year. Duration, instruction language and the current cycle remain unannounced.',
        zh: '广西大学官方国际生收费标准将汉语言专业列为本科类别，学费为每年11000元；学制、授课语言和当前周期尚未公布。',
        ru: 'Официальный тариф для иностранцев относит Chinese Language Major к бакалавриату с платой 11 000 CNY в год; длительность, язык и текущий цикл не объявлены.',
      },
    },
    applicationUrl: null,
    riskFlags: ['current_application_cycle_duration_and_language_not_published_fee_reference_only'],
  }),

  ...[
    {
      slug: 'mechanical-engineering',
      en: 'Mechanical Engineering',
      zh: '机械工程',
      ru: 'Механическая инженерия',
      quote: 'Mechanical Engineering.pdf',
    },
    {
      slug: 'energy-and-power-engineering',
      en: 'Energy and Power Engineering',
      zh: '能源与动力工程',
      ru: 'Энергетика и теплоэнергетика',
      quote: 'Energy and Power.pdf',
    },
    {
      slug: 'metallurgical-engineering',
      en: 'Metallurgical Engineering',
      zh: '冶金工程',
      ru: 'Металлургическая инженерия',
      quote: 'Metallurgical Engineering.pdf',
    },
  ].map((item) => program({
    id: `sparse-depth-0808-kust-${item.slug}-bachelor`,
    institutionSlug: 'kunming-university-of-science-and-technology',
    name: { en: item.en, zh: item.zh, ru: item.ru },
    level: 'bachelor',
    teachingLanguage: knownFact('English'),
    evidence: {
      officialUrl: 'https://gjxy.kust.edu.cn/info/1336/1351.htm',
      sourceTitle: 'KUST English-Taught Programs',
      locator: `English-taught program attachment list: ${item.en}`,
      quote: item.quote,
      summary: {
        en: `KUST's official International College page lists ${item.en} among its English-taught programs. A separate 2026 official page confirms the current international undergraduate and postgraduate catalogue; duration, fee and open cycle are not asserted.`,
        zh: `昆明理工大学国际学院官方页将${item.zh}列入全英文授课专业，另有2026年官方国际生专业目录页作为当期支持；不声称学制、费用或开放周期。`,
        ru: `Официальная страница KUST включает ${item.en} в число англоязычных программ, а отдельная страница 2026 года подтверждает текущий международный каталог; срок, цена и открытый цикл не утверждаются.`,
      },
    },
    additionalEvidence: [{
      officialUrl: 'https://gjxy.kust.edu.cn/info/1337/1722.htm',
      sourceTitle: '2026 KUST Undergraduate and Post-graduate Program List',
    }],
    applicationUrl: 'https://gjxy.kust.edu.cn/info/1337/1718.htm',
    riskFlags: ['current_2026_catalog_attachment_requires_item_level_recheck_before_dynamic_facts'],
  })),

  ...[
    {
      slug: 'international-economics-and-trade',
      en: 'International Economics and Trade',
      zh: '国际经济与贸易',
      ru: 'Международная экономика и торговля',
    },
    {
      slug: 'business-administration',
      en: 'Business Administration',
      zh: '工商管理',
      ru: 'Деловое администрирование',
    },
    {
      slug: 'computer-science-and-technology',
      en: 'Computer Science and Technology',
      zh: '计算机科学与技术',
      ru: 'Информатика и технологии',
    },
  ].map((item) => program({
    id: `sparse-depth-0808-ouc-${item.slug}-bachelor`,
    institutionSlug: 'ocean-university-of-china',
    name: { en: item.en, zh: item.zh, ru: item.ru },
    level: 'bachelor',
    evidence: {
      officialUrl: 'https://eweb.ouc.edu.cn/4200/list.htm',
      sourceTitle: 'Ocean University of China — Why OUC',
      locator: 'Paragraph beginning “OUC is now offering various programs to international students”',
      quote: `The Undergraduate Program of ${item.en}`,
      summary: {
        en: `OUC's official English site explicitly lists the undergraduate ${item.en} program among programs offered to international students. Current duration, tuition, instruction language and deadline are not asserted.`,
        zh: `中国海洋大学官方英文站明确将${item.zh}本科列为面向国际学生的项目；不声称当前学制、学费、授课语言或截止日。`,
        ru: `Официальный англоязычный сайт OUC прямо включает бакалаврскую программу ${item.en} в перечень для иностранцев; текущие сроки, цена, язык и дедлайн не утверждаются.`,
      },
    },
    additionalEvidence: [{
      officialUrl: 'https://sie.ouc.edu.cn/english/AdmissionBrochures/list.htm',
      sourceTitle: 'OUC 2026 International Admission Brochures',
    }],
    applicationUrl: 'https://ouc.at0086.cn/',
    riskFlags: ['current_program_identity_confirmed_dynamic_facts_not_announced'],
  })),

  ...[
    {
      slug: 'chemistry', en: 'Chemistry', zh: '化学', ru: 'Химия',
    },
    {
      slug: 'computer-science-and-technology',
      en: 'Computer Science and Technology',
      zh: '计算机科学与技术',
      ru: 'Информатика и технологии',
    },
    {
      slug: 'bioinformatics', en: 'Bioinformatics', zh: '生物信息学', ru: 'Биоинформатика',
    },
  ].map((item) => program({
    id: `sparse-depth-0808-sustech-${item.slug}-bachelor`,
    institutionSlug: 'southern-university-of-science-and-technology',
    name: { en: item.en, zh: item.zh, ru: item.ru },
    level: 'bachelor',
    evidence: {
      officialUrl: 'https://infoadmin.sustech.edu.cn/programs/new',
      sourceTitle: 'SUSTech International Admissions — Undergraduate Programs',
      locator: `Department and Major Introduction: ${item.en}`,
      quote: item.en,
      summary: {
        en: `SUSTech's official international-admissions catalogue lists ${item.en} among the majors international undergraduates may choose. Current program-specific duration, tuition, teaching language and deadline remain unannounced.`,
        zh: `南方科技大学官方国际招生目录将${item.zh}列为国际本科生可选专业；当前专业学制、学费、授课语言和截止日尚未公布。`,
        ru: `Официальный международный каталог SUSTech включает ${item.en} в список направлений, доступных иностранным бакалаврам; срок, цена, язык и дедлайн не объявлены.`,
      },
    },
    applicationUrl: 'https://sustech.at0086.cn/',
    riskFlags: ['current_major_identity_confirmed_program_specific_dynamic_facts_not_announced'],
  })),

  program({
    id: 'sparse-depth-0808-zzu-architecture-master',
    institutionSlug: 'zhengzhou-university',
    name: {
      en: 'Architecture',
      zh: '建筑学',
      ru: 'Архитектура',
    },
    level: 'master',
    teachingLanguage: knownFact('English'),
    evidence: {
      officialUrl: 'https://international.zzu.edu.cn/en/article/detail?cid=53&detail=65&pid=53',
      sourceTitle: 'ZZU 2026 Master Programs with Full Scholarship',
      locator: 'Master of Architecture section and introductory English-program statement',
      quote: 'Besides all programs in Chinese, the following programs in English are also promoted by the University with full scholarship. Master of Architecture.',
      summary: {
        en: 'ZZU\'s official 2026 international master page identifies Architecture as an English-taught master program promoted with full scholarship. A current open deadline is not stated in the accessible text.',
        zh: '郑州大学2026年官方国际硕士页将建筑学列为英语授课且配套全额奖学金的硕士项目；可读文本未给出当前开放截止日。',
        ru: 'Официальная страница ZZU 2026 года указывает Architecture как англоязычную магистратуру с полной стипендией; текущий открытый срок в доступном тексте не указан.',
      },
    },
    applicationUrl: null,
    riskFlags: ['current_deadline_not_present_in_accessible_official_text'],
  }),
  program({
    id: 'sparse-depth-0808-zzu-medical-foundation',
    institutionSlug: 'zhengzhou-university',
    name: {
      en: 'International Medical Foundation Program',
      zh: '国际医学预科项目',
      ru: 'Международная подготовительная медицинская программа',
    },
    level: 'foundation',
    programType: 'foundation',
    teachingLanguage: knownFact('English'),
    duration: knownFact('1 year'),
    tuition: knownTuition(15000, 'program'),
    evidence: {
      officialUrl: 'https://international.zzu.edu.cn/en/admission/detail?cid=17&detail=612&pid=0&spid=0',
      sourceTitle: 'ZZU International Medical Foundation Program',
      locator: 'Key information block: degree, duration, school, tuition and target students',
      quote: 'Degree: Foundation | Duration: 1 Years | School: International Education | Tuition: 15,000.',
      summary: {
        en: 'The official program page confirms a one-year English medical foundation route for international students at CNY 15,000. The related 2026 article prints an impossible calendar date, so no deadline is materialized.',
        zh: '官方项目页确认面向国际学生的一年制英语医学预科，费用为15000元。关联2026年文章印有不存在的日历日期，因此不落库任何截止日。',
        ru: 'Официальная страница подтверждает годичную англоязычную медицинскую подготовительную программу за 15 000 CNY. В статье 2026 года указана несуществующая календарная дата, поэтому дедлайн не импортируется.',
      },
    },
    additionalEvidence: [{
      officialUrl: 'https://international.zzu.edu.cn/en/article/detail?cid=53&detail=64&pid=53',
      sourceTitle: 'ZZU One-year Medical Foundation Program 2026',
    }],
    applicationUrl: null,
    riskFlags: ['official_source_contains_invalid_june_31_deadline_not_materialized'],
  }),

  program({
    id: 'sparse-depth-0808-zuel-international-law-english-master',
    institutionSlug: 'zhongnan-university-of-economics-and-law',
    name: {
      en: 'International Law (English-taught)',
      zh: '国际法（英文授课）',
      ru: 'Международное право (на английском языке)',
    },
    level: 'master',
    teachingLanguage: knownFact('English'),
    duration: knownFact('2 years'),
    tuition: knownTuition(30000),
    evidence: {
      officialUrl: 'https://ies-en.zuel.edu.cn/_upload/article/files/9e/a1/f493cff64425b1bbf55d031a056b/283f0e72-29f6-4dc8-b85d-4e400c5c50f9.pdf',
      sourceTitle: 'ZUEL International Admissions Guide',
      locator: 'PDF page 2, Master\'s majors and tuition table',
      quote: 'Master\'s Degree Program (taught in English, 2 Years): Accounting, Finance, International Law, IMBA, International business.',
      summary: {
        en: 'ZUEL\'s official international guide lists International Law among two-year English-taught master programs and gives CNY 30,000 annual tuition for English-taught master study. The guide provides seasonal reference windows rather than a current exact deadline.',
        zh: '中南财经政法大学官方国际招生简章将国际法列为两年制英文授课硕士，英文硕士年学费为30000元；简章仅提供季节性参考申请期，没有当前精确截止日。',
        ru: 'Официальное руководство ZUEL включает International Law в двухлетние англоязычные магистерские программы с платой 30 000 CNY в год; точная текущая дата не дана.',
      },
    },
    riskFlags: ['guide_only_provides_reference_season_no_exact_current_deadline'],
  }),
  program({
    id: 'sparse-depth-0808-zuel-imba-master',
    institutionSlug: 'zhongnan-university-of-economics-and-law',
    name: {
      en: 'International MBA (English-taught)',
      zh: '国际工商管理硕士（英文授课）',
      ru: 'Международная MBA (на английском языке)',
    },
    level: 'master',
    teachingLanguage: knownFact('English'),
    duration: knownFact('2 years'),
    tuition: knownTuition(30000),
    evidence: {
      officialUrl: 'https://ies-en.zuel.edu.cn/_upload/article/files/9e/a1/f493cff64425b1bbf55d031a056b/283f0e72-29f6-4dc8-b85d-4e400c5c50f9.pdf',
      sourceTitle: 'ZUEL International Admissions Guide',
      locator: 'PDF page 2, English-taught master program list and tuition table',
      quote: 'Master\'s Degree Program (taught in English, 2 Years): Accounting, Finance, International Law, IMBA, International business.',
      summary: {
        en: 'The official guide names IMBA as a two-year English-taught master program and publishes the CNY 30,000-per-year English-master tuition category. Only reference application seasons are given.',
        zh: '官方简章将IMBA列为两年制英文授课硕士，并公布英文硕士每年30000元学费类别；仅给出参考申请季节。',
        ru: 'Официальный справочник называет IMBA двухлетней англоязычной магистратурой и указывает 30 000 CNY в год; даны только ориентировочные сезоны подачи.',
      },
    },
    riskFlags: ['guide_only_provides_reference_season_no_exact_current_deadline'],
  }),
  program({
    id: 'sparse-depth-0808-zuel-chinese-language',
    institutionSlug: 'zhongnan-university-of-economics-and-law',
    name: {
      en: 'Chinese Language Program',
      zh: '汉语进修项目',
      ru: 'Программа китайского языка',
    },
    level: 'language',
    programType: 'language',
    duration: knownFact('1 academic year'),
    tuition: knownTuition(16000),
    evidence: {
      officialUrl: 'https://ies-en.zuel.edu.cn/_upload/article/files/9e/a1/f493cff64425b1bbf55d031a056b/283f0e72-29f6-4dc8-b85d-4e400c5c50f9.pdf',
      sourceTitle: 'ZUEL International Admissions Guide',
      locator: 'PDF page 2, Chinese Language Students and tuition table',
      quote: 'Chinese Language: 1 year, CNY 16,000 per person per year.',
      summary: {
        en: 'ZUEL\'s official guide describes one-year Chinese-language study, including elementary through advanced placement, at CNY 16,000 per year. The guide does not publish a current exact deadline.',
        zh: '中南财经政法大学官方简章介绍一年制汉语进修，包含初级到高级分班，年学费为16000元；未公布当前精确截止日。',
        ru: 'Официальное руководство ZUEL описывает годичную программу китайского языка с уровнями от начального до продвинутого за 16 000 CNY в год; точный текущий срок не дан.',
      },
    },
    riskFlags: ['guide_only_provides_reference_season_no_exact_current_deadline'],
  }),

  program({
    id: 'sparse-depth-0808-wust-international-business-administration-bachelor',
    institutionSlug: 'wuhan-university-of-science-and-technology',
    name: {
      en: 'International Business Administration',
      zh: '国际工商管理',
      ru: 'Международное деловое администрирование',
    },
    level: 'bachelor',
    evidence: {
      officialUrl: 'https://en.wust.edu.cn/About1/Overview.htm',
      sourceTitle: 'Wuhan University of Science and Technology Overview',
      locator: 'International education paragraph describing international degree studies',
      quote: 'International students from various countries pursue undergraduate programs in fields such as clinical medicine, civil engineering, and international business administration.',
      summary: {
        en: 'WUST\'s official English overview explicitly identifies International Business Administration among undergraduate fields pursued by international students. No current program-specific duration, tuition, language or deadline is claimed.',
        zh: '武汉科技大学官方英文概况明确将国际工商管理列为国际学生就读的本科领域；不声称当前专业学制、学费、语言或截止日。',
        ru: 'Официальный англоязычный обзор WUST прямо называет International Business Administration среди бакалаврских направлений для иностранцев; текущие срок, цена, язык и дедлайн не утверждаются.',
      },
    },
    applicationUrl: null,
    riskFlags: ['official_overview_confirms_identity_dynamic_facts_require_admission_guide'],
  }),
]

const scholarshipCandidates = [
  scholarship({
    id: 'sparse-depth-0808-csu-university-scholarship',
    institutionSlug: 'central-south-university',
    name: {
      en: 'Central South University Scholarship for International Students',
      zh: '中南大学国际学生奖学金',
      ru: 'Стипендия Центрально-Южного университета для иностранных студентов',
    },
    scholarshipType: 'university',
    scope: 'International master and doctoral applicants who meet the official academic, age and language requirements.',
    applicableLevels: ['master', 'doctorate'],
    tiers: [
      'Full scholarship: tuition, on-campus accommodation, and monthly stipend',
      'Partial scholarship: tuition',
    ],
    evidence: {
      officialUrl: 'https://intl.csu.edu.cn/English/Scholarship/University_Scholarship.htm',
      sourceTitle: '2026 CSU Scholarship for International Students',
      locator: 'Sections 1, 2, 4 and 7: coverage, levels, closed deadline and online application',
      quote: 'Full scholarship: coverage of tuition, on-campus accommodation, and a monthly stipend. Partial scholarship: coverage of tuition.',
      summary: {
        en: 'The official 2026 guide defines full and partial CSU scholarship tiers for international master and doctoral applicants and a direct CSU online application route. The May 31 deadline is closed and is not published as current.',
        zh: '2026年官方简章定义了面向国际硕士和博士申请者的中南大学全额与部分奖学金及校方在线申请路线；5月31日截止期已关闭，不展示为当前。',
        ru: 'Официальное руководство 2026 года определяет полную и частичную стипендии CSU для иностранных магистров и докторантов; дедлайн 31 мая закрыт и не показывается как текущий.',
      },
    },
  }),
  scholarship({
    id: 'sparse-depth-0808-gzhmu-guangdong-government-freshmen',
    institutionSlug: 'guangzhou-medical-university',
    name: {
      en: 'Guangdong Government Outstanding International Students Scholarship for Freshmen',
      zh: '广东政府来粤留学生新生奖学金',
      ru: 'Стипендия правительства Гуандуна для выдающихся новых иностранных студентов',
    },
    scholarshipType: 'province',
    scope: 'Self-funded international master and doctoral freshmen at Guangzhou Medical University; award paid after registration, while fees remain payable.',
    applicableLevels: ['master', 'doctorate'],
    tiers: [
      'Master: CNY 20,000 one-time award',
      'Doctorate: CNY 30,000 one-time award',
    ],
    evidence: {
      officialUrl: 'https://fao.gzhmu.edu.cn/info/1301/9522.htm',
      sourceTitle: 'Guangzhou Medical University 2026 International Master and Doctoral Admission Guide',
      locator: 'Section IX Scholarships',
      quote: 'Doctoral students: RMB30,000 per person for one-time reward. Master\'s students: RMB20,000 per person for one-time reward.',
      summary: {
        en: 'The 2026 official guide states that self-funded international freshmen may apply after admission: CNY 20,000 for master students and CNY 30,000 for doctoral students, paid once after registration. No independent open deadline is asserted.',
        zh: '2026年官方简章说明自费国际新生可在录取后申请：硕士一次性20000元，博士一次性30000元，注册后发放；不声称独立开放截止日。',
        ru: 'В официальном руководстве 2026 года указано, что самофинансируемые новые иностранные студенты могут податься после зачисления: 20 000 CNY магистрам и 30 000 CNY докторантам единовременно после регистрации; отдельный дедлайн не утверждается.',
      },
    },
    riskFlags: ['post_admission_freshman_award_no_independent_deadline'],
  }),
  scholarship({
    id: 'sparse-depth-0808-zzu-2026-master-full-scholarship',
    institutionSlug: 'zhengzhou-university',
    name: {
      en: 'ZZU 2026 Master Programs Full Scholarship',
      zh: '郑州大学2026年硕士项目全额奖学金',
      ru: 'Полная стипендия ZZU для магистерских программ 2026 года',
    },
    scholarshipType: 'csc',
    scope: 'Eligible non-Chinese master applicants meeting the official academic, age and language requirements, including promoted English-taught programs.',
    applicableLevels: ['master'],
    tiers: [
      'Full scholarship: tuition, accommodation, living allowance, and medical insurance',
    ],
    evidence: {
      officialUrl: 'https://international.zzu.edu.cn/en/article/detail?cid=53&detail=65&pid=53',
      sourceTitle: 'ZZU 2026 Master Programs with Full Scholarship',
      locator: 'Chinese Government Scholarship coverage and eligibility sections',
      quote: 'It covers tuition, accommodation, living allowance, and medical insurance.',
      summary: {
        en: 'ZZU\'s official 2026 page describes a full Chinese Government Scholarship for eligible international master applicants, covering tuition, accommodation, living allowance and medical insurance. The accessible text does not provide a reliable current deadline.',
        zh: '郑州大学2026年官方页介绍面向符合条件的国际硕士申请者的中国政府全额奖学金，覆盖学费、住宿、生活补助和医疗保险；可读文本未提供可靠的当前截止日。',
        ru: 'Официальная страница ZZU 2026 года описывает полную государственную стипендию для подходящих иностранных магистров, покрывающую обучение, жильё, стипендию на жизнь и страховку; надёжный текущий срок не указан.',
      },
    },
    riskFlags: ['current_deadline_not_present_in_accessible_official_text'],
  }),
]

const representedInstitutions = [...new Set(
  [...programCandidates, ...scholarshipCandidates].map((candidate) => candidate.institutionSlug),
)].sort()

const bundle = {
  schemaVersion: '2026-08-08.sparse-depth-and-scholarships.v1',
  generatedAt: '2026-08-08T17:00:00+08:00',
  sourceFiles: [sourceFile],
  cities: [],
  universities: [],
  programCandidates,
  scholarshipCandidates,
  exclusions: [
    {
      institutionSlug: 'tibet-university',
      reason: 'Retains its documented limited catalogue: no second individually applicable identity was confirmed from current official sources.',
    },
    {
      institutionSlug: 'hunan-university-of-technology-and-business',
      reason: 'The 2026 official guide exposes exactly International Business and Chinese Language, both already public; no placeholder was added.',
    },
    {
      institutionSlug: 'wuhan-textile-university',
      reason: 'The 2026 official doctoral guide exposes exactly Textile Science and Engineering and Design, both already public.',
    },
    {
      institutionSlug: 'all-targets',
      reason: 'Domestic-student catalogues, group-only routes, expired cycles, invalid dates, search snippets and generated evidence templates were excluded.',
    },
  ],
  coverageSummary: {
    representedInstitutions: representedInstitutions.length,
    programCandidates: programCandidates.length,
    scholarshipCandidates: scholarshipCandidates.length,
    openProgramCycles: 0,
    openScholarshipCycles: 0,
    officialHttpsPrimaryEvidence: programCandidates.length + scholarshipCandidates.length,
  },
}

fs.mkdirSync(outputDirectory, { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')

console.log(JSON.stringify({
  output: path.relative(root, outputPath),
  programs: programCandidates.length,
  scholarships: scholarshipCandidates.length,
  representedInstitutions,
}, null, 2))
