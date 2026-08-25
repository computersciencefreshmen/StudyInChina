const fs = require('node:fs')
const path = require('node:path')

const dataDir = process.env.STUDYINCHINA_DATA_DIR
  ? path.resolve(process.env.STUDYINCHINA_DATA_DIR)
  : path.join(process.cwd(), 'content', 'data')
const checkedAt = '2026-08-25'
const staticReviewAfter = '2026-09-24'
const upcomingReviewAfter = '2026-09-01'

const read = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'))
const write = (name, value) => fs.writeFileSync(
  path.join(dataDir, name),
  `${JSON.stringify(value, null, 2)}\n`,
  'utf8',
)
const upsert = (items, addition) => {
  const index = items.findIndex((item) => item.id === addition.id)
  if (index === -1) items.push(addition)
  else items[index] = addition
}
const unique = (values) => [...new Set(values)]
const localized = (en, zh, ru, de, fr, es) => ({ en, zh, ru, de, fr, es })

const sourceSpecs = [
  {
    id: 'source-sisu-international-masters-catalog-2026',
    url: 'https://www.oisa.shisu.edu.cn/index.php/index/lxxm/cid/90.html',
    title: "SISU International Master's Programs and 2026 Admission Facts",
    publisher: 'Shanghai International Studies University',
    kind: 'program',
    language: 'zh',
  },
  {
    id: 'source-sisu-international-bachelors-catalog-2026',
    url: 'https://www.oisa.shisu.edu.cn/index.php/Index/lxxm/cid/87',
    title: "SISU International Bachelor's Programs and 2026 Admission Facts",
    publisher: 'Shanghai International Studies University',
    kind: 'program',
    language: 'zh',
  },
  {
    id: 'src-sisu-iclt-2026',
    url: 'https://www.oisa.shisu.edu.cn/index.php/index/newscontent/cid/39/id/666.html',
    title: 'SISU 2026 International Chinese Language Teachers Scholarship Guide',
    publisher: 'Shanghai International Studies University',
    kind: 'program',
    language: 'zh',
  },
  {
    id: 'source-sisu-shanghai-government-scholarship-2026',
    url: 'https://www.oisa.shisu.edu.cn/index.php/index/newscontent/cid/39/id/660.html',
    title: 'SISU 2026 Shanghai Government Scholarship Guide',
    publisher: 'Shanghai International Studies University',
    kind: 'scholarship',
    language: 'zh',
  },
  {
    id: 'source-sisu-official-application-portal',
    url: 'https://apply.shisu.edu.cn/c.asp?action=student_sign',
    title: 'SISU International Student Application Portal',
    publisher: 'Shanghai International Studies University',
    kind: 'admissions',
    language: 'en',
  },
  {
    id: 'source-ahu-international-undergraduate-catalog',
    url: 'https://en.ahu.edu.cn/_upload/article/files/4a/16/4b61336d455ebb09fc8c0d6fe48f/6ebe828e-06b9-4dc6-9181-cf0ab343cb7a.pdf',
    title: 'Anhui University Undergraduate Programs for International Students',
    publisher: 'Anhui University',
    kind: 'program',
    language: 'en',
  },
  {
    id: 'source-ahu-undated-international-admission-reference',
    url: 'https://sie.ahu.edu.cn/_upload/article/files/b4/e0/c137afce42859129fc0e68b094df/2fa37fb8-dd10-451b-a7c9-d1759a9bc289.pdf',
    title: 'Anhui University International Student Admission Reference (undated)',
    publisher: 'Anhui University',
    kind: 'admissions',
    language: 'en',
  },
  {
    id: 'source-ahu-csc-high-level-postgraduate-2026-2027',
    url: 'https://sie.ahu.edu.cn/_upload/article/files/cf/ee/3543c52a4212b79315534aeeb995/98db637b-5d63-40a2-9d4b-1db3300f3701.pdf',
    title: 'Anhui University 2026–2027 Chinese Government Scholarship High-Level Postgraduate Program',
    publisher: 'Anhui University',
    kind: 'scholarship',
    language: 'en',
  },
  {
    id: 'source-cqu-international-undergraduate-guide-2026',
    url: 'https://study.cqu.edu.cn/lxsq/zsxx/xlxm/zqbkszsjz.htm',
    title: 'Chongqing University 2026 International Undergraduate Admission Guide',
    publisher: 'Chongqing University',
    kind: 'program',
    language: 'zh',
  },
  {
    id: 'source-cqu-official-tuition-fees',
    url: 'https://study.cqu.edu.cn/HOME/ADMISSION/Overview/Tuition_and_Accommodation_Fees.htm',
    title: 'Chongqing University Tuition and Accommodation Fees',
    publisher: 'Chongqing University',
    kind: 'admissions',
    language: 'en',
  },
  {
    id: 'source-cqu-official-application-portal',
    url: 'https://cqu.17gz.org/member/login.do',
    title: 'Chongqing University International Student Application Portal',
    publisher: 'Chongqing University',
    kind: 'admissions',
    language: 'en',
  },
  {
    id: 'source-cqu-president-scholarship-2026',
    url: 'https://study.cqu.edu.cn/info/1390/2859.htm',
    title: 'Chongqing University President Scholarship 2026',
    publisher: 'Chongqing University',
    kind: 'scholarship',
    language: 'en',
  },
  {
    id: 'source-cqu-president-scholarship-insurance-conflict',
    url: 'https://study.cqu.edu.cn/info/1744/1324.htm',
    title: 'Chongqing University President Scholarship Coverage Notice',
    publisher: 'Chongqing University',
    kind: 'scholarship',
    language: 'en',
  },
  {
    id: 'source-cqu-mayor-scholarship-2026',
    url: 'https://study.cqu.edu.cn/info/1389/2913.htm',
    title: 'Chongqing Mayor Scholarship at Chongqing University 2026',
    publisher: 'Chongqing University',
    kind: 'scholarship',
    language: 'en',
  },
  {
    id: 'source-cqu-iclt-scholarship-2026',
    url: 'https://study.cqu.edu.cn/info/1388/2836.htm',
    title: 'Chongqing University 2026 International Chinese Language Teachers Scholarship Guide',
    publisher: 'Chongqing University',
    kind: 'scholarship',
    language: 'en',
  },
].map((source) => ({ ...source, official: true, accessedAt: checkedAt }))

const sources = read('sources.json')
const programs = read('programs.json')
const admissionCycles = read('admission-cycles.json')
const scholarships = read('scholarships.json')

for (const source of sourceSpecs) upsert(sources, source)

function refreshProgram(id, expectedUniversityId, changes) {
  const current = programs.find((item) => item.id === id)
  if (!current) throw new Error(`Missing program: ${id}`)
  if (current.universityId !== expectedUniversityId) {
    throw new Error(`Unexpected university on ${id}: ${current.universityId}`)
  }
  upsert(programs, {
    ...current,
    ...changes,
    id: current.id,
    slug: current.slug,
    universityId: current.universityId,
    sourceIds: unique(changes.sourceIds),
    verifiedAt: checkedAt,
    reviewAfter: changes.reviewAfter ?? staticReviewAfter,
    status: 'verified',
  })
}

const SISU = 'uni-shanghai-international-studies-university'
const AHU = 'uni-anhui-university'
const CQU = 'uni-chongqing-university'
const sisuPortal = 'https://apply.shisu.edu.cn/c.asp?action=student_sign'
const cquPortal = 'https://cqu.17gz.org/member/login.do'

refreshProgram('program-shanghai-international-studies-university-international-relations-master', SISU, {
  name: localized('International Relations', '国际关系', 'Международные отношения', 'Internationale Beziehungen', 'Relations internationales', 'Relaciones Internacionales'),
  teachingLanguages: ['English'],
  durationMonths: 24,
  programUrl: sourceSpecs[0].url,
  applyUrl: sisuPortal,
  languageRequirements: [{ test: 'IELTS', minimum: '6.0 or an officially accepted equivalent' }],
  verificationScope: 'facts',
  sourceIds: [sourceSpecs[0].id, 'source-sisu-official-application-portal'],
})

refreshProgram('program-shanghai-international-studies-university-translation-bachelor', SISU, {
  name: localized('Translation', '翻译', 'Перевод', 'Übersetzen', 'Traduction', 'Traducción'),
  teachingLanguages: ['Chinese'],
  durationMonths: 48,
  programUrl: sourceSpecs[1].url,
  applyUrl: sisuPortal,
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 5' },
    { test: 'other', minimum: 'Chinese oral and English written/oral assessment; CSCA Chinese and Mathematics' },
  ],
  verificationScope: 'facts',
  sourceIds: [sourceSpecs[1].id, 'source-sisu-official-application-portal'],
})

refreshProgram('prog-gap-shisu-2026-bachelor-tcsol', SISU, {
  name: localized(
    'Teaching Chinese to Speakers of Other Languages',
    '汉语国际教育',
    'Преподавание китайского языка как иностранного',
    'Chinesisch als Fremdsprache',
    'Enseignement du chinois langue étrangère',
    'Enseñanza de chino como lengua extranjera',
  ),
  teachingLanguages: ['Chinese'],
  durationMonths: 48,
  programUrl: sourceSpecs[1].url,
  applyUrl: null,
  languageRequirements: [],
  verificationScope: 'facts',
  sourceIds: [sourceSpecs[1].id],
})

refreshProgram('prog-gap-shisu-2026-master-icle', SISU, {
  name: localized(
    'International Chinese Language Education',
    '国际中文教育',
    'Международное преподавание китайского языка',
    'Internationale Chinesischdidaktik',
    'Enseignement international du chinois',
    'Enseñanza internacional del chino',
  ),
  teachingLanguages: ['Chinese'],
  durationMonths: 24,
  programUrl: sourceSpecs[0].url,
  applyUrl: sisuPortal,
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 5, 180; alternatively at least two years of Chinese-language study' },
    { test: 'other', minimum: 'Professional-level English proficiency' },
  ],
  verificationScope: 'facts',
  sourceIds: [sourceSpecs[0].id, 'source-sisu-official-application-portal'],
})

refreshProgram('program-sisu-iclt-one-semester-spring-2027', SISU, {
  name: localized(
    'International Chinese Language Teachers Scholarship — One-Semester Study (Spring 2027)',
    '国际中文教师奖学金一学期研修项目（2027年春季）',
    'Семестровая программа стипендии для преподавателей китайского языка (весна 2027)',
    'Internationales Chinesischlehrkräfte-Stipendium — ein Semester (Frühjahr 2027)',
    "Bourse pour enseignants internationaux de chinois — un semestre (printemps 2027)",
    'Beca para profesores internacionales de chino — un semestre (primavera de 2027)',
  ),
  teachingLanguages: ['Chinese'],
  durationMonths: 5,
  programUrl: sourceSpecs[2].url,
  applyUrl: 'https://pmplatform.chinese.cn/ui/start/#/login',
  languageRequirements: [
    { test: 'HSK', minimum: 'Level 3, 180 for Chinese education/literature/history/philosophy; an HSK score for TCM/Taiji' },
    { test: 'other', minimum: 'HSKK required for Chinese education/literature/history/philosophy and preferred for TCM/Taiji' },
  ],
  verificationScope: 'facts',
  sourceIds: [sourceSpecs[2].id, 'src-clec-iclt-2026-standard'],
  reviewAfter: upcomingReviewAfter,
})

for (const item of [
  {
    id: 'program-anhui-university-international-economics-and-trade-bachelor',
    name: localized('International Economics and Trade', '国际经济与贸易', 'Международная экономика и торговля', 'Internationale Wirtschaft und Handel', 'Économie et commerce internationaux', 'Economía y Comercio Internacional'),
  },
  {
    id: 'program-anhui-university-computer-science-and-technology-bachelor',
    name: localized('Computer Science and Technology', '计算机科学与技术', 'Компьютерные науки и технологии', 'Informatik und Technologie', 'Informatique et technologie', 'Ciencias y Tecnología de la Computación'),
  },
]) {
  refreshProgram(item.id, AHU, {
    name: item.name,
    teachingLanguages: ['Chinese'],
    durationMonths: 48,
    programUrl: sourceSpecs[5].url,
    applyUrl: null,
    languageRequirements: [],
    verificationScope: 'facts',
    sourceIds: [sourceSpecs[5].id, sourceSpecs[6].id],
  })
}

for (const item of [
  {
    id: 'program-chongqing-university-civil-engineering-bachelor',
    name: localized('Civil Engineering', '土木工程', 'Гражданское строительство', 'Bauingenieurwesen', 'Génie civil', 'Ingeniería Civil'),
  },
  {
    id: 'program-chongqing-university-electrical-engineering-and-automation-bachelor',
    name: localized('Electrical Engineering and Automation', '电气工程及其自动化', 'Электротехника и автоматизация', 'Elektrotechnik und Automatisierung', 'Génie électrique et automatisation', 'Ingeniería Eléctrica y Automatización'),
  },
  {
    id: 'program-chongqing-university-materials-engineering-bachelor',
    name: localized('Materials Engineering', '材料工程', 'Материаловедение и инженерия', 'Werkstofftechnik', 'Génie des matériaux', 'Ingeniería de Materiales'),
  },
]) {
  refreshProgram(item.id, CQU, {
    name: item.name,
    teachingLanguages: ['English'],
    durationMonths: 48,
    programUrl: sourceSpecs[8].url,
    applyUrl: cquPortal,
    languageRequirements: [
      { test: 'IELTS', minimum: '6.0' },
      { test: 'TOEFL', minimum: '80 (iBT)' },
      { test: 'other', minimum: 'English-medium education proof or at least one year of study in an English-speaking country' },
    ],
    verificationScope: 'facts',
    sourceIds: [sourceSpecs[8].id, sourceSpecs[9].id, sourceSpecs[10].id],
  })
}

function previousCycle({ id, programId, sourceIds, closesOn, tuitionCny, applicationFeeCny, notes }) {
  return {
    id,
    programId,
    academicYear: '2026-2027',
    intake: 'autumn',
    opensOn: null,
    closesOn,
    dateStatus: 'previous-cycle-reference',
    tuitionCny,
    tuitionPeriod: 'academic-year',
    tuitionStatus: 'confirmed',
    evidenceBasis: 'cycle-specific',
    factScope: 'complete',
    applicationFeeCny,
    notes,
    sourceIds: unique(sourceIds),
    verifiedAt: checkedAt,
    reviewAfter: checkedAt,
    status: 'stale',
  }
}

const cycleSpecs = [
  previousCycle({
    id: 'cycle-sisu-international-relations-autumn-2026-historical',
    programId: 'program-shanghai-international-studies-university-international-relations-master',
    sourceIds: [sourceSpecs[0].id],
    closesOn: '2026-04-30',
    tuitionCny: 26000,
    applicationFeeCny: 800,
    notes: localized(
      "Closed 2026 autumn round. The master's catalogue confirms a bachelor's degree, IELTS 6.0/equivalent, CNY 26,000 annual tuition and CNY 800 application fee; this is not a 2027 announcement.",
      '2026年秋季轮次已关闭。硕士目录确认本科学历、雅思6.0或同等要求、学费26,000元/年和报名费800元；该记录不代表2027年招生公告。',
      'Набор на осень 2026 года закрыт. Каталог подтверждает степень бакалавра, IELTS 6.0/эквивалент, 26 000 юаней в год и сбор 800 юаней; это не объявление на 2027 год.',
      'Die Herbstrunde 2026 ist geschlossen. Bestätigt sind Bachelorabschluss, IELTS 6,0/Äquivalent, 26.000 CNY pro Jahr und 800 CNY Gebühr; dies ist keine Ankündigung für 2027.',
      "La session d'automne 2026 est close. Le catalogue confirme licence, IELTS 6,0/équivalent, 26 000 CNY par an et 800 CNY de frais ; ce n'est pas une annonce 2027.",
      'La convocatoria de otoño de 2026 está cerrada. Se confirman licenciatura, IELTS 6,0/equivalente, 26.000 CNY al año y 800 CNY de tasa; no es un anuncio para 2027.',
    ),
  }),
  previousCycle({
    id: 'cycle-sisu-translation-autumn-2026-historical',
    programId: 'program-shanghai-international-studies-university-translation-bachelor',
    sourceIds: [sourceSpecs[1].id],
    closesOn: '2026-04-15',
    tuitionCny: 24800,
    applicationFeeCny: 750,
    notes: localized(
      'Closed 2026 autumn round. The bachelor catalogue confirms HSK 5, language assessments, CSCA Chinese/Mathematics, CNY 24,800 annual tuition and a CNY 750 fee.',
      '2026年秋季轮次已关闭。本科目录确认HSK五级、语言测试、CSCA中文与数学、学费24,800元/年及报名费750元。',
      'Набор на осень 2026 года закрыт. Подтверждены HSK 5, языковые испытания, CSCA по китайскому и математике, 24 800 юаней в год и сбор 750 юаней.',
      'Die Herbstrunde 2026 ist geschlossen. Bestätigt sind HSK 5, Sprachprüfungen, CSCA Chinesisch/Mathematik, 24.800 CNY pro Jahr und 750 CNY Gebühr.',
      "La session d'automne 2026 est close. Sont confirmés HSK 5, évaluations linguistiques, CSCA chinois/mathématiques, 24 800 CNY par an et 750 CNY de frais.",
      'La convocatoria de otoño de 2026 está cerrada. Se confirman HSK 5, pruebas lingüísticas, CSCA chino/matemáticas, 24.800 CNY al año y 750 CNY de tasa.',
    ),
  }),
  previousCycle({
    id: 'cycle-sisu-international-chinese-education-master-autumn-2026-historical',
    programId: 'prog-gap-shisu-2026-master-icle',
    sourceIds: [sourceSpecs[0].id],
    closesOn: '2026-04-30',
    tuitionCny: 26000,
    applicationFeeCny: 800,
    notes: localized(
      'Closed 2026 autumn round. The master catalogue confirms HSK 5 (180) or two years of Chinese study, professional English, CNY 26,000 annual tuition and a CNY 800 fee.',
      '2026年秋季轮次已关闭。硕士目录确认HSK五级180分或两年汉语学习经历、专业英语能力、学费26,000元/年及报名费800元。',
      'Набор на осень 2026 года закрыт. Подтверждены HSK 5 (180) или два года китайского, профессиональный английский, 26 000 юаней в год и сбор 800 юаней.',
      'Die Herbstrunde 2026 ist geschlossen. Bestätigt sind HSK 5 (180) oder zwei Jahre Chinesisch, Fachenglisch, 26.000 CNY pro Jahr und 800 CNY Gebühr.',
      "La session d'automne 2026 est close. Sont confirmés HSK 5 (180) ou deux ans de chinois, anglais professionnel, 26 000 CNY par an et 800 CNY de frais.",
      'La convocatoria de otoño de 2026 está cerrada. Se confirman HSK 5 (180) o dos años de chino, inglés profesional, 26.000 CNY al año y 800 CNY de tasa.',
    ),
  }),
  ...[
    {
      key: 'civil-engineering',
      programId: 'program-chongqing-university-civil-engineering-bachelor',
      tuitionCny: 25000,
    },
    {
      key: 'electrical-engineering-and-automation',
      programId: 'program-chongqing-university-electrical-engineering-and-automation-bachelor',
      tuitionCny: 25000,
    },
    {
      key: 'materials-engineering',
      programId: 'program-chongqing-university-materials-engineering-bachelor',
      tuitionCny: 28000,
    },
  ].map((item) => previousCycle({
    id: `cycle-cqu-${item.key}-autumn-2026-historical`,
    programId: item.programId,
    sourceIds: [sourceSpecs[8].id, sourceSpecs[9].id],
    closesOn: '2026-05-31',
    tuitionCny: item.tuitionCny,
    applicationFeeCny: 600,
    notes: localized(
      'Closed 2026 autumn round. The undergraduate guide and official fee table confirm a four-year English-taught route, language evidence and a CNY 600 application fee; no 2027 date is inferred.',
      '2026年秋季轮次已关闭。本科简章与官方费用表确认四年制英文授课、语言证明要求及600元报名费；未推断任何2027年日期。',
      'Набор на осень 2026 года закрыт. Руководство и таблица сборов подтверждают четырёхлетнее обучение на английском, языковые документы и сбор 600 юаней; даты 2027 года не выводятся.',
      'Die Herbstrunde 2026 ist geschlossen. Leitfaden und Gebührentabelle bestätigen vier Jahre auf Englisch, Sprachnachweise und 600 CNY Gebühr; kein Datum für 2027 wird abgeleitet.',
      "La session d'automne 2026 est close. Le guide et le barème confirment quatre ans en anglais, les preuves linguistiques et 600 CNY de frais ; aucune date 2027 n'est déduite.",
      'La convocatoria de otoño de 2026 está cerrada. La guía y la tabla confirman cuatro años en inglés, pruebas lingüísticas y 600 CNY de tasa; no se infiere ninguna fecha de 2027.',
    ),
  })),
  {
    id: 'cycle-sisu-iclt-one-semester-spring-2027',
    programId: 'program-sisu-iclt-one-semester-spring-2027',
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
      'The official SISU guide publishes the 31 October 2026 deadline but no opening date. Applicants must use both the central scholarship system and the SISU scholarship channel; no self-funded fee is copied into this scholarship route.',
      '上外官方简章公布截止日为2026年10月31日，但未公布开放日。申请人须同时使用奖学金中央系统和上外奖学金通道；未将自费项目费用套用到本奖学金路线。',
      'Официальное руководство SISU указывает срок 31 октября 2026 года, но не дату открытия. Нужны центральная система и канал SISU; платные тарифы не переносятся.',
      'Der SISU-Leitfaden nennt den 31. Oktober 2026, aber kein Öffnungsdatum. Zentral- und SISU-System sind nötig; Selbstzahlergebühren werden nicht übertragen.',
      "Le guide SISU indique le 31 octobre 2026 sans date d'ouverture. Les deux systèmes sont requis ; aucun tarif autofinancé n'est repris.",
      'La guía de SISU indica el 31 de octubre de 2026 sin fecha de apertura. Se requieren ambos sistemas; no se trasladan tarifas de autofinanciación.',
    ),
    sourceIds: [sourceSpecs[2].id],
    verifiedAt: checkedAt,
    reviewAfter: upcomingReviewAfter,
    status: 'verified',
  },
]

for (const cycle of cycleSpecs) upsert(admissionCycles, cycle)

const unknownCoverage = {
  tuition: 'unknown',
  accommodation: 'unknown',
  insurance: 'unknown',
  stipendCnyPerMonth: null,
}

const scholarshipSpecs = [
  {
    id: 'scholarship-sisu-iclt-one-semester-spring-2027',
    slug: 'sisu-iclt-one-semester-spring-2027',
    name: localized(
      'International Chinese Language Teachers Scholarship at SISU — Spring 2027',
      '上海外国语大学国际中文教师奖学金（2027年春季）',
      'Стипендия для преподавателей китайского языка в SISU — весна 2027',
      'Internationales Chinesischlehrkräfte-Stipendium an der SISU — Frühjahr 2027',
      "Bourse pour enseignants internationaux de chinois à la SISU — printemps 2027",
      'Beca para profesores internacionales de chino en SISU — primavera de 2027',
    ),
    providerType: 'other',
    universityIds: [SISU],
    programIds: ['program-sisu-iclt-one-semester-spring-2027'],
    coverage: { tuition: 'full', accommodation: 'partial', insurance: true, stipendCnyPerMonth: 2500 },
    deadline: '2026-10-31',
    applicationUrl: 'https://pmplatform.chinese.cn/ui/start/#/login',
    summary: localized(
      'Covers tuition, an accommodation subsidy/reduction, CNY 2,500 per month and CNY 400 semester insurance. The opening date is not announced, and both central and SISU submissions are required.',
      '资助包含学费、住宿补贴/减免、每月2,500元生活费及每学期400元保险。开放日尚未公布，且须同时完成中央系统与上外渠道申请。',
      'Покрываются обучение, субсидия на проживание, 2 500 юаней в месяц и страховка 400 юаней за семестр. Дата открытия не объявлена; нужны обе системы.',
      'Enthalten sind Studiengebühren, Unterkunftszuschuss, 2.500 CNY monatlich und 400 CNY Versicherung je Semester. Das Öffnungsdatum fehlt; beide Systeme sind nötig.',
      "La bourse couvre les frais, une aide au logement, 2 500 CNY par mois et 400 CNY d'assurance par semestre. La date d'ouverture n'est pas annoncée ; les deux systèmes sont requis.",
      'Cubre matrícula, ayuda de alojamiento, 2.500 CNY al mes y 400 CNY de seguro por semestre. No se anuncia la apertura; se requieren ambos sistemas.',
    ),
    sourceIds: [sourceSpecs[2].id],
    verifiedAt: checkedAt,
    reviewAfter: upcomingReviewAfter,
    status: 'verified',
  },
  {
    id: 'scholarship-sisu-shanghai-government-2026',
    slug: 'sisu-shanghai-government-2026',
    name: localized('SISU Shanghai Government Scholarship 2026', '上海外国语大学上海市政府奖学金（2026）', 'Шанхайская правительственная стипендия SISU 2026', 'Shanghai-Regierungsstipendium an der SISU 2026', 'Bourse du gouvernement de Shanghai à la SISU 2026', 'Beca del Gobierno de Shanghái en SISU 2026'),
    providerType: 'city',
    universityIds: [SISU],
    programIds: [
      'program-shanghai-international-studies-university-international-relations-master',
      'program-shanghai-international-studies-university-translation-bachelor',
    ],
    coverage: { tuition: 'full', accommodation: 'unknown', insurance: true, stipendCnyPerMonth: null },
    deadline: '2026-03-31',
    applicationUrl: null,
    summary: localized(
      'Closed 2026 route. Type A includes tuition, accommodation, insurance and monthly stipend (master CNY 3,000; doctorate CNY 3,500); Type B includes tuition and insurance. Hongkou TCSOL and professional master routes are excluded.',
      '2026年路线已关闭。A类含学费、住宿、保险及生活费（硕士每月3,000元、博士每月3,500元）；B类含学费和保险。虹口汉语国际教育及专业硕士路线不适用。',
      'Программа 2026 года закрыта. Тип A покрывает обучение, проживание, страховку и пособие (магистр 3 000, доктор 3 500); тип B — обучение и страховку. Hongkou TCSOL и профессиональные магистратуры исключены.',
      'Die Runde 2026 ist geschlossen. Typ A umfasst Gebühren, Unterkunft, Versicherung und Stipendium (Master 3.000, Promotion 3.500 CNY); Typ B Gebühren und Versicherung. Hongkou-TCSOL und professionelle Master sind ausgeschlossen.',
      "La voie 2026 est close. Le type A couvre frais, logement, assurance et allocation (master 3 000, doctorat 3 500 CNY) ; le type B couvre frais et assurance. TCSOL Hongkou et masters professionnels sont exclus.",
      'La vía 2026 está cerrada. Tipo A cubre matrícula, alojamiento, seguro y estipendio (máster 3.000, doctorado 3.500 CNY); tipo B matrícula y seguro. Se excluyen TCSOL Hongkou y másteres profesionales.',
    ),
    sourceIds: [sourceSpecs[3].id],
    verifiedAt: checkedAt,
    reviewAfter: checkedAt,
    status: 'stale',
  },
  {
    id: 'scholarship-anhui-university-csc-high-level-postgraduate-2026-2027',
    slug: 'anhui-university-csc-high-level-postgraduate-2026-2027',
    name: localized('Anhui University CSC High-Level Postgraduate Program 2026–2027', '安徽大学中国政府奖学金高水平研究生项目（2026—2027）', 'Программа CSC для аспирантов высокого уровня в AHU 2026–2027', 'CSC-High-Level-Postgraduate-Programm der AHU 2026–2027', 'Programme CSC de haut niveau de l’AHU 2026–2027', 'Programa CSC de posgrado de alto nivel de AHU 2026–2027'),
    providerType: 'csc',
    universityIds: [AHU],
    programIds: [],
    coverage: unknownCoverage,
    deadline: '2026-03-15',
    applicationUrl: null,
    summary: localized(
      'Closed master/doctoral route (15 January 08:00–15 March 17:00). Chinese programs require HSK 5 (210); English programs require TOEFL 75 or IELTS 6.0. The verified guide does not announce a safe coverage amount.',
      '硕博路线已关闭（1月15日08:00至3月15日17:00）。中文项目要求HSK五级210分，英文项目要求托福75或雅思6.0；已核验简章未公布可安全展示的资助金额。',
      'Закрытая магистерская/докторская программа (15 января 08:00–15 марта 17:00). Китайские программы: HSK 5 (210); английские: TOEFL 75 или IELTS 6.0. Размер покрытия не объявлен.',
      'Geschlossene Master-/Promotionsroute (15. Januar 08:00–15. März 17:00). Chinesisch: HSK 5 (210); Englisch: TOEFL 75 oder IELTS 6,0. Eine belastbare Förderhöhe ist nicht veröffentlicht.',
      "Voie master/doctorat close (15 janvier 08:00–15 mars 17:00). Chinois : HSK 5 (210) ; anglais : TOEFL 75 ou IELTS 6,0. Le montant fiable n'est pas annoncé.",
      'Vía de máster/doctorado cerrada (15 enero 08:00–15 marzo 17:00). Chino: HSK 5 (210); inglés: TOEFL 75 o IELTS 6,0. No se anuncia una cobertura fiable.',
    ),
    sourceIds: [sourceSpecs[7].id],
    verifiedAt: checkedAt,
    reviewAfter: checkedAt,
    status: 'stale',
  },
  {
    id: 'scholarship-chongqing-university-president-2026',
    slug: 'chongqing-university-president-2026',
    name: localized('Chongqing University President Scholarship 2026', '重庆大学校长奖学金（2026）', 'Президентская стипендия CQU 2026', 'Präsidentenstipendium der CQU 2026', 'Bourse du président de la CQU 2026', 'Beca del Presidente de CQU 2026'),
    providerType: 'university',
    universityIds: [CQU],
    programIds: [],
    coverage: { tuition: 'partial', accommodation: 'unknown', insurance: 'unknown', stipendCnyPerMonth: null },
    deadline: '2026-05-17',
    applicationUrl: null,
    summary: localized(
      'Closed 2026 route. First class covers full tuition, on-campus housing or CNY 700/month off campus, plus CNY 1,500/1,800/2,200 monthly for bachelor/master/doctorate; second class covers full tuition and third class 50%. Insurance is hidden because official pages conflict.',
      '2026年路线已关闭。一等含全额学费、校内住宿或校外每月700元，以及本科/硕士/博士每月1,500/1,800/2,200元；二等含全额学费，三等含50%学费。因官方页面冲突，保险字段隐藏。',
      'Программа 2026 года закрыта. 1-я категория: полное обучение, общежитие или 700 юаней/мес. и 1 500/1 800/2 200 для бакалавра/магистра/доктора; 2-я — полное обучение, 3-я — 50%. Страховка скрыта из-за конфликта.',
      'Die Runde 2026 ist geschlossen. Klasse 1: volle Gebühren, Wohnheim oder 700 CNY/Monat sowie 1.500/1.800/2.200 CNY; Klasse 2 volle, Klasse 3 50 % Gebühren. Versicherung bleibt wegen Quellenkonflikt unbekannt.',
      "La voie 2026 est close. Classe 1 : frais complets, logement ou 700 CNY/mois et 1 500/1 800/2 200 CNY ; classe 2 : frais complets ; classe 3 : 50 %. L'assurance est masquée en raison d'un conflit officiel.",
      'La vía 2026 está cerrada. Clase 1: matrícula completa, alojamiento o 700 CNY/mes y 1.500/1.800/2.200 CNY; clase 2 completa; clase 3 50%. El seguro se oculta por conflicto oficial.',
    ),
    sourceIds: [sourceSpecs[11].id, sourceSpecs[12].id],
    verifiedAt: checkedAt,
    reviewAfter: checkedAt,
    status: 'stale',
  },
  {
    id: 'scholarship-chongqing-mayor',
    slug: 'chongqing-mayor',
    name: localized('Chongqing Mayor Scholarship at CQU 2026', '重庆大学重庆市市长奖学金（2026）', 'Стипендия мэра Чунцина в CQU 2026', 'Chongqing-Bürgermeisterstipendium an der CQU 2026', 'Bourse du maire de Chongqing à la CQU 2026', 'Beca del Alcalde de Chongqing en CQU 2026'),
    providerType: 'city',
    universityIds: [CQU],
    programIds: [],
    coverage: { tuition: 'full', accommodation: 'none', insurance: false, stipendCnyPerMonth: null },
    deadline: '2026-06-16',
    applicationUrl: null,
    summary: localized(
      'Closed 2026 master/doctoral route. CQU waives tuition and the municipal award is CNY 30,000/year for master and CNY 35,000/year for doctorate, paid monthly. Accommodation and other costs are self-funded.',
      '2026年硕博路线已关闭。重庆大学免收学费，市长奖学金按月发放：硕士30,000元/年、博士35,000元/年；住宿及其他费用自理。',
      'Закрытая программа 2026 года для магистров/докторов. CQU освобождает от обучения; выплата 30 000/35 000 юаней в год помесячно. Проживание и прочее оплачиваются самостоятельно.',
      'Geschlossene Master-/Promotionsroute 2026. CQU erlässt die Gebühren; 30.000/35.000 CNY jährlich werden monatlich gezahlt. Unterkunft und weitere Kosten sind selbst zu tragen.',
      "Voie master/doctorat 2026 close. La CQU exonère les frais ; 30 000/35 000 CNY par an sont versés mensuellement. Logement et autres coûts sont à charge de l'étudiant.",
      'Vía 2026 de máster/doctorado cerrada. CQU exime matrícula; 30.000/35.000 CNY al año se pagan mensualmente. Alojamiento y demás gastos son propios.',
    ),
    sourceIds: [sourceSpecs[13].id],
    verifiedAt: checkedAt,
    reviewAfter: checkedAt,
    status: 'stale',
  },
  {
    id: 'scholarship-cqu-iclt-2026',
    slug: 'cqu-iclt-2026',
    name: localized('CQU International Chinese Language Teachers Scholarship 2026', '重庆大学国际中文教师奖学金（2026）', 'Стипендия CQU для преподавателей китайского языка 2026', 'CQU-Stipendium für internationale Chinesischlehrkräfte 2026', 'Bourse CQU pour enseignants internationaux de chinois 2026', 'Beca CQU para profesores internacionales de chino 2026'),
    providerType: 'other',
    universityIds: [CQU],
    programIds: [],
    coverage: { tuition: 'full', accommodation: 'full', insurance: true, stipendCnyPerMonth: null },
    deadline: '2026-10-31',
    applicationUrl: null,
    summary: localized(
      'The September 2026 route closed on 11 May. The official guide separately publishes 31 October 2026 for March 2027 entry but no opening date, so no open application CTA is shown. Coverage includes tuition, accommodation and insurance; monthly stipend is CNY 2,500 for bachelor/year/semester routes and CNY 3,000 for MTCOSL. The three-year MTCOSL receives two scholarship-funded years.',
      '2026年9月入学路线已于5月11日关闭。官方简章另行公布2027年3月入学截止日为2026年10月31日，但未公布开放日，因此不展示“正在申请”入口。资助含学费、住宿和保险；本科/一学年/一学期每月2,500元，国际中文教育硕士每月3,000元。三年制硕士资助两年。',
      'Сентябрьский набор 2026 года закрыт 11 мая. Для марта 2027 года указан срок 31 октября 2026 года, но дата открытия отсутствует, поэтому CTA не показывается. Покрываются обучение, проживание и страховка; 2 500/3 000 юаней в месяц. Трёхлетняя MTCOSL финансируется два года.',
      'Der September-2026-Weg schloss am 11. Mai. Für März 2027 gilt der 31. Oktober 2026, aber ohne Öffnungsdatum; daher kein offener CTA. Gebühren, Unterkunft und Versicherung sind gedeckt; 2.500/3.000 CNY monatlich. MTCOSL wird zwei von drei Jahren gefördert.',
      "La voie de septembre 2026 a fermé le 11 mai. Pour mars 2027, l'échéance est le 31 octobre 2026 sans date d'ouverture ; aucun CTA ouvert n'est affiché. Frais, logement et assurance sont couverts ; 2 500/3 000 CNY par mois. Le MTCOSL est financé deux ans sur trois.",
      'La vía de septiembre de 2026 cerró el 11 de mayo. Para marzo de 2027 se fija el 31 de octubre de 2026 sin apertura; no se muestra CTA abierto. Cubre matrícula, alojamiento y seguro; 2.500/3.000 CNY al mes. MTCOSL financia dos de tres años.',
    ),
    sourceIds: [sourceSpecs[14].id],
    verifiedAt: checkedAt,
    reviewAfter: upcomingReviewAfter,
    status: 'verified',
  },
]

for (const scholarship of scholarshipSpecs) upsert(scholarships, scholarship)

write('sources.json', sources)
write('programs.json', programs)
write('admission-cycles.json', admissionCycles)
write('scholarships.json', scholarships)

console.log(JSON.stringify({
  checkedAt,
  sources: sourceSpecs.length,
  refreshedPrograms: 10,
  historicalCycles: cycleSpecs.filter((item) => item.status === 'stale').length,
  currentCycles: cycleSpecs.filter((item) => item.status === 'verified').length,
  scholarships: scholarshipSpecs.length,
  ahuReferenceFactsWithheld: ['tuitionCny', 'applicationFeeCny', 'HSK'],
  sisuTcsolConflictingCycleWithheld: true,
}, null, 2))
