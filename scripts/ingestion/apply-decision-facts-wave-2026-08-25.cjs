const fs = require('node:fs')
const path = require('node:path')

const dataDir = path.join(process.cwd(), 'content', 'data')
const checkedAt = '2026-08-25'
const reviewAfter = '2026-09-24'

const read = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'))
const write = (name, value) => fs.writeFileSync(
  path.join(dataDir, name),
  `${JSON.stringify(value, null, 2)}\n`,
  'utf8',
)
const localized = (en, zh, ru, de, fr, es) => ({ en, zh, ru, de, fr, es })
const normalize = (value) => String(value ?? '')
  .normalize('NFKD')
  .toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
  .trim()

const sources = read('sources.json')
const programs = read('programs.json')
let admissionCycles = read('admission-cycles.json')
const scholarships = read('scholarships.json')

function upsertById(items, addition) {
  const index = items.findIndex((item) => item.id === addition.id)
  if (index === -1) items.push(addition)
  else items[index] = { ...items[index], ...addition }
}

const sourceSpecs = [
  {
    id: 'source-zju-2026-undergraduate-guide',
    url: 'https://iczu.zju.edu.cn/admissionsen/2024/1030/c68988a2981659/page.htm',
    title: 'Zhejiang University Application Guide for Undergraduate Programs 2026',
    publisher: 'Zhejiang University', kind: 'admissions', language: 'en', official: true,
  },
  {
    id: 'source-zju-2026-english-undergraduate-catalog',
    url: 'https://iczu.zju.edu.cn/_upload/article/files/e7/8c/1be7b2df433fb9427df707571d84/f8f1cb33-05a5-4fec-a602-3eac6caf8e14.pdf',
    title: 'Zhejiang University English-taught Undergraduate Programs 2026',
    publisher: 'Zhejiang University', kind: 'program', language: 'en', official: true,
  },
  {
    id: 'source-zju-2026-master-guide',
    url: 'https://iczu.zju.edu.cn/admissionsen/2024/1030/c68989a2981849/page.psp',
    title: "Zhejiang University Application Guide for Master's Degree Programs 2026",
    publisher: 'Zhejiang University', kind: 'admissions', language: 'en', official: true,
  },
  {
    id: 'source-zju-2026-english-master-catalog',
    url: 'https://iczu.zju.edu.cn/_upload/article/files/32/c1/d48dfe1349279755c872b98ce7e1/aae5a919-1f07-4115-bb1c-db41ea36e1b0.pdf',
    title: "Zhejiang University English-taught Master's Degree Programs 2026",
    publisher: 'Zhejiang University', kind: 'program', language: 'en', official: true,
  },
  {
    id: 'source-zju-2026-graduate-language-requirements',
    url: 'https://iczu.zju.edu.cn/_upload/article/files/32/c1/d48dfe1349279755c872b98ce7e1/58e973ef-c184-4851-a78b-e72c230d213a.pdf',
    title: 'Language Requirements for ZJU International Graduate Programs',
    publisher: 'Zhejiang University', kind: 'admissions', language: 'en', official: true,
  },
  {
    id: 'source-hutb-2026-inclusive-scholarship',
    url: 'https://iec.hutb.edu.cn/xwzx/tzgg/content_90133',
    title: 'HUTB 2026 International Student Enrollment Guide — Scholarships',
    publisher: 'Hunan University of Technology and Business', kind: 'scholarship', language: 'en', official: true,
  },
  {
    id: 'source-hdu-2026-international-admission-guide',
    url: 'https://intedu.hdu.edu.cn/intedu_en/2026/0317/c13972a290327/page.htm',
    title: 'HDU 2026 Application Guideline',
    publisher: 'Hangzhou Dianzi University', kind: 'program', language: 'en', official: true,
  },
  {
    id: 'source-hdu-international-student-regulations',
    url: 'https://intedu.hdu.edu.cn/intedu_en/13986/list.htm',
    title: 'HDU International Student Regulations',
    publisher: 'Hangzhou Dianzi University', kind: 'program', language: 'en', official: true,
  },
  {
    id: 'source-gzhu-2026-public-administration-admission',
    url: 'https://gupa.gzhu.edu.cn/info/1299/19339.htm',
    title: 'Guangzhou University Public Administration (Smart Governance) 2026 International Admission Guide',
    publisher: 'Guangzhou University', kind: 'program', language: 'en', official: true,
  },
].map((source) => ({ ...source, accessedAt: checkedAt }))

for (const source of sourceSpecs) upsertById(sources, source)

for (const id of [
  'src-gap-program-wave8-2-hutb-chinese-language',
  'src-gap-program-wave8-2-hutb-international-business-master',
  'src-gap-scholarship-wave8-2-hutb-belt-road-language-scholarship',
  'src-gap-scholarship-mew-csw-hutb-hunan-provincial-scholarship',
  'src-gap-scholarship-wave6-gzhu-international-student-scholarship-2026',
]) {
  const source = sources.find((item) => item.id === id)
  if (!source) throw new Error(`Expected source is missing: ${id}`)
  source.accessedAt = checkedAt
}

const bachelorEnglishRequirements = [
  { test: 'IELTS', minimum: '6.0 overall (academic), with at least 5.0 in each component' },
  { test: 'TOEFL', minimum: '75 iBT, with at least 15 in each component' },
  { test: 'other', minimum: 'CAE 170 or Duolingo 100; IB/A-level or another accepted standardized score may support exemption. Math, Physics, Chemistry and Biology high-school results must each be at least 70%.' },
]
const zjuMasterEnglishRequirements = [
  { test: 'IELTS', minimum: '6.5' },
  { test: 'TOEFL', minimum: '90' },
  { test: 'other', minimum: 'Duolingo 120, CAE/CPE 180, or qualifying English-medium degree proof; applicants from recognized native-English countries are exempt.' },
]
const hduEnglishRequirements = [
  { test: 'other', minimum: 'A valid IELTS, TOEFL, Duolingo or EF SET result is required; the 2026 guide does not publish one universal minimum score.' },
]

const programSpecs = [
  {
    id: 'program-zhejiang-university-clinical-medicine-mbbs-bachelor',
    slug: 'zhejiang-university-clinical-medicine-mbbs-bachelor',
    universityId: 'uni-zhejiang-university',
    aliases: ['Clinical Medicine (MBBS)', 'MBBS'],
    name: localized('Clinical Medicine (MBBS)', '临床医学（MBBS）', 'Клиническая медицина (MBBS)', 'Klinische Medizin (MBBS)', 'Médecine clinique (MBBS)', 'Medicina clínica (MBBS)'),
    degreeLevel: 'bachelor', discipline: 'medicine', teachingLanguages: ['English'], durationMonths: 72,
    programUrl: sourceSpecs[1].url, applyUrl: 'https://intlstudent.zju.edu.cn/',
    languageRequirements: bachelorEnglishRequirements,
    sourceIds: ['source-zju-2026-english-undergraduate-catalog', 'source-zju-2026-undergraduate-guide'],
  },
  {
    id: 'program-zhejiang-university-biomedical-engineering-bachelor',
    slug: 'zhejiang-university-biomedical-engineering-bachelor',
    universityId: 'uni-zhejiang-university', aliases: ['Biomedical Engineering'],
    name: localized('Biomedical Engineering', '生物医学工程', 'Биомедицинская инженерия', 'Biomedizintechnik', 'Génie biomédical', 'Ingeniería biomédica'),
    degreeLevel: 'bachelor', discipline: 'engineering', teachingLanguages: ['English'], durationMonths: 48,
    programUrl: sourceSpecs[1].url, applyUrl: 'https://intlstudent.zju.edu.cn/',
    languageRequirements: bachelorEnglishRequirements,
    sourceIds: ['source-zju-2026-english-undergraduate-catalog', 'source-zju-2026-undergraduate-guide'],
  },
  {
    id: 'program-zhejiang-university-china-studies-mcs-master',
    slug: 'zhejiang-university-china-studies-mcs-master',
    universityId: 'uni-zhejiang-university', aliases: ['China Studies (MCS)', 'China Studies'],
    name: localized('China Studies (MCS)', '中国学硕士（MCS）', 'Китаеведение (MCS)', 'Chinastudien (MCS)', 'Études chinoises (MCS)', 'Estudios sobre China (MCS)'),
    degreeLevel: 'master', discipline: 'humanities', teachingLanguages: ['English'], durationMonths: 24,
    programUrl: sourceSpecs[3].url, applyUrl: 'https://intlstudent.zju.edu.cn/',
    languageRequirements: zjuMasterEnglishRequirements,
    sourceIds: ['source-zju-2026-english-master-catalog', 'source-zju-2026-master-guide', 'source-zju-2026-graduate-language-requirements'],
  },
  {
    id: 'program-zhejiang-university-business-administration-master',
    slug: 'zhejiang-university-business-administration-master',
    universityId: 'uni-zhejiang-university', aliases: ['Business Administration', 'Business Administration (iMBA-full-time)', 'Business Administration (iMBA)'],
    name: localized('Business Administration (iMBA)', '工商管理（iMBA）', 'Деловое администрирование (iMBA)', 'Betriebswirtschaftslehre (iMBA)', 'Administration des affaires (iMBA)', 'Administración de empresas (iMBA)'),
    degreeLevel: 'master', discipline: 'business', teachingLanguages: ['English'], durationMonths: 24,
    programUrl: sourceSpecs[3].url, applyUrl: 'https://intlstudent.zju.edu.cn/',
    languageRequirements: zjuMasterEnglishRequirements,
    sourceIds: ['source-zju-2026-english-master-catalog', 'source-zju-2026-master-guide', 'source-zju-2026-graduate-language-requirements'],
  },
  {
    id: 'program-zhejiang-university-finance-imf-master',
    slug: 'zhejiang-university-finance-imf-master',
    universityId: 'uni-zhejiang-university', aliases: ['Finance (iMF)'],
    name: localized('Finance (iMF)', '金融（iMF）', 'Финансы (iMF)', 'Finanzen (iMF)', 'Finance (iMF)', 'Finanzas (iMF)'),
    degreeLevel: 'master', discipline: 'business', teachingLanguages: ['English'], durationMonths: 24,
    programUrl: sourceSpecs[3].url, applyUrl: 'https://intlstudent.zju.edu.cn/',
    languageRequirements: zjuMasterEnglishRequirements,
    sourceIds: ['source-zju-2026-english-master-catalog', 'source-zju-2026-master-guide', 'source-zju-2026-graduate-language-requirements'],
  },
  {
    id: 'program-zhejiang-university-data-science-imds-master',
    slug: 'zhejiang-university-data-science-imds-master',
    universityId: 'uni-zhejiang-university', aliases: ['Data Science (iMDS)'],
    name: localized('Data Science (iMDS)', '数据科学（iMDS）', 'Наука о данных (iMDS)', 'Datenwissenschaft (iMDS)', 'Science des données (iMDS)', 'Ciencia de datos (iMDS)'),
    degreeLevel: 'master', discipline: 'engineering', teachingLanguages: ['English'], durationMonths: 36,
    programUrl: sourceSpecs[3].url, applyUrl: 'https://intlstudent.zju.edu.cn/',
    languageRequirements: zjuMasterEnglishRequirements,
    sourceIds: ['source-zju-2026-english-master-catalog', 'source-zju-2026-master-guide', 'source-zju-2026-graduate-language-requirements'],
  },
  {
    id: 'prog-gap-wave8-2-hutb-international-business-master',
    slug: 'gap-wave8-2-hutb-international-business-master-master',
    universityId: 'uni-hunan-university-of-technology-and-business',
    name: localized("International Business (English-taught Master's Program)", '国际商务（英文授课硕士）', 'Международный бизнес (магистратура на английском языке)', 'International Business (englischsprachiger Master)', 'Commerce international (master en anglais)', 'Negocios internacionales (máster en inglés)'),
    degreeLevel: 'master', discipline: 'business', teachingLanguages: ['English'], durationMonths: 36,
    programUrl: 'https://iec.hutb.edu.cn/xwzx/tzgg/content_90133', applyUrl: 'https://hutb.at0086.cn/student',
    languageRequirements: [
      { test: 'IELTS', minimum: '5.5' },
      { test: 'TOEFL', minimum: '50' },
      { test: 'other', minimum: 'Equivalent English certificate or proof of English-medium high-school study' },
    ],
    sourceIds: ['src-gap-program-wave8-2-hutb-international-business-master'],
  },
  {
    id: 'prog-gap-wave8-2-hutb-chinese-language',
    slug: 'gap-wave8-2-hutb-chinese-language-language',
    universityId: 'uni-hunan-university-of-technology-and-business',
    name: localized('Chinese Language Program', '汉语言进修项目', 'Программа китайского языка', 'Chinesisch-Sprachprogramm', 'Programme de langue chinoise', 'Programa de lengua china'),
    degreeLevel: 'language', discipline: 'chinese-education', teachingLanguages: ['Chinese', 'English'], durationMonths: 12,
    programUrl: 'https://iec.hutb.edu.cn/xwzx/tzgg/content_90133', applyUrl: 'https://hutb.at0086.cn/student',
    languageRequirements: [], sourceIds: ['src-gap-program-wave8-2-hutb-chinese-language'],
  },
  ...[
    ['prog-gap-prog-hdu-artificial-intelligence-bachelor-2026', 'gap-prog-hdu-artificial-intelligence-bachelor-2026-bachelor', 'Artificial Intelligence', '人工智能', 'Искусственный интеллект', 'Künstliche Intelligenz', 'Intelligence artificielle', 'Inteligencia artificial', 'engineering', ['English'], 20000],
    ['prog-gap-prog-hdu-business-management-bachelor-2026', 'gap-prog-hdu-business-management-bachelor-2026-bachelor', 'Business Management', '工商管理', 'Управление бизнесом', 'Betriebswirtschaft', 'Gestion des entreprises', 'Gestión empresarial', 'business', ['English', 'Chinese'], 18000],
    ['prog-gap-prog-hdu-computer-science-bachelor-2026', 'gap-prog-hdu-computer-science-bachelor-2026-bachelor', 'Computer Science and Technology', '计算机科学与技术', 'Компьютерные науки и технологии', 'Informatik und Technologie', 'Informatique et technologie', 'Informática y tecnología', 'engineering', ['English'], 20000],
    ['prog-gap-prog-hdu-digital-economy-bachelor-2026', 'gap-prog-hdu-digital-economy-bachelor-2026-bachelor', 'Digital Economy (Digital Trade)', '数字经济（数字贸易方向）', 'Цифровая экономика (цифровая торговля)', 'Digitale Wirtschaft (Digitaler Handel)', 'Économie numérique (commerce numérique)', 'Economía digital (comercio digital)', 'business', ['English', 'Chinese'], 18000],
    ['prog-gap-prog-hdu-mechanical-bachelor-2026', 'gap-prog-hdu-mechanical-bachelor-2026-bachelor', 'Mechanical Design, Manufacturing and Automation', '机械设计制造及其自动化', 'Проектирование, производство и автоматизация машин', 'Maschinenkonstruktion, Fertigung und Automatisierung', 'Conception mécanique, fabrication et automatisation', 'Diseño mecánico, fabricación y automatización', 'engineering', ['English'], 20000],
    ['program-hangzhou-dianzi-university-software-engineering-bachelor', 'hangzhou-dianzi-university-software-engineering-bachelor', 'Software Engineering', '软件工程', 'Программная инженерия', 'Softwaretechnik', 'Génie logiciel', 'Ingeniería de software', 'engineering', ['English'], 20000],
  ].map(([id, slug, en, zh, ru, de, fr, es, discipline, teachingLanguages]) => ({
    id, slug, universityId: 'uni-hangzhou-dianzi-university',
    aliases: [en], name: localized(en, zh, ru, de, fr, es), degreeLevel: 'bachelor', discipline,
    teachingLanguages, durationMonths: 48, programUrl: sourceSpecs[6].url,
    applyUrl: 'https://lxsgl.hdu.edu.cn/', languageRequirements: hduEnglishRequirements,
    sourceIds: ['source-hdu-2026-international-admission-guide', 'source-hdu-international-student-regulations'],
  })),
  {
    id: 'program-hangzhou-dianzi-university-mechanical-engineering-master', slug: 'hangzhou-dianzi-university-mechanical-engineering-master',
    universityId: 'uni-hangzhou-dianzi-university', aliases: ['Mechanical Engineering'],
    name: localized('Mechanical Engineering', '机械工程', 'Механическая инженерия', 'Maschinenbau', 'Génie mécanique', 'Ingeniería mecánica'),
    degreeLevel: 'master', discipline: 'engineering', teachingLanguages: ['English'], durationMonths: null,
    programUrl: sourceSpecs[6].url, applyUrl: 'https://lxsgl.hdu.edu.cn/', languageRequirements: hduEnglishRequirements,
    sourceIds: ['source-hdu-2026-international-admission-guide'],
  },
  {
    id: 'program-hangzhou-dianzi-university-international-chinese-language-education-master', slug: 'hangzhou-dianzi-university-international-chinese-language-education-master',
    universityId: 'uni-hangzhou-dianzi-university', aliases: ['International Chinese Language Education'],
    name: localized('International Chinese Language Education', '国际中文教育', 'Международное преподавание китайского языка', 'Internationale chinesische Sprachausbildung', 'Éducation internationale de la langue chinoise', 'Educación internacional de la lengua china'),
    degreeLevel: 'master', discipline: 'chinese-education', teachingLanguages: ['Chinese'], durationMonths: null,
    programUrl: sourceSpecs[6].url, applyUrl: 'https://lxsgl.hdu.edu.cn/', languageRequirements: [{ test: 'HSK', minimum: 'Level 5, 180' }],
    sourceIds: ['source-hdu-2026-international-admission-guide'],
  },
  {
    id: 'program-hangzhou-dianzi-university-chinese-language-program-language', slug: 'hangzhou-dianzi-university-chinese-language-program-language',
    universityId: 'uni-hangzhou-dianzi-university', aliases: ['Chinese Language Program'],
    name: localized('Chinese Language Program', '汉语言进修项目', 'Программа китайского языка', 'Chinesisch-Sprachprogramm', 'Programme de langue chinoise', 'Programa de lengua china'),
    degreeLevel: 'language', discipline: 'chinese-education', teachingLanguages: ['Chinese'], durationMonths: null,
    programUrl: sourceSpecs[6].url, applyUrl: 'https://lxsgl.hdu.edu.cn/', languageRequirements: [],
    sourceIds: ['source-hdu-2026-international-admission-guide'],
  },
  {
    id: 'program-guangzhou-university-public-administration-smart-governance-bachelor',
    slug: 'guangzhou-university-public-administration-smart-governance-bachelor',
    universityId: 'uni-guangzhou-university',
    name: localized('Public Administration (Smart Governance)', '行政管理（智慧治理方向）', 'Государственное управление (умное управление)', 'Öffentliche Verwaltung (Smart Governance)', 'Administration publique (gouvernance intelligente)', 'Administración pública (gobernanza inteligente)'),
    degreeLevel: 'bachelor', discipline: 'law-ir', teachingLanguages: ['Chinese'], durationMonths: 48, durationMonthsMax: 84,
    programUrl: sourceSpecs[8].url, applyUrl: null,
    languageRequirements: [{ test: 'HSK', minimum: 'Level 4 or higher; some Chinese-taught disciplines may require Level 5' }],
    sourceIds: ['source-gzhu-2026-public-administration-admission'],
  },
].map((program) => ({
  ...program,
  verificationScope: 'facts',
  verifiedAt: checkedAt,
  reviewAfter,
  status: 'verified',
}))

const resolvedProgramIds = new Map()
function upsertProgram(spec) {
  const aliasKeys = new Set([spec.name.en, ...(spec.aliases ?? [])].map(normalize))
  const existing = programs.find((item) => item.id === spec.id)
    ?? programs.find((item) => item.universityId === spec.universityId
      && item.degreeLevel === spec.degreeLevel
      && aliasKeys.has(normalize(item.name?.en)))
  if (existing) {
    const index = programs.indexOf(existing)
    programs[index] = { ...existing, ...spec, id: existing.id, slug: existing.slug }
    delete programs[index].aliases
    resolvedProgramIds.set(spec.id, existing.id)
    return
  }
  const addition = { ...spec }
  delete addition.aliases
  programs.push(addition)
  resolvedProgramIds.set(spec.id, spec.id)
}
for (const program of programSpecs) upsertProgram(program)

const pid = (id) => resolvedProgramIds.get(id) ?? id

// The old generic Business Administration draft carried an unsupported 2027 cycle.
// Once the preserved entity is refined to iMBA, retaining that cycle would fabricate a 2027 iMBA round.
admissionCycles = admissionCycles.filter(
  (cycle) => cycle.id !== 'cycle-2027-zhejiang-university-business-administration-master',
)

function cycle({ id, programId, sourceIds, closesOn, tuitionCny, tuitionPeriod, applicationFeeCny, notes }) {
  return {
    id,
    programId: pid(programId),
    academicYear: '2026-2027', intake: 'autumn', opensOn: null, closesOn,
    dateStatus: 'published', tuitionCny, tuitionPeriod,
    tuitionStatus: tuitionCny === null ? null : 'confirmed',
    evidenceBasis: 'cycle-specific', factScope: 'partial', applicationFeeCny,
    ...(notes ? { notes } : {}),
    sourceIds, verifiedAt: checkedAt, reviewAfter, status: 'verified',
  }
}

const zjuCycles = [
  ['clinical-medicine-mbbs-bachelor', 'program-zhejiang-university-clinical-medicine-mbbs-bachelor', 42800, 'academic-year'],
  ['biomedical-engineering-bachelor', 'program-zhejiang-university-biomedical-engineering-bachelor', 42800, 'academic-year'],
  ['china-studies-mcs-master', 'program-zhejiang-university-china-studies-mcs-master', 66000, 'academic-year'],
  ['business-administration-imba-master', 'program-zhejiang-university-business-administration-master', 218000, 'program'],
  ['finance-imf-master', 'program-zhejiang-university-finance-imf-master', 180000, 'program'],
  ['data-science-imds-master', 'program-zhejiang-university-data-science-imds-master', 50000, 'academic-year'],
].map(([key, programId, tuitionCny, tuitionPeriod]) => cycle({
  id: `cycle-2026-zhejiang-university-${key}`,
  programId,
  sourceIds: programId.includes('bachelor')
    ? ['source-zju-2026-english-undergraduate-catalog', 'source-zju-2026-undergraduate-guide']
    : ['source-zju-2026-english-master-catalog', 'source-zju-2026-master-guide'],
  closesOn: '2026-05-31', tuitionCny, tuitionPeriod, applicationFeeCny: 800,
}))

const registrationNotApplicationFee = localized(
  'The official CNY 500 charge is a registration fee, not an application fee; applicationFeeCny therefore remains unknown.',
  '官网500元费用为注册费，并非申请费，因此 applicationFeeCny 保持未知。',
  'Официальные 500 юаней — регистрационный, а не заявочный сбор; applicationFeeCny остаётся неизвестным.',
  'Die offiziellen 500 CNY sind eine Registrierungs-, keine Bewerbungsgebühr; applicationFeeCny bleibt unbekannt.',
  "Les 500 CNY officiels sont des frais d'inscription, non des frais de candidature ; applicationFeeCny reste inconnu.",
  'Los 500 CNY oficiales son una tasa de registro, no de solicitud; applicationFeeCny permanece desconocido.',
)
const hduRegistrationNote = localized(
  'The guide also says applications may close when seats are full. Its CNY 600 registration charge is not an application fee, so applicationFeeCny remains unknown.',
  '简章同时说明名额满时可提前截止；600元为注册费而非申请费，因此 applicationFeeCny 保持未知。',
  'Приём также может закрыться после заполнения мест. 600 юаней — регистрационный, не заявочный сбор; applicationFeeCny неизвестен.',
  'Die Bewerbung kann auch bei vollen Plätzen schließen. 600 CNY sind eine Registrierungs-, keine Bewerbungsgebühr; applicationFeeCny bleibt unbekannt.',
  "La candidature peut aussi fermer lorsque les places sont complètes. Les 600 CNY sont des frais d'inscription, non de candidature ; applicationFeeCny reste inconnu.",
  'La solicitud también puede cerrarse al agotarse las plazas. Los 600 CNY son una tasa de registro, no de solicitud; applicationFeeCny queda desconocido.',
)

const cycleSpecs = [
  ...zjuCycles,
  cycle({ id: 'cycle-gap-wave8-2-hutb-international-business-master-2026-2027-autumn-fee-reference', programId: 'prog-gap-wave8-2-hutb-international-business-master', sourceIds: ['src-gap-program-wave8-2-hutb-international-business-master'], closesOn: '2026-06-30', tuitionCny: 24000, tuitionPeriod: 'academic-year', applicationFeeCny: null, notes: registrationNotApplicationFee }),
  cycle({ id: 'cycle-gap-wave8-2-hutb-chinese-language-2026-2027-autumn-fee-reference', programId: 'prog-gap-wave8-2-hutb-chinese-language', sourceIds: ['src-gap-program-wave8-2-hutb-chinese-language'], closesOn: '2026-06-30', tuitionCny: 11000, tuitionPeriod: 'academic-year', applicationFeeCny: null, notes: registrationNotApplicationFee }),
  ...[
    ['cycle-gap-prog-hdu-artificial-intelligence-bachelor-2026-2026-2027-other-fee-reference', 'prog-gap-prog-hdu-artificial-intelligence-bachelor-2026', 20000],
    ['cycle-gap-prog-hdu-business-management-bachelor-2026-2026-2027-other-fee-reference', 'prog-gap-prog-hdu-business-management-bachelor-2026', 18000],
    ['cycle-gap-prog-hdu-computer-science-bachelor-2026-2026-2027-other-fee-reference', 'prog-gap-prog-hdu-computer-science-bachelor-2026', 20000],
    ['cycle-gap-prog-hdu-digital-economy-bachelor-2026-2026-2027-other-fee-reference', 'prog-gap-prog-hdu-digital-economy-bachelor-2026', 18000],
    ['cycle-gap-prog-hdu-mechanical-bachelor-2026-2026-2027-other-fee-reference', 'prog-gap-prog-hdu-mechanical-bachelor-2026', 20000],
    ['cycle-2026-hangzhou-dianzi-university-software-engineering-bachelor', 'program-hangzhou-dianzi-university-software-engineering-bachelor', 20000],
    ['cycle-2026-hangzhou-dianzi-university-mechanical-engineering-master', 'program-hangzhou-dianzi-university-mechanical-engineering-master', 28000],
    ['cycle-2026-hangzhou-dianzi-university-international-chinese-language-education-master', 'program-hangzhou-dianzi-university-international-chinese-language-education-master', 25000],
    ['cycle-2026-hangzhou-dianzi-university-chinese-language-program-language', 'program-hangzhou-dianzi-university-chinese-language-program-language', 14000],
  ].map(([id, programId, tuitionCny]) => cycle({
    id, programId, sourceIds: ['source-hdu-2026-international-admission-guide'],
    closesOn: '2026-06-15', tuitionCny, tuitionPeriod: 'academic-year', applicationFeeCny: null,
    notes: hduRegistrationNote,
  })),
  cycle({
    id: 'cycle-2026-guangzhou-university-public-administration-smart-governance-bachelor',
    programId: 'program-guangzhou-university-public-administration-smart-governance-bachelor',
    sourceIds: ['source-gzhu-2026-public-administration-admission'], closesOn: '2026-04-30',
    tuitionCny: null, tuitionPeriod: null, applicationFeeCny: 0,
    notes: localized(
      'The official self-funded undergraduate tuition is a CNY 18,000–20,000 annual range; no single value is inferred.',
      '官网公布自费本科年学费区间为18000–20000元；不推断单一金额。',
      'Официальная годовая стоимость бакалавриата составляет 18 000–20 000 юаней; единая сумма не выводится.',
      'Die offizielle jährliche Studiengebühr liegt bei 18.000–20.000 CNY; kein Einzelwert wird abgeleitet.',
      'Les frais annuels officiels sont de 18 000 à 20 000 CNY ; aucune valeur unique n’est déduite.',
      'La matrícula anual oficial es de 18.000–20.000 CNY; no se deduce un valor único.',
    ),
  }),
]

function upsertCycle(addition) {
  const existing = admissionCycles.find((item) => item.id === addition.id)
    ?? admissionCycles.find((item) => item.programId === addition.programId
      && item.academicYear === addition.academicYear
      && item.intake === addition.intake)
  if (existing) admissionCycles[admissionCycles.indexOf(existing)] = { ...existing, ...addition, id: existing.id }
  else admissionCycles.push(addition)
}
for (const item of cycleSpecs) upsertCycle(item)

const scholarshipSpecs = [
  {
    id: 'scholarship-zju-zibs-hai-2026', slug: 'zju-zibs-hai-scholarship-2026',
    name: localized('ZIBS Hai Scholarship 2026', '浙江大学国际联合商学院海纳奖学金（2026）', 'Стипендия ZIBS Hai 2026', 'ZIBS-Hai-Stipendium 2026', 'Bourse ZIBS Hai 2026', 'Beca ZIBS Hai 2026'),
    providerType: 'university', universityIds: ['uni-zhejiang-university'],
    programIds: [
      pid('program-zhejiang-university-china-studies-mcs-master'),
      pid('program-zhejiang-university-business-administration-master'),
      pid('program-zhejiang-university-finance-imf-master'),
      pid('program-zhejiang-university-data-science-imds-master'),
    ],
    coverage: { tuition: 'unknown', accommodation: 'unknown', insurance: 'unknown', stipendCnyPerMonth: null },
    deadline: '2026-05-31', applicationUrl: 'https://intlstudent.zju.edu.cn/',
    summary: localized('The 2026 ZJU master guide and English catalog confirm this scholarship route for MCS, iMBA, iMF and iMDS. The reviewed sources do not publish a safe award amount.', '浙大2026硕士简章与英文目录确认MCS、iMBA、iMF和iMDS可申请海纳奖学金；已核验来源未公布可安全结构化的资助金额。', 'Руководство и каталог ZJU 2026 подтверждают стипендию для MCS, iMBA, iMF и iMDS; безопасная сумма не опубликована.', 'Der ZJU-Leitfaden 2026 bestätigt das Stipendium für MCS, iMBA, iMF und iMDS; eine belastbare Höhe ist nicht veröffentlicht.', 'Le guide ZJU 2026 confirme cette bourse pour MCS, iMBA, iMF et iMDS ; aucun montant sûr n’est publié.', 'La guía ZJU 2026 confirma esta beca para MCS, iMBA, iMF e iMDS; no publica una cuantía segura.'),
    sourceIds: ['source-zju-2026-master-guide', 'source-zju-2026-english-master-catalog'],
  },
  {
    id: 'sch-gap-mew-csw-hutb-hunan-provincial-scholarship', slug: 'gap-mew-csw-hutb-hunan-provincial-scholarship',
    name: localized('Hunan Provincial Scholarship for International Students at HUTB', '湖南工商大学湖南省来华留学生奖学金', 'Стипендия провинции Хунань для иностранных студентов HUTB', 'Hunan-Provinzstipendium für internationale Studierende an der HUTB', 'Bourse provinciale du Hunan pour étudiants internationaux à HUTB', 'Beca provincial de Hunan para estudiantes internacionales en HUTB'),
    providerType: 'province', universityIds: ['uni-hunan-university-of-technology-and-business'], programIds: [],
    coverage: { tuition: 'unknown', accommodation: 'unknown', insurance: 'unknown', stipendCnyPerMonth: null }, deadline: null,
    applicationUrl: 'https://iec.hutb.edu.cn/xwzx/tzgg/content_90133',
    summary: localized('The official 2026 HUTB guide confirms the provincial route but does not itemize its current coverage or separate deadline.', '湖南工商大学2026官方简章确认该省级奖学金路线，但未分项公布当期资助或单独截止日。', 'Руководство HUTB 2026 подтверждает провинциальную стипендию, но не публикует покрытие или отдельный срок.', 'Der HUTB-Leitfaden 2026 bestätigt die Provinzförderung, nennt aber weder Deckung noch eigene Frist.', 'Le guide HUTB 2026 confirme la bourse provinciale sans détailler la couverture ni une échéance distincte.', 'La guía HUTB 2026 confirma la beca provincial sin detallar cobertura ni fecha separada.'),
    sourceIds: ['src-gap-scholarship-mew-csw-hutb-hunan-provincial-scholarship'],
  },
  {
    id: 'sch-gap-wave8-2-hutb-belt-road-language-scholarship', slug: 'gap-wave8-2-hutb-belt-road-language-scholarship',
    name: localized('Hunan Belt and Road Language Student Scholarship at HUTB', '湖南省“一带一路”沿线国家语言生奖学金（湖南工商大学）', 'Хунаньская стипендия «Пояс и путь» для языковых студентов HUTB', 'Hunan-Seidenstraßen-Stipendium für Sprachstudierende an der HUTB', 'Bourse du Hunan « la Ceinture et la Route » pour étudiants en langue à HUTB', 'Beca de Hunan de la Franja y la Ruta para estudiantes de idioma en HUTB'),
    providerType: 'province', universityIds: ['uni-hunan-university-of-technology-and-business'], programIds: [pid('prog-gap-wave8-2-hutb-chinese-language')],
    coverage: { tuition: 'unknown', accommodation: 'unknown', insurance: 'unknown', stipendCnyPerMonth: null }, deadline: null,
    applicationUrl: 'https://iec.hutb.edu.cn/xwzx/tzgg/content_90133',
    summary: localized('The official guide confirms one academic year of scholarship eligibility for language students from Belt and Road countries; it does not itemize coverage.', '官方简章确认“一带一路”沿线国家语言生可获一学年奖学金，但未分项公布资助内容。', 'Руководство подтверждает годовую стипендию для языковых студентов стран «Пояса и пути», без детализации покрытия.', 'Der Leitfaden bestätigt ein Studienjahr Förderung für Sprachstudierende aus Seidenstraßenländern, ohne Deckungsdetails.', 'Le guide confirme une année de bourse pour les étudiants en langue des pays de la Ceinture et la Route, sans détail de couverture.', 'La guía confirma un año de beca para estudiantes de idioma de países de la Franja y la Ruta, sin detallar la cobertura.'),
    sourceIds: ['src-gap-scholarship-wave8-2-hutb-belt-road-language-scholarship'],
  },
  {
    id: 'scholarship-hutb-international-students-inclusive', slug: 'hutb-international-students-inclusive-scholarship',
    name: localized('HUTB International Students Inclusive Scholarship', '湖南工商大学来华留学生奖学金', 'Инклюзивная стипендия HUTB для иностранных студентов', 'HUTB-Stipendium für internationale Studierende', 'Bourse inclusive HUTB pour étudiants internationaux', 'Beca inclusiva HUTB para estudiantes internacionales'),
    providerType: 'university', universityIds: ['uni-hunan-university-of-technology-and-business'],
    programIds: [pid('prog-gap-wave8-2-hutb-chinese-language'), pid('prog-gap-wave8-2-hutb-international-business-master')],
    coverage: { tuition: 'partial', accommodation: 'unknown', insurance: 'unknown', stipendCnyPerMonth: null }, deadline: null,
    applicationUrl: 'https://iec.hutb.edu.cn/xwzx/tzgg/content_90133',
    summary: localized('Awards based on enrolled-student performance are capped at CNY 5,500 for language students and CNY 16,800 for postgraduates; no separate deadline is published.', '奖学金按在校表现评定，语言生最高5500元、硕士研究生最高16800元；官网未公布单独截止日。', 'По результатам учёбы максимум составляет 5 500 юаней для языковых студентов и 16 800 для магистрантов; отдельного срока нет.', 'Leistungsabhängig bis 5.500 CNY für Sprachstudierende und 16.800 CNY für Postgraduierte; keine eigene Frist veröffentlicht.', 'Selon les résultats : jusqu’à 5 500 CNY pour les étudiants en langue et 16 800 CNY pour les étudiants de master ; aucune échéance séparée.', 'Según el rendimiento: hasta 5.500 CNY para estudiantes de idioma y 16.800 CNY para posgrado; sin fecha separada.'),
    sourceIds: ['source-hutb-2026-inclusive-scholarship'],
  },
  {
    id: 'sch-gap-wave8-hdu-sonis-scholarship-2026', slug: 'gap-wave8-hdu-sonis-scholarship-2026',
    name: localized('HDU Scholarship for Outstanding New International Students (SONIS) 2026', '杭州电子科技大学2026年优秀新国际学生奖学金（SONIS）', 'Стипендия HDU для выдающихся новых иностранных студентов (SONIS) 2026', 'HDU-Stipendium für herausragende neue internationale Studierende (SONIS) 2026', 'Bourse HDU pour nouveaux étudiants internationaux remarquables (SONIS) 2026', 'Beca HDU para nuevos estudiantes internacionales destacados (SONIS) 2026'),
    providerType: 'university', universityIds: ['uni-hangzhou-dianzi-university'],
    programIds: programSpecs.filter((item) => item.universityId === 'uni-hangzhou-dianzi-university' && item.degreeLevel !== 'language').map((item) => pid(item.id)),
    coverage: { tuition: 'full', accommodation: 'partial', insurance: 'unknown', stipendCnyPerMonth: null }, deadline: null,
    applicationUrl: sourceSpecs[6].url,
    summary: localized('SONIS is limited to new international degree students for the first academic year. First Class covers first-year tuition and accommodation; Second Class covers first-year tuition. No separate scholarship deadline is announced.', 'SONIS仅面向国际学历新生第一学年：一等奖覆盖第一学年学费和住宿，二等奖覆盖第一学年学费；未公布单独奖学金截止日。', 'SONIS предназначена только новым иностранным студентам программ степени на первый год: первая категория покрывает обучение и проживание, вторая — обучение; отдельного срока нет.', 'SONIS gilt nur für neue internationale Studierende in Studiengängen im ersten Jahr: Klasse 1 deckt Studiengebühren und Unterkunft, Klasse 2 die Studiengebühren; keine separate Frist.', 'SONIS est réservée aux nouveaux étudiants internationaux diplômants pour la première année : première classe, frais et logement ; deuxième classe, frais ; aucune échéance distincte.', 'SONIS se limita a nuevos estudiantes internacionales de titulación durante el primer año: primera clase cubre matrícula y alojamiento; segunda, matrícula; sin fecha separada.'),
    sourceIds: ['source-hdu-2026-international-admission-guide'],
  },
  {
    id: 'sch-gap-wave6-gzhu-international-student-scholarship-2026', slug: 'gap-wave6-gzhu-international-student-scholarship-2026',
    name: localized('Guangzhou University International Student Scholarship 2026', '广州大学2026年国际学生奖学金', 'Стипендия Университета Гуанчжоу для иностранных студентов 2026', 'Stipendium der Guangzhou University für internationale Studierende 2026', 'Bourse 2026 de Guangzhou University pour étudiants internationaux', 'Beca 2026 de Guangzhou University para estudiantes internacionales'),
    providerType: 'university', universityIds: ['uni-guangzhou-university'],
    programIds: [pid('program-guangzhou-university-public-administration-smart-governance-bachelor')],
    coverage: { tuition: 'partial', accommodation: 'unknown', insurance: 'unknown', stipendCnyPerMonth: 1000 },
    deadline: '2026-04-30', applicationUrl: sourceSpecs[8].url,
    summary: localized('For undergraduates, the 2026 route publishes CNY 1,000 monthly living support, annual tuition subsidies of CNY 18,000 for liberal arts or CNY 19,000 for sciences, and a combined CNY 1,600 annual visa-and-insurance subsidy. Award status is assessed through exams and interviews.', '2026本科资助标准为每月1000元生活补贴、文科每学年18000元或理科19000元学费补贴，以及每年1600元签证与保险合并补贴；奖学金通过笔试和面试评定。', 'Для бакалавров: 1 000 юаней в месяц, субсидия на обучение 18 000 для гуманитарных или 19 000 для естественных направлений и 1 600 в год на визу и страховку; решение принимается по экзаменам и интервью.', 'Für Bachelorstudierende: 1.000 CNY monatlich, 18.000 CNY Studienzuschuss für Geistes- bzw. 19.000 CNY für Naturwissenschaften sowie 1.600 CNY jährlich für Visum und Versicherung; Auswahl per Prüfung und Interview.', 'Pour les étudiants de licence : 1 000 CNY par mois, 18 000 CNY de subvention en lettres ou 19 000 CNY en sciences, plus 1 600 CNY par an pour visa et assurance ; attribution après examens et entretien.', 'Para grado: 1.000 CNY mensuales, subsidio anual de 18.000 CNY en humanidades o 19.000 CNY en ciencias y 1.600 CNY al año para visado y seguro; selección mediante pruebas y entrevista.'),
    sourceIds: ['source-gzhu-2026-public-administration-admission'],
  },
].map((scholarship) => ({ ...scholarship, verifiedAt: checkedAt, reviewAfter, status: 'verified' }))

for (const item of scholarshipSpecs) upsertById(scholarships, item)

write('sources.json', sources)
write('programs.json', programs)
write('admission-cycles.json', admissionCycles)
write('scholarships.json', scholarships)

console.log(JSON.stringify({
  checkedAt,
  sourcesUpserted: sourceSpecs.length,
  programsUpserted: programSpecs.length,
  cyclesUpserted: cycleSpecs.length,
  scholarshipsUpserted: scholarshipSpecs.length,
  removedUnsupportedCycle: 'cycle-2027-zhejiang-university-business-administration-master',
}, null, 2))
