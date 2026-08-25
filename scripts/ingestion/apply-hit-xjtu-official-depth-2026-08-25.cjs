const fs = require('node:fs')
const path = require('node:path')

const checkedAt = '2026-08-25'
const monthlyReviewAfter = '2026-09-24'
const winterReviewAfter = '2026-09-01'
const dataDir = process.env.STUDYINCHINA_DATA_DIR
  ? path.resolve(process.env.STUDYINCHINA_DATA_DIR)
  : path.join(process.cwd(), 'content', 'data')

const read = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'))
const write = (name, value) => fs.writeFileSync(
  path.join(dataDir, name),
  `${JSON.stringify(value, null, 2)}\n`,
  'utf8',
)
const localized = (en, zh, ru, de, fr, es) => ({ en, zh, ru, de, fr, es })

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

const hitMasterUrl = 'https://studyathit.hit.edu.cn/18359/list.htm'
const hitLongChineseUrl = 'https://studyathit.hit.edu.cn/LongwtermChineseLanguageProgram/list.htm'
const hitGlobalSummerUrl = 'https://studyathit.hit.edu.cn/GlobalSummerSchoolwHITGSSw/list.htm'
const hitPreUniversityUrl = 'https://studyathit.hit.edu.cn/18362/list.htm'
const hitWinterChineseUrl = 'https://studyathit.hit.edu.cn/ShortwTermPrograms/list.htm'
const hitApplyUrl = 'https://hit.at0086.cn/StuApplication/Login.aspx'

const xjtuUndergraduateGuideUrl = 'https://sie.xjtu.edu.cn/en/bke.pdf'
const xjtuProgramListUrl = 'https://sie.xjtu.edu.cn/en/BKYW.pdf'
const xjtuMbbsUrl = 'https://sie.xjtu.edu.cn/en/YXBK.pdf'
const xjtuFeesScholarshipsUrl = 'https://sie.xjtu.edu.cn/en/BKYY.pdf'
const xjtuApplyUrl = 'https://isso.xjtu.edu.cn/recruit/login'

const sourceSpecs = [
  {
    id: 'source-hit-2026-master-admissions',
    url: hitMasterUrl,
    title: 'HIT 2026 Master Program Admission Guide',
    publisher: 'Harbin Institute of Technology',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-gap-program-wave8-hit-long-term-chinese-language',
    url: hitLongChineseUrl,
    title: 'HIT 2026 Long-Term Chinese Language Program',
    publisher: 'Harbin Institute of Technology',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-gap-program-wave8-hit-global-summer-school',
    url: hitGlobalSummerUrl,
    title: 'HIT 2026 Global Summer School',
    publisher: 'Harbin Institute of Technology',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-gap-program-wave8-hit-pre-university-program',
    url: hitPreUniversityUrl,
    title: 'HIT 2026 Pre-University Program',
    publisher: 'Harbin Institute of Technology',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-gap-program-wave8-hit-winter-short-term-chinese-2026',
    url: hitWinterChineseUrl,
    title: 'HIT 2026 Short-Term Chinese Language Program',
    publisher: 'Harbin Institute of Technology',
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'source-xjtu-2026-undergraduate-guide',
    url: xjtuUndergraduateGuideUrl,
    title: 'XJTU 2026 International Undergraduate Application Guide',
    publisher: "Xi'an Jiaotong University",
    kind: 'admissions',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'source-xjtu-2026-undergraduate-program-list',
    url: xjtuProgramListUrl,
    title: 'XJTU 2026 International Undergraduate Program List',
    publisher: "Xi'an Jiaotong University",
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'source-xjtu-2026-mbbs-guide',
    url: xjtuMbbsUrl,
    title: 'XJTU 2026 MBBS Program Guide',
    publisher: "Xi'an Jiaotong University",
    kind: 'program',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'source-xjtu-2026-undergraduate-fees-scholarships',
    url: xjtuFeesScholarshipsUrl,
    title: 'XJTU 2026 Undergraduate Fees and Scholarships',
    publisher: "Xi'an Jiaotong University",
    kind: 'scholarship',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'source-xjtu-official-application-system',
    url: xjtuApplyUrl,
    title: 'XJTU International Student Online Application System',
    publisher: "Xi'an Jiaotong University",
    kind: 'admissions',
    language: 'en',
    official: true,
    accessedAt: checkedAt,
  },
]

const hitMasterRequirements = [
  { test: 'TOEFL', minimum: '80 or above' },
  { test: 'IELTS', minimum: '6.0 overall, with no component below 5.5' },
  {
    test: 'other',
    minimum: 'Equivalent English evidence is accepted; applicants whose previous degree was taught in English are exempt from an English certificate, and no Chinese certificate is required for the English-taught route.',
  },
  {
    test: 'other',
    minimum: 'Non-Chinese citizen in good physical and mental health, holding a bachelor degree and normally under 35; HIT Scholarship applicants must be under 30.',
  },
]

const hitLongChineseRequirements = [
  {
    test: 'other',
    minimum: 'No minimum HSK score is published; classes cover elementary (including beginner), intermediate and advanced levels.',
  },
  {
    test: 'other',
    minimum: 'Non-Chinese citizen in good physical and mental health; normally age 18 or above, with a notarized guardianship certificate required for a student under 18 by September 2026.',
  },
]

const hitGlobalSummerRequirements = [
  { test: 'other', minimum: 'Applicants must be fluent in English.' },
  {
    test: 'other',
    minimum: 'Open to undergraduate, master and doctoral students from HIT partner or cooperative institutions; interest in science and engineering is preferred.',
  },
]

const hitFoundationEligibility = 'Non-Chinese citizen in good physical and mental health, holding a high-school diploma or equivalent and normally age 18–28; applicants under 18 must provide the required guardian documentation.'

const commonHitProgramAudit = {
  verifiedAt: checkedAt,
  reviewAfter: monthlyReviewAfter,
  status: 'verified',
  verificationScope: 'facts',
}
const commonXjtuProgramAudit = {
  verifiedAt: checkedAt,
  reviewAfter: monthlyReviewAfter,
  status: 'verified',
  verificationScope: 'identity',
}

const programSpecs = [
  {
    id: 'program-harbin-institute-of-technology-civil-engineering-master',
    ...commonHitProgramAudit,
    name: localized('Civil Engineering', '土木工程', 'Гражданское строительство', 'Bauingenieurwesen', 'Génie civil', 'Ingeniería Civil'),
    teachingLanguages: ['English'],
    durationMonths: 24,
    durationMonthsMax: 36,
    programUrl: hitMasterUrl,
    applyUrl: hitApplyUrl,
    languageRequirements: hitMasterRequirements,
    sourceIds: ['source-hit-2026-master-admissions'],
  },
  {
    id: 'program-harbin-institute-of-technology-mechanical-engineering-master',
    ...commonHitProgramAudit,
    name: localized('Mechanical Engineering', '机械工程', 'Машиностроение', 'Maschinenbau', 'Génie mécanique', 'Ingeniería Mecánica'),
    teachingLanguages: ['English'],
    durationMonths: 24,
    durationMonthsMax: 36,
    programUrl: hitMasterUrl,
    applyUrl: hitApplyUrl,
    languageRequirements: hitMasterRequirements,
    sourceIds: ['source-hit-2026-master-admissions'],
  },
  {
    id: 'prog-gap-wave8-hit-long-term-chinese-language',
    ...commonHitProgramAudit,
    name: localized('Long-Term Chinese Language Program', '长期汉语进修项目', 'Долгосрочная программа китайского языка', 'Langzeitprogramm Chinesisch', 'Programme long de langue chinoise', 'Programa de larga duración de lengua china'),
    teachingLanguages: ['Chinese'],
    durationMonths: 4,
    durationMonthsMax: null,
    programUrl: hitLongChineseUrl,
    applyUrl: hitApplyUrl,
    languageRequirements: hitLongChineseRequirements,
    sourceIds: ['src-gap-program-wave8-hit-long-term-chinese-language'],
  },
  {
    id: 'prog-gap-wave8-hit-global-summer-school',
    ...commonHitProgramAudit,
    name: localized('HIT Global Summer School', '哈尔滨工业大学全球暑期学校', 'Глобальная летняя школа HIT', 'HIT Global Summer School', 'École d’été mondiale de HIT', 'Escuela Global de Verano de HIT'),
    teachingLanguages: ['English'],
    durationMonths: null,
    durationMonthsMax: null,
    programUrl: hitGlobalSummerUrl,
    applyUrl: hitApplyUrl,
    languageRequirements: hitGlobalSummerRequirements,
    sourceIds: ['src-gap-program-wave8-hit-global-summer-school'],
  },
  {
    id: 'prog-gap-wave8-hit-pre-university-program',
    ...commonHitProgramAudit,
    name: localized('Chinese-Taught Pre-University Program — 36 Weeks', '中文授课预科项目（36周）', 'Подготовительная программа на китайском языке — 36 недель', 'Chinesischsprachiges Vorbereitungskolleg – 36 Wochen', 'Programme préparatoire en chinois — 36 semaines', 'Programa preparatorio en chino — 36 semanas'),
    teachingLanguages: ['Chinese'],
    durationMonths: 9,
    durationMonthsMax: null,
    programUrl: hitPreUniversityUrl,
    applyUrl: hitApplyUrl,
    languageRequirements: [
      { test: 'other', minimum: 'No minimum HSK score is published for the 36-week Chinese-taught route.' },
      { test: 'other', minimum: hitFoundationEligibility },
    ],
    sourceIds: ['src-gap-program-wave8-hit-pre-university-program'],
  },
  {
    id: 'program-harbin-institute-of-technology-pre-university-chinese-18-week-foundation',
    slug: 'harbin-institute-of-technology-pre-university-chinese-18-week-foundation',
    universityId: 'uni-harbin-institute-of-technology',
    degreeLevel: 'foundation',
    discipline: 'other',
    ...commonHitProgramAudit,
    name: localized('Chinese-Taught Pre-University Program — 18 Weeks', '中文授课预科项目（18周）', 'Подготовительная программа на китайском языке — 18 недель', 'Chinesischsprachiges Vorbereitungskolleg – 18 Wochen', 'Programme préparatoire en chinois — 18 semaines', 'Programa preparatorio en chino — 18 semanas'),
    teachingLanguages: ['Chinese'],
    durationMonths: 4,
    durationMonthsMax: 5,
    programUrl: hitPreUniversityUrl,
    applyUrl: hitApplyUrl,
    languageRequirements: [
      { test: 'HSK', minimum: 'Level 3 or above' },
      { test: 'other', minimum: hitFoundationEligibility },
    ],
    sourceIds: ['src-gap-program-wave8-hit-pre-university-program'],
  },
  {
    id: 'program-harbin-institute-of-technology-pre-university-english-18-week-foundation',
    slug: 'harbin-institute-of-technology-pre-university-english-18-week-foundation',
    universityId: 'uni-harbin-institute-of-technology',
    degreeLevel: 'foundation',
    discipline: 'other',
    ...commonHitProgramAudit,
    name: localized('English-Taught Pre-University Program — 18 Weeks', '英文授课预科项目（18周）', 'Подготовительная программа на английском языке — 18 недель', 'Englischsprachiges Vorbereitungskolleg – 18 Wochen', 'Programme préparatoire en anglais — 18 semaines', 'Programa preparatorio en inglés — 18 semanas'),
    teachingLanguages: ['English'],
    durationMonths: 4,
    durationMonthsMax: 5,
    programUrl: hitPreUniversityUrl,
    applyUrl: hitApplyUrl,
    languageRequirements: [
      { test: 'other', minimum: 'A relevant certificate proving English proficiency is required; the official guide does not publish a numeric minimum.' },
      { test: 'other', minimum: hitFoundationEligibility },
    ],
    sourceIds: ['src-gap-program-wave8-hit-pre-university-program'],
  },
  {
    id: 'prog-gap-wave8-hit-winter-short-term-chinese-2026',
    verifiedAt: checkedAt,
    reviewAfter: winterReviewAfter,
    status: 'verified',
    verificationScope: 'facts',
    name: localized('2026–2027 Winter Short-Term Chinese Language Program', '2026—2027冬季短期汉语项目', 'Зимняя краткосрочная программа китайского языка 2026–2027', 'Winter-Kurzprogramm Chinesisch 2026–2027', 'Programme court d’hiver de langue chinoise 2026–2027', 'Programa breve de invierno de lengua china 2026–2027'),
    teachingLanguages: ['Chinese'],
    durationMonths: 1,
    durationMonthsMax: null,
    programUrl: hitWinterChineseUrl,
    applyUrl: hitApplyUrl,
    languageRequirements: [
      { test: 'other', minimum: 'The official short-term guide does not publish a minimum HSK score.' },
      { test: 'other', minimum: 'Applicant must be a non-Chinese citizen in good physical and mental health.' },
    ],
    sourceIds: ['src-gap-program-wave8-hit-winter-short-term-chinese-2026'],
  },
  ...[
    {
      id: 'program-xian-jiaotong-university-electrical-engineering-and-automation-bachelor',
      name: localized('Electrical Engineering and Automation', '电气工程及其自动化', 'Электротехника и автоматизация', 'Elektrotechnik und Automatisierung', 'Génie électrique et automatisation', 'Ingeniería Eléctrica y Automatización'),
    },
    {
      id: 'program-xian-jiaotong-university-energy-and-power-engineering-bachelor',
      name: localized('Energy and Power Engineering', '能源与动力工程', 'Энергетика и теплоэнергетика', 'Energie- und Kraftwerkstechnik', 'Génie énergétique et thermique', 'Ingeniería Energética y de Potencia'),
    },
    {
      id: 'program-xian-jiaotong-university-intelligent-manufacturing-engineering-bachelor',
      name: localized('Intelligent Manufacturing Engineering', '智能制造工程', 'Интеллектуальное производство', 'Intelligente Fertigungstechnik', 'Génie de la fabrication intelligente', 'Ingeniería de Fabricación Inteligente'),
    },
    {
      id: 'program-xian-jiaotong-university-materials-science-and-engineering-bachelor',
      slug: 'xian-jiaotong-university-materials-science-and-engineering-bachelor',
      universityId: 'uni-xian-jiaotong-university',
      degreeLevel: 'bachelor',
      discipline: 'engineering',
      name: localized('Materials Science and Engineering', '材料科学与工程', 'Материаловедение и инженерия', 'Materialwissenschaft und Werkstofftechnik', 'Science et génie des matériaux', 'Ciencia e Ingeniería de Materiales'),
    },
  ].map((item) => ({
    ...item,
    ...commonXjtuProgramAudit,
    teachingLanguages: ['English'],
    durationMonths: null,
    durationMonthsMax: null,
    programUrl: xjtuProgramListUrl,
    applyUrl: xjtuApplyUrl,
    languageRequirements: [],
    sourceIds: ['source-xjtu-2026-undergraduate-program-list', 'source-xjtu-official-application-system'],
  })),
  {
    id: 'program-xian-jiaotong-university-clinical-medicine-mbbs-bachelor',
    slug: 'xian-jiaotong-university-clinical-medicine-mbbs-bachelor',
    universityId: 'uni-xian-jiaotong-university',
    degreeLevel: 'bachelor',
    discipline: 'medicine',
    ...commonXjtuProgramAudit,
    name: localized('Clinical Medicine (MBBS)', '临床医学（MBBS）', 'Клиническая медицина (MBBS)', 'Klinische Medizin (MBBS)', 'Médecine clinique (MBBS)', 'Medicina Clínica (MBBS)'),
    teachingLanguages: ['English'],
    durationMonths: null,
    durationMonthsMax: null,
    programUrl: xjtuMbbsUrl,
    applyUrl: xjtuApplyUrl,
    languageRequirements: [],
    sourceIds: ['source-xjtu-2026-mbbs-guide', 'source-xjtu-official-application-system'],
  },
]

const hitMasterNotes = localized(
  'Official 2026 master guide: English-taught program, 2–3 years, CNY 34,000/year, CNY 400 self-funded application fee, and 31 May 2026 deadline. This cycle is closed. Evidence: Eligibility; Application Documents and Process; Program Duration; Application Period; Fees; Teaching Language.',
  '依据2026年硕士官方简章：英文授课，学制2—3年，学费每年34000元，自费申请费400元，2026年5月31日截止，当前已关闭。证据定位：申请资格、申请材料与流程、项目学制、申请期、费用、授课语言。',
  'Официальное руководство магистратуры 2026 года: обучение на английском, 2–3 года, 34 000 юаней в год, сбор 400 юаней, срок 31 мая 2026 года закрыт. Источник: Eligibility; Application Documents and Process; Program Duration; Application Period; Fees; Teaching Language.',
  'Offizieller Master-Leitfaden 2026: englischsprachig, 2–3 Jahre, 34.000 CNY/Jahr, 400 CNY Bewerbungsgebühr; Frist 31. Mai 2026 geschlossen. Beleg: Eligibility; Application Documents and Process; Program Duration; Application Period; Fees; Teaching Language.',
  'Guide officiel de master 2026 : enseignement en anglais, 2 à 3 ans, 34 000 CNY/an, frais de dossier de 400 CNY ; échéance du 31 mai 2026 close. Repères : Eligibility; Application Documents and Process; Program Duration; Application Period; Fees; Teaching Language.',
  'Guía oficial de máster 2026: en inglés, 2–3 años, 34.000 CNY/año, tasa de 400 CNY; plazo del 31 de mayo de 2026 cerrado. Evidencia: Eligibility; Application Documents and Process; Program Duration; Application Period; Fees; Teaching Language.',
)

function closedCycle({
  id,
  programId,
  academicYear,
  intake,
  sourceIds,
  closesOn,
  tuitionCny,
  tuitionPeriod,
  applicationFeeCny,
  notes,
  opensOn = null,
  factScope = 'complete',
}) {
  return {
    id,
    programId,
    academicYear,
    intake,
    opensOn,
    closesOn,
    dateStatus: 'previous-cycle-reference',
    tuitionCny,
    tuitionPeriod,
    tuitionStatus: tuitionCny === null ? null : 'confirmed',
    evidenceBasis: 'cycle-specific',
    factScope,
    applicationFeeCny,
    notes,
    sourceIds,
    verifiedAt: checkedAt,
    reviewAfter: checkedAt,
    status: 'stale',
  }
}

const hitLongSpringNotes = localized(
  'The 16-week spring 2026 Chinese program cost CNY 7,300 per semester plus a CNY 400 application fee. Its 15 January 2026 deadline is closed. Evidence: Program Duration; Fees; Eligibility; Application Process.',
  '2026春季16周汉语项目学费每学期7300元，申请费400元；2026年1月15日截止，当前已关闭。证据定位：项目学制、费用、资格、申请流程。',
  'Весенняя 16-недельная программа 2026 года стоила 7 300 юаней за семестр плюс сбор 400 юаней; срок 15 января 2026 года закрыт. Источник: Program Duration; Fees; Eligibility; Application Process.',
  'Das 16-wöchige Frühjahrsprogramm 2026 kostete 7.300 CNY pro Semester plus 400 CNY Bewerbungsgebühr; Frist 15. Januar 2026 geschlossen. Beleg: Program Duration; Fees; Eligibility; Application Process.',
  'Le programme de chinois de 16 semaines du printemps 2026 coûtait 7 300 CNY par semestre, plus 400 CNY de frais de dossier ; échéance du 15 janvier 2026 close. Repères : Program Duration; Fees; Eligibility; Application Process.',
  'El programa de chino de 16 semanas de primavera de 2026 costaba 7.300 CNY por semestre más 400 CNY de solicitud; plazo del 15 de enero de 2026 cerrado. Evidencia: Program Duration; Fees; Eligibility; Application Process.',
)
const hitLongAutumnNotes = localized(
  'The 16-week autumn 2026 Chinese program cost CNY 7,300 per semester plus a CNY 400 application fee. Its 15 July 2026 deadline is closed. Evidence: Program Duration; Fees; Eligibility; Application Process.',
  '2026秋季16周汉语项目学费每学期7300元，申请费400元；2026年7月15日截止，当前已关闭。证据定位：项目学制、费用、资格、申请流程。',
  'Осенняя 16-недельная программа 2026 года стоила 7 300 юаней за семестр плюс сбор 400 юаней; срок 15 июля 2026 года закрыт. Источник: Program Duration; Fees; Eligibility; Application Process.',
  'Das 16-wöchige Herbstprogramm 2026 kostete 7.300 CNY pro Semester plus 400 CNY Bewerbungsgebühr; Frist 15. Juli 2026 geschlossen. Beleg: Program Duration; Fees; Eligibility; Application Process.',
  'Le programme de chinois de 16 semaines de l’automne 2026 coûtait 7 300 CNY par semestre, plus 400 CNY de frais de dossier ; échéance du 15 juillet 2026 close. Repères : Program Duration; Fees; Eligibility; Application Process.',
  'El programa de chino de 16 semanas de otoño de 2026 costaba 7.300 CNY por semestre más 400 CNY de solicitud; plazo del 15 de julio de 2026 cerrado. Evidencia: Program Duration; Fees; Eligibility; Application Process.',
)

const hitPreUniversityCommonNotes = {
  sourceIds: ['src-gap-program-wave8-hit-pre-university-program'],
  academicYear: '2025-2026',
  intake: 'spring',
  closesOn: '2026-01-31',
  tuitionPeriod: 'program',
  applicationFeeCny: 400,
}



const cycleSpecs = [
  closedCycle({
    id: 'cycle-2026-hit-civil-engineering-master-autumn',
    programId: 'program-harbin-institute-of-technology-civil-engineering-master',
    academicYear: '2026-2027',
    intake: 'autumn',
    sourceIds: ['source-hit-2026-master-admissions'],
    closesOn: '2026-05-31',
    tuitionCny: 34000,
    tuitionPeriod: 'academic-year',
    applicationFeeCny: 400,
    notes: hitMasterNotes,
  }),
  closedCycle({
    id: 'cycle-2026-hit-mechanical-engineering-master-autumn',
    programId: 'program-harbin-institute-of-technology-mechanical-engineering-master',
    academicYear: '2026-2027',
    intake: 'autumn',
    sourceIds: ['source-hit-2026-master-admissions'],
    closesOn: '2026-05-31',
    tuitionCny: 34000,
    tuitionPeriod: 'academic-year',
    applicationFeeCny: 400,
    notes: hitMasterNotes,
  }),
  closedCycle({
    id: 'cycle-2026-hit-long-term-chinese-language-spring',
    programId: 'prog-gap-wave8-hit-long-term-chinese-language',
    academicYear: '2025-2026',
    intake: 'spring',
    sourceIds: ['src-gap-program-wave8-hit-long-term-chinese-language'],
    closesOn: '2026-01-15',
    tuitionCny: 7300,
    tuitionPeriod: 'semester',
    applicationFeeCny: 400,
    notes: hitLongSpringNotes,
  }),
  closedCycle({
    id: 'cycle-gap-wave8-hit-long-term-chinese-language-2026-2027-autumn',
    programId: 'prog-gap-wave8-hit-long-term-chinese-language',
    academicYear: '2026-2027',
    intake: 'autumn',
    sourceIds: ['src-gap-program-wave8-hit-long-term-chinese-language'],
    closesOn: '2026-07-15',
    tuitionCny: 7300,
    tuitionPeriod: 'semester',
    applicationFeeCny: 400,
    notes: hitLongAutumnNotes,
  }),
  closedCycle({
    id: 'cycle-2026-hit-global-summer-school-other',
    programId: 'prog-gap-wave8-hit-global-summer-school',
    academicYear: '2025-2026',
    intake: 'other',
    sourceIds: ['src-gap-program-wave8-hit-global-summer-school'],
    closesOn: '2026-06-10',
    tuitionCny: 0,
    tuitionPeriod: 'program',
    applicationFeeCny: null,
    factScope: 'partial',
    notes: localized(
      'The 2026 HIT Global Summer School deadline is closed. Registration, tuition and accommodation fees were waived; participants paid transportation, meals and personal expenses. Eligibility was limited to undergraduate, master or doctoral students from partner/cooperative institutions, with fluent English required. Theme dates varied, so durationMonths remains null. Evidence: About HITGSS; Application Deadline; Registration Information; Costs.',
      '2026年哈工大全球暑期学校申请已截止。项目免注册费、学费和住宿费，交通、餐食及个人费用自理；仅面向合作院校本科、硕士和博士生，要求英语流利。各主题日期不同，因此durationMonths保持为空。证据定位：项目介绍、申请截止、注册信息、费用。',
      'Приём на HITGSS 2026 закрыт. Регистрация, обучение и проживание были бесплатными; транспорт, питание и личные расходы оплачивались участниками. Требовались партнёрский вуз и свободный английский. Даты тем различались, поэтому durationMonths остаётся null.',
      'Die Bewerbung für HITGSS 2026 ist geschlossen. Registrierung, Studiengebühren und Unterkunft waren erlassen; Reise, Mahlzeiten und persönliche Kosten trugen Teilnehmende. Partnerhochschule und fließendes Englisch waren erforderlich. Wegen unterschiedlicher Themendaten bleibt durationMonths null.',
      'Les candidatures HITGSS 2026 sont closes. Inscription, scolarité et logement étaient exonérés ; transport, repas et dépenses personnelles restaient à la charge des participants. Université partenaire et anglais courant requis. Les dates variant selon le thème, durationMonths reste null.',
      'La convocatoria HITGSS 2026 está cerrada. Se eximían inscripción, matrícula y alojamiento; transporte, comidas y gastos personales corrían por cuenta del participante. Se exigían universidad asociada e inglés fluido. Como las fechas variaban por tema, durationMonths queda null.',
    ),
  }),
  closedCycle({
    id: 'cycle-2026-hit-pre-university-chinese-36-week-autumn',
    programId: 'prog-gap-wave8-hit-pre-university-program',
    academicYear: '2026-2027',
    intake: 'autumn',
    sourceIds: ['src-gap-program-wave8-hit-pre-university-program'],
    closesOn: '2026-07-31',
    tuitionCny: 24600,
    tuitionPeriod: 'program',
    applicationFeeCny: 400,
    notes: localized(
      'Chinese-taught 36-week route covering autumn and spring terms; CNY 24,600 tuition and CNY 400 application fee. The 31 July 2026 deadline is closed. Evidence: Programs and Fees table; Eligibility; Application Documents; Application Process.',
      '中文授课36周路线覆盖秋季和春季，学费24600元、申请费400元；2026年7月31日截止，当前已关闭。证据定位：项目与费用表、资格、申请材料、申请流程。',
      '36-недельная подготовительная программа на китайском языке, 24 600 юаней плюс сбор 400 юаней; срок 31 июля 2026 года закрыт. Источник: Programs and Fees; Eligibility; Application Documents; Application Process.',
      '36-wöchiges chinesischsprachiges Vorbereitungsprogramm, 24.600 CNY plus 400 CNY Gebühr; Frist 31. Juli 2026 geschlossen. Beleg: Programs and Fees; Eligibility; Application Documents; Application Process.',
      'Parcours préparatoire de 36 semaines en chinois, 24 600 CNY plus 400 CNY de frais ; échéance du 31 juillet 2026 close. Repères : Programs and Fees; Eligibility; Application Documents; Application Process.',
      'Ruta preparatoria de 36 semanas en chino, 24.600 CNY más 400 CNY de solicitud; plazo del 31 de julio de 2026 cerrado. Evidencia: Programs and Fees; Eligibility; Application Documents; Application Process.',
    ),
  }),
  closedCycle({
    id: 'cycle-2026-hit-pre-university-chinese-18-week-spring',
    programId: 'program-harbin-institute-of-technology-pre-university-chinese-18-week-foundation',
    ...hitPreUniversityCommonNotes,
    tuitionCny: 12300,
    notes: localized(
      'Chinese-taught 18-week spring route requiring HSK 3 or above; CNY 12,300 tuition and CNY 400 application fee. The 31 January 2026 deadline is closed. Evidence: Programs and Fees table; Application Documents item 4; Application Process.',
      '中文授课18周春季路线要求HSK三级及以上，学费12300元、申请费400元；2026年1月31日截止，当前已关闭。证据定位：项目与费用表、申请材料第4项、申请流程。',
      '18-недельная весенняя программа на китайском требует HSK 3+, стоит 12 300 юаней плюс сбор 400 юаней; срок 31 января 2026 закрыт.',
      '18-wöchiges chinesischsprachiges Frühjahrsprogramm mit HSK 3+, 12.300 CNY plus 400 CNY Gebühr; Frist 31. Januar 2026 geschlossen.',
      'Parcours de printemps de 18 semaines en chinois avec HSK 3+, 12 300 CNY plus 400 CNY de frais ; échéance du 31 janvier 2026 close.',
      'Ruta de primavera de 18 semanas en chino con HSK 3+, 12.300 CNY más 400 CNY; plazo del 31 de enero de 2026 cerrado.',
    ),
  }),
  closedCycle({
    id: 'cycle-2026-hit-pre-university-english-18-week-spring',
    programId: 'program-harbin-institute-of-technology-pre-university-english-18-week-foundation',
    ...hitPreUniversityCommonNotes,
    tuitionCny: 18000,
    notes: localized(
      'English-taught 18-week spring route requiring a relevant English-proficiency certificate; CNY 18,000 tuition and CNY 400 application fee. The 31 January 2026 deadline is closed. Evidence: Programs and Fees table; Application Documents item 4; Application Process.',
      '英文授课18周春季路线要求相关英语能力证明，学费18000元、申请费400元；2026年1月31日截止，当前已关闭。证据定位：项目与费用表、申请材料第4项、申请流程。',
      '18-недельная весенняя программа на английском требует подтверждения английского, стоит 18 000 юаней плюс сбор 400 юаней; срок 31 января 2026 закрыт.',
      '18-wöchiges englischsprachiges Frühjahrsprogramm mit Englischnachweis, 18.000 CNY plus 400 CNY Gebühr; Frist 31. Januar 2026 geschlossen.',
      'Parcours de printemps de 18 semaines en anglais avec justificatif linguistique, 18 000 CNY plus 400 CNY ; échéance du 31 janvier 2026 close.',
      'Ruta de primavera de 18 semanas en inglés con certificado de idioma, 18.000 CNY más 400 CNY; plazo del 31 de enero de 2026 cerrado.',
    ),
  }),
  {
    id: 'cycle-gap-wave8-hit-winter-short-term-chinese-2026-2026-2027-other',
    programId: 'prog-gap-wave8-hit-winter-short-term-chinese-2026',
    academicYear: '2026-2027',
    intake: 'other',
    opensOn: null,
    closesOn: '2026-11-30',
    dateStatus: 'published',
    tuitionCny: 3500,
    tuitionPeriod: 'program',
    tuitionStatus: 'confirmed',
    evidenceBasis: 'cycle-specific',
    factScope: 'complete',
    applicationFeeCny: 400,
    notes: localized(
      'Four-week winter Chinese and culture program, 28 December 2026–24 January 2027. Tuition is CNY 3,500, insurance CNY 160, application fee CNY 400 and accommodation CNY 800–1,000/month/bed; all except accommodation are non-refundable. Deadline: 30 November 2026. Evidence: Program Duration; Fees; Eligibility; Application Process.',
      '四周冬季汉语文化项目，学习期为2026年12月28日至2027年1月24日。学费3500元、保险160元、申请费400元，住宿800—1000元/月/床；除住宿费外均不退。截止日为2026年11月30日。证据定位：项目学制、费用、资格、申请流程。',
      'Четырёхнедельная зимняя программа 28.12.2026–24.01.2027: обучение 3 500, страховка 160, сбор 400, проживание 800–1 000 юаней/месяц/место. Кроме проживания, платежи невозвратны. Срок 30.11.2026.',
      'Vierwöchiges Winterprogramm 28.12.2026–24.01.2027: 3.500 CNY Studiengebühr, 160 CNY Versicherung, 400 CNY Bewerbung, 800–1.000 CNY/Monat/Bett Unterkunft. Außer Unterkunft nicht erstattbar. Frist 30.11.2026.',
      'Programme d’hiver de quatre semaines, du 28 décembre 2026 au 24 janvier 2027 : 3 500 CNY de scolarité, 160 CNY d’assurance, 400 CNY de dossier, logement 800–1 000 CNY/mois/lit. Hors logement, frais non remboursables. Échéance : 30 novembre 2026.',
      'Programa de invierno de cuatro semanas, 28-12-2026 a 24-1-2027: matrícula 3.500 CNY, seguro 160 CNY, solicitud 400 CNY y alojamiento 800–1.000 CNY/mes/cama. Salvo alojamiento, no reembolsable. Plazo: 30-11-2026.',
    ),
    sourceIds: ['src-gap-program-wave8-hit-winter-short-term-chinese-2026'],
    verifiedAt: checkedAt,
    reviewAfter: winterReviewAfter,
    status: 'verified',
  },
]

const scholarshipSpecs = [
  {
    id: 'scholarship-xian-jiaotong-university-international-student',
    name: localized('XJTU International Undergraduate Freshman Scholarship', '西安交通大学国际本科新生奖学金', 'Стипендия XJTU для иностранных первокурсников бакалавриата', 'XJTU-Stipendium für internationale Bachelor-Erstsemester', 'Bourse XJTU pour nouveaux étudiants internationaux de licence', 'Beca XJTU para nuevos estudiantes internacionales de grado'),
    providerType: 'university',
    universityIds: ['uni-xian-jiaotong-university'],
    programIds: [],
    coverage: {
      tuition: 'unknown',
      accommodation: 'unknown',
      insurance: 'unknown',
      stipendCnyPerMonth: null,
    },
    deadline: null,
    applicationUrl: null,
    summary: localized(
      'Scholarship identity retained only. Eligible-program scope, benefit tiers, deadline and application route are quarantined until an archiveable official XJTU PDF snapshot is captured.',
      '仅保留奖学金身份。适用项目范围、资助档位、截止日期和申请入口在取得可归档的西安交大官方PDF快照前均处于隔离状态。',
      'Сохранено только наименование стипендии. Охват программ, размеры, срок и маршрут подачи изолированы до получения архивируемого официального PDF XJTU.',
      'Nur die Stipendienidentität bleibt erhalten. Programmumfang, Förderstufen, Frist und Bewerbungsweg bleiben bis zu einem archivierbaren offiziellen XJTU-PDF isoliert.',
      'Seule l’identité de la bourse est conservée. Portée, niveaux d’aide, échéance et voie de candidature restent isolés jusqu’à l’obtention d’un PDF officiel XJTU archivable.',
      'Solo se conserva la identidad de la beca. Alcance, niveles de ayuda, plazo y vía de solicitud quedan aislados hasta obtener un PDF oficial de XJTU archivable.',
    ),
    sourceIds: ['source-xjtu-2026-undergraduate-fees-scholarships'],
    verifiedAt: checkedAt,
    reviewAfter: checkedAt,
    status: 'stale',
  },
  {
    id: 'scholarship-xian-belt-and-road',
    name: localized("Xi'an City Government Belt and Road Scholarship at XJTU", '西安市政府“一带一路”奖学金（西安交通大学）', 'Стипендия правительства Сианя «Пояс и путь» в XJTU', 'Xi’an City Government Belt-and-Road-Stipendium an der XJTU', 'Bourse « Ceinture et Route » du gouvernement municipal de Xi’an à XJTU', 'Beca del Gobierno Municipal de Xi’an de la Franja y la Ruta en XJTU'),
    providerType: 'city',
    universityIds: ['uni-xian-jiaotong-university'],
    programIds: [],
    coverage: {
      tuition: 'unknown',
      accommodation: 'unknown',
      insurance: 'unknown',
      stipendCnyPerMonth: null,
    },
    deadline: null,
    applicationUrl: null,
    summary: localized(
      'Scholarship identity retained only. XJTU applicability, current benefits, deadline and application route are quarantined until an archiveable official XJTU PDF snapshot is captured.',
      '仅保留奖学金身份。其在西安交大的适用范围、当期资助内容、截止日期和申请入口在取得可归档的官方PDF快照前均处于隔离状态。',
      'Сохранено только наименование стипендии. Применимость в XJTU, текущие льготы, срок и маршрут подачи изолированы до получения архивируемого официального PDF.',
      'Nur die Stipendienidentität bleibt erhalten. Anwendbarkeit an der XJTU, aktuelle Leistungen, Frist und Bewerbungsweg bleiben bis zu einem archivierbaren offiziellen PDF isoliert.',
      'Seule l’identité de la bourse est conservée. Applicabilité à XJTU, avantages actuels, échéance et voie de candidature restent isolés jusqu’à un PDF officiel archivable.',
      'Solo se conserva la identidad de la beca. Aplicabilidad en XJTU, beneficios actuales, plazo y vía de solicitud quedan aislados hasta obtener un PDF oficial archivable.',
    ),
    sourceIds: ['source-xjtu-2026-undergraduate-fees-scholarships'],
    verifiedAt: checkedAt,
    reviewAfter: checkedAt,
    status: 'stale',
  },
]
const expectedExistingProgramIds = new Set([
  'program-harbin-institute-of-technology-civil-engineering-master',
  'program-harbin-institute-of-technology-mechanical-engineering-master',
  'prog-gap-wave8-hit-long-term-chinese-language',
  'prog-gap-wave8-hit-global-summer-school',
  'prog-gap-wave8-hit-pre-university-program',
  'prog-gap-wave8-hit-winter-short-term-chinese-2026',
  'program-xian-jiaotong-university-electrical-engineering-and-automation-bachelor',
  'program-xian-jiaotong-university-energy-and-power-engineering-bachelor',
  'program-xian-jiaotong-university-intelligent-manufacturing-engineering-bachelor',
])
const quarantinedXjtuChineseProgramIds = new Set([
  'program-xian-jiaotong-university-chinese-language-program-one-semester-language',
  'program-xian-jiaotong-university-chinese-language-program-one-academic-year-language',
])
const quarantinedXjtuDynamicCycleIds = new Set([
  'cycle-2026-xian-jiaotong-university-electrical-engineering-and-automation-bachelor-autumn',
  'cycle-2026-xian-jiaotong-university-energy-and-power-engineering-bachelor-autumn',
  'cycle-2026-xian-jiaotong-university-intelligent-manufacturing-engineering-bachelor-autumn',
  'cycle-2026-xian-jiaotong-university-materials-science-and-engineering-bachelor-autumn',
  'cycle-2026-xian-jiaotong-university-clinical-medicine-mbbs-bachelor-autumn',
])

const sources = read('sources.json')
const programs = read('programs.json')
let admissionCycles = read('admission-cycles.json')
const scholarships = read('scholarships.json')

for (const source of sourceSpecs) upsertById(sources, source)

for (const spec of programSpecs) {
  if (expectedExistingProgramIds.has(spec.id) && !programs.some((program) => program.id === spec.id)) {
    throw new Error(`Expected HIT/XJTU program is missing: ${spec.id}`)
  }
  upsertById(programs, spec, true)
}

for (const id of quarantinedXjtuChineseProgramIds) {
  if (programs.some((program) => program.id === id)) {
    throw new Error(`Quarantined XJTU Chinese-language identity must not be public: ${id}`)
  }
}

const cycleCountBeforeEvidenceGate = admissionCycles.length
admissionCycles = admissionCycles.filter((cycle) => !quarantinedXjtuDynamicCycleIds.has(cycle.id))
const xjtuDynamicCyclesRemoved = cycleCountBeforeEvidenceGate - admissionCycles.length

for (const cycle of cycleSpecs) upsertById(admissionCycles, cycle)

for (const spec of scholarshipSpecs) {
  if (!scholarships.some((scholarship) => scholarship.id === spec.id)) {
    throw new Error(`Expected XJTU scholarship is missing: ${spec.id}`)
  }
  upsertById(scholarships, spec, true)
}

write('sources.json', sources)
write('programs.json', programs)
write('admission-cycles.json', admissionCycles)
write('scholarships.json', scholarships)

console.log(JSON.stringify({
  checkedAt,
  sourcesUpserted: sourceSpecs.length,
  programsUpdated: programSpecs.length - 4,
  programsAdded: 4,
  closedCyclesUpserted: cycleSpecs.filter((cycle) => cycle.status === 'stale').length,
  activeCyclesRefreshed: cycleSpecs.filter((cycle) => cycle.status === 'verified').length,
  scholarshipsUpdated: scholarshipSpecs.length,
  xjtuDynamicCyclesQuarantined: quarantinedXjtuDynamicCycleIds.size,
  xjtuDynamicCyclesRemoved,
  xjtuScholarshipDynamicFactsPublished: 0,
  quarantinedProgramsPublished: 0,
}, null, 2))
