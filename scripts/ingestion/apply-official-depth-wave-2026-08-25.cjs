const fs = require('node:fs')
const path = require('node:path')

const dataDir = path.join(process.cwd(), 'content', 'data')
const checkedAt = '2026-08-25'
const profileReviewAfter = '2026-09-24'
const scholarshipReviewAfter = '2026-09-24'
const highRiskReviewAfter = '2026-09-01'

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
const localized = (en, zh, ru, de, fr, es) => ({ en, zh, ru, de, fr, es })

const sourceSpecs = [
  {
    id: 'source-cug-2026-high-level-postgraduate-programs',
    url: 'https://eniec.cug.edu.cn/Scholarships/Chinese_Government_Scholarships/High_Level_Postgraduate_Program.htm',
    title: 'CUG 2026 Chinese Government Scholarship — High-Level Postgraduate Program',
    publisher: 'China University of Geosciences (Wuhan)',
    kind: 'program',
    language: 'en',
  },
  {
    id: 'source-cug-2026-international-chinese-language-teachers-scholarship',
    url: 'https://eniec.cug.edu.cn/Scholarships/Chinese_Government_Scholarships/International_Chinese_Language_Teachers_Scholars.htm',
    title: 'CUG 2026 International Chinese Language Teachers Scholarship',
    publisher: 'China University of Geosciences (Wuhan)',
    kind: 'scholarship',
    language: 'en',
  },
  {
    id: 'source-gzhmu-2026-international-graduate-admission',
    url: 'https://fao.gzhmu.edu.cn/info/1301/9522.htm',
    title: "Guangzhou Medical University 2026 Admission Guide for International Master's/Doctoral Students",
    publisher: 'Guangzhou Medical University',
    kind: 'program',
    language: 'en',
  },
  {
    id: 'source-gzmu-2026-cgs-asean-programs',
    url: 'https://soe.gmc.edu.cn/info/1008/1656.htm',
    title: 'Guizhou Medical University 2026 Chinese Government Scholarship ASEAN Countries Program',
    publisher: 'Guizhou Medical University',
    kind: 'program',
    language: 'en',
  },
  {
    id: 'source-jxnu-2026-english-undergraduate-programs',
    url: 'https://laihua.jxnu.edu.cn/2026/0226/c5944a289932/page.htm',
    title: 'Jiangxi Normal University 2026 English-Taught Undergraduate Programs Admission Guide',
    publisher: 'Jiangxi Normal University',
    kind: 'program',
    language: 'zh',
  },
  {
    id: 'source-jxnu-2026-international-student-scholarship',
    url: 'https://laihua.jxnu.edu.cn/2026/0226/c5944a289932/page.htm',
    title: 'Jiangxi Normal University 2026 International Student Scholarship Route',
    publisher: 'Jiangxi Normal University',
    kind: 'scholarship',
    language: 'zh',
  },
  {
    id: 'source-wtu-2026-international-admission-guide',
    url: 'https://iec.wtu.edu.cn/info/1060/4292.htm',
    title: 'Wuhan Textile University 2026 Admission Guidance for International Students',
    publisher: 'Wuhan Textile University',
    kind: 'program',
    language: 'en',
  },
  {
    id: 'source-wtu-2026-international-scholarships',
    url: 'https://iec.wtu.edu.cn/info/1060/4292.htm',
    title: 'Wuhan Textile University 2026 International Student Scholarship Routes',
    publisher: 'Wuhan Textile University',
    kind: 'scholarship',
    language: 'en',
  },
].map((source) => ({ ...source, official: true, accessedAt: checkedAt }))

function program({
  id,
  slug,
  universityId,
  name,
  degreeLevel,
  discipline,
  sourceId,
  programUrl,
  applyUrl,
  teachingLanguage,
  durationMonths,
  languageRequirements = [],
}) {
  return {
    sourceIds: [sourceId],
    verifiedAt: checkedAt,
    reviewAfter: profileReviewAfter,
    status: 'verified',
    id,
    slug,
    universityId,
    name,
    degreeLevel,
    discipline,
    teachingLanguages: teachingLanguage ? [teachingLanguage] : [],
    durationMonths,
    programUrl,
    applyUrl,
    languageRequirements,
    verificationScope: 'facts',
  }
}

const cugProgramUrl = sourceSpecs[0].url
const gzhmuProgramUrl = sourceSpecs[2].url
const gzmuProgramUrl = sourceSpecs[3].url
const jxnuProgramUrl = sourceSpecs[4].url
const wtuProgramUrl = sourceSpecs[6].url

const programSpecs = [
  program({
    id: 'program-cug-wuhan-business-administration-high-level-postgraduate-master',
    slug: 'cug-wuhan-business-administration-high-level-postgraduate-master',
    universityId: 'uni-china-university-of-geosciences-wuhan',
    name: localized(
      'Business Administration — High-Level Postgraduate Scholarship Route',
      '工商管理（高水平研究生奖学金路线）',
      'Деловое администрирование — стипендиальная программа высокого уровня',
      'Betriebswirtschaftslehre — High-Level-Postgraduate-Stipendienweg',
      'Administration des affaires — parcours de bourse de haut niveau',
      'Administración de Empresas — vía de beca de posgrado de alto nivel',
    ),
    degreeLevel: 'master',
    discipline: 'business',
    sourceId: sourceSpecs[0].id,
    programUrl: cugProgramUrl,
    applyUrl: 'https://studyinchina.csc.edu.cn/',
    teachingLanguage: 'English',
    durationMonths: null,
    languageRequirements: [
      { test: 'IELTS', minimum: '6.0' },
      { test: 'TOEFL', minimum: '80 (iBT)' },
    ],
  }),
  program({
    id: 'program-guangzhou-medical-university-medical-fields-academic-doctorate',
    slug: 'guangzhou-medical-university-medical-fields-academic-doctorate',
    universityId: 'uni-guangzhou-medical-university',
    name: localized(
      'Academic Doctorate in Medicine and Medical-related Fields',
      '医学及医学相关专业学术型博士',
      'Академическая докторантура по медицине и смежным направлениям',
      'Akademische Promotion in Medizin und verwandten Fachgebieten',
      'Doctorat académique en médecine et domaines connexes',
      'Doctorado académico en medicina y campos relacionados',
    ),
    degreeLevel: 'doctorate',
    discipline: 'medicine',
    sourceId: sourceSpecs[2].id,
    programUrl: gzhmuProgramUrl,
    applyUrl: 'https://gzhmu.at0086.cn/Student',
    teachingLanguage: 'Chinese',
    durationMonths: 36,
    languageRequirements: [{ test: 'HSK', minimum: 'Level 4, 180' }],
  }),
  ...[
    {
      key: 'nursing', durationMonths: 48,
      name: localized('Nursing — China-ASEAN Scholarship Route', '护理学（中国—东盟奖学金路线）', 'Сестринское дело — стипендиальная программа Китай–АСЕАН', 'Pflegewissenschaft — China-ASEAN-Stipendienweg', 'Sciences infirmières — parcours de bourse Chine-ASEAN', 'Enfermería — vía de beca China-ASEAN'),
    },
    {
      key: 'preventive-medicine', durationMonths: 60,
      name: localized('Preventive Medicine — China-ASEAN Scholarship Route', '预防医学（中国—东盟奖学金路线）', 'Профилактическая медицина — стипендиальная программа Китай–АСЕАН', 'Präventivmedizin — China-ASEAN-Stipendienweg', 'Médecine préventive — parcours de bourse Chine-ASEAN', 'Medicina preventiva — vía de beca China-ASEAN'),
    },
    {
      key: 'medical-laboratory-technology', durationMonths: 48,
      name: localized('Medical Laboratory Technology — China-ASEAN Scholarship Route', '医学检验技术（中国—东盟奖学金路线）', 'Медицинские лабораторные технологии — стипендиальная программа Китай–АСЕАН', 'Medizinische Labortechnologie — China-ASEAN-Stipendienweg', 'Technologie de laboratoire médical — parcours de bourse Chine-ASEAN', 'Tecnología de laboratorio médico — vía de beca China-ASEAN'),
    },
  ].map((item) => program({
    id: `program-guizhou-medical-university-${item.key}-asean-cgs-bachelor`,
    slug: `guizhou-medical-university-${item.key}-asean-cgs-bachelor`,
    universityId: 'uni-guizhou-medical-university',
    name: item.name,
    degreeLevel: 'bachelor',
    discipline: 'medicine',
    sourceId: sourceSpecs[3].id,
    programUrl: gzmuProgramUrl,
    applyUrl: 'https://studyinchina.csc.edu.cn/#/login',
    teachingLanguage: 'Chinese',
    durationMonths: item.durationMonths,
    languageRequirements: [{ test: 'HSK', minimum: 'Level 4, 180' }],
  })),
  ...[
    {
      key: 'business-administration', discipline: 'business',
      name: localized('Business Administration', '工商管理', 'Деловое администрирование', 'Betriebswirtschaftslehre', 'Administration des affaires', 'Administración de Empresas'),
    },
    {
      key: 'international-economics-and-trade', discipline: 'business',
      name: localized('International Economics and Trade', '国际经济与贸易', 'Международная экономика и торговля', 'Internationale Wirtschaft und Handel', 'Économie et commerce internationaux', 'Economía y Comercio Internacional'),
    },
    {
      key: 'computer-science-and-technology', discipline: 'engineering',
      name: localized('Computer Science and Technology', '计算机科学与技术', 'Информатика и технологии', 'Informatik und Technologie', 'Informatique et technologie', 'Ciencias y Tecnología de la Computación'),
    },
  ].map((item) => program({
    id: `program-jiangxi-normal-university-${item.key}-english-bachelor`,
    slug: `jiangxi-normal-university-${item.key}-english-bachelor`,
    universityId: 'uni-jiangxi-normal-university',
    name: item.name,
    degreeLevel: 'bachelor',
    discipline: item.discipline,
    sourceId: sourceSpecs[4].id,
    programUrl: jxnuProgramUrl,
    applyUrl: null,
    teachingLanguage: 'English',
    durationMonths: 48,
  })),
  ...[
    {
      key: 'textile-engineering', discipline: 'engineering',
      name: localized('Textile Engineering', '纺织工程', 'Текстильная инженерия', 'Textilingenieurwesen', 'Génie textile', 'Ingeniería Textil'),
    },
    {
      key: 'computer-science-and-technology', discipline: 'engineering',
      name: localized('Computer Science and Technology', '计算机科学与技术', 'Информатика и технологии', 'Informatik und Technologie', 'Informatique et technologie', 'Ciencias y Tecnología de la Computación'),
    },
    {
      key: 'business-administration', discipline: 'business',
      name: localized('Business Administration', '工商管理', 'Деловое администрирование', 'Betriebswirtschaftslehre', 'Administration des affaires', 'Administración de Empresas'),
    },
  ].map((item) => program({
    id: `program-wuhan-textile-university-${item.key}-english-master`,
    slug: `wuhan-textile-university-${item.key}-english-master`,
    universityId: 'uni-wuhan-textile-university',
    name: item.name,
    degreeLevel: 'master',
    discipline: item.discipline,
    sourceId: sourceSpecs[6].id,
    programUrl: wtuProgramUrl,
    applyUrl: 'https://wtu.17gz.org/',
    teachingLanguage: 'English',
    durationMonths: 24,
  })),
]

function historicalCycle(id, programId, sourceId, opensOn, closesOn, tuitionCny = null) {
  return {
    sourceIds: [sourceId],
    verifiedAt: checkedAt,
    reviewAfter: checkedAt,
    status: 'stale',
    id,
    programId,
    academicYear: '2026-2027',
    intake: 'autumn',
    opensOn,
    closesOn,
    dateStatus: 'previous-cycle-reference',
    tuitionCny,
    tuitionPeriod: tuitionCny === null ? null : 'academic-year',
    tuitionStatus: tuitionCny === null ? null : 'confirmed',
    evidenceBasis: 'cycle-specific',
    factScope: 'partial',
    applicationFeeCny: null,
  }
}

const cycleSpecs = [
  historicalCycle(
    'cycle-2026-cug-business-administration-high-level-postgraduate',
    'program-cug-wuhan-business-administration-high-level-postgraduate-master',
    sourceSpecs[0].id,
    '2025-10-25',
    '2026-02-28',
  ),
  historicalCycle(
    'cycle-2026-gzhmu-medical-fields-academic-doctorate',
    'program-guangzhou-medical-university-medical-fields-academic-doctorate',
    sourceSpecs[2].id,
    '2026-03-01',
    '2026-06-30',
    30000,
  ),
  ...programSpecs
    .filter((item) => item.id.startsWith('program-guizhou-medical-university-'))
    .map((item) => historicalCycle(
      `cycle-2026-${item.slug}`,
      item.id,
      sourceSpecs[3].id,
      null,
      '2026-04-16',
    )),
]

function scholarship({ id, slug, name, providerType, universityIds, sourceId, coverage, summary, reviewAfter = scholarshipReviewAfter }) {
  return {
    sourceIds: [sourceId],
    verifiedAt: checkedAt,
    reviewAfter,
    status: 'verified',
    id,
    slug,
    name,
    providerType,
    universityIds,
    programIds: [],
    coverage,
    deadline: null,
    applicationUrl: null,
    summary,
  }
}

const unknownCoverage = {
  tuition: 'unknown',
  accommodation: 'unknown',
  insurance: 'unknown',
  stipendCnyPerMonth: null,
}

const scholarshipSpecs = [
  scholarship({
    id: 'scholarship-cug-international-chinese-language-teachers-2026',
    slug: 'cug-international-chinese-language-teachers-2026',
    name: localized('CUG International Chinese Language Teachers Scholarship', '中国地质大学（武汉）国际中文教师奖学金', 'Стипендия CUG для преподавателей китайского языка', 'CUG-Stipendium für internationale Chinesischlehrkräfte', 'Bourse CUG pour enseignants internationaux de chinois', 'Beca CUG para profesores internacionales de chino'),
    providerType: 'other',
    universityIds: ['uni-china-university-of-geosciences-wuhan'],
    sourceId: sourceSpecs[1].id,
    coverage: { tuition: 'full', accommodation: 'full', insurance: true, stipendCnyPerMonth: null },
    reviewAfter: highRiskReviewAfter,
    summary: localized(
      'The official CUG route covers tuition, accommodation, insurance and a living allowance for eligible non-four-week categories; the next individual deadline is withheld because the page contains a year conflict.',
      '中国地质大学（武汉）官方路线为符合条件的非四周类别提供学费、住宿、保险和生活费；因官网年份存在冲突，暂不展示下一个人申请截止日。',
      'Официальная программа CUG покрывает обучение, проживание, страховку и пособие для подходящих категорий, кроме четырёхнедельной; следующий индивидуальный срок скрыт из-за противоречия в годе на странице.',
      'Die offizielle CUG-Route deckt für geeignete Kategorien außer dem Vierwochenkurs Studiengebühren, Unterkunft, Versicherung und Lebensunterhalt; wegen eines Jahreskonflikts wird keine nächste Frist angezeigt.',
      "La voie officielle de la CUG couvre les frais, le logement, l'assurance et une allocation pour les catégories admissibles hors programme de quatre semaines ; la prochaine échéance individuelle est masquée en raison d'un conflit d'année.",
      'La vía oficial de CUG cubre matrícula, alojamiento, seguro y manutención para las categorías elegibles excepto la de cuatro semanas; no se muestra la próxima fecha individual por un conflicto de año.',
    ),
  }),
  scholarship({
    id: 'scholarship-jxnu-international-student-university-scholarship',
    slug: 'jxnu-international-student-university-scholarship',
    name: localized('JXNU International Student Scholarship', '江西师范大学来华留学生奖学金', 'Стипендия JXNU для иностранных студентов', 'JXNU-Stipendium für internationale Studierende', 'Bourse JXNU pour étudiants internationaux', 'Beca JXNU para estudiantes internacionales'),
    providerType: 'university',
    universityIds: ['uni-jiangxi-normal-university'],
    sourceId: sourceSpecs[5].id,
    coverage: unknownCoverage,
    summary: localized('The 2026 official admission guide confirms this university scholarship; the current award amount and deadline are not announced on the verified page.', '2026年官方招生简章确认该校级奖学金；已核验页面未公布当期金额和截止日。', 'Официальное руководство 2026 года подтверждает университетскую стипендию; текущий размер и срок на проверенной странице не объявлены.', 'Der offizielle Leitfaden 2026 bestätigt das Hochschulstipendium; aktuelle Höhe und Frist sind auf der geprüften Seite nicht veröffentlicht.', "Le guide officiel 2026 confirme cette bourse universitaire ; le montant et l'échéance actuels ne sont pas annoncés sur la page vérifiée.", 'La guía oficial de 2026 confirma esta beca universitaria; la cuantía y la fecha actuales no se anuncian en la página verificada.'),
  }),
  scholarship({
    id: 'scholarship-wtu-hubei-provincial-international-students',
    slug: 'wtu-hubei-provincial-international-students',
    name: localized('Hubei Provincial Scholarship at WTU', '武汉纺织大学湖北省外国留学生奖学金', 'Провинциальная стипендия Хубэя в WTU', 'Hubei-Provinzstipendium an der WTU', 'Bourse provinciale du Hubei à la WTU', 'Beca provincial de Hubei en WTU'),
    providerType: 'province',
    universityIds: ['uni-wuhan-textile-university'],
    sourceId: sourceSpecs[7].id,
    coverage: unknownCoverage,
    summary: localized('WTU’s 2026 official guide confirms full and partial provincial funding routes; exact current tiers and deadline remain unannounced.', '武汉纺织大学2026年官方简章确认省级全额和部分资助路线；当期具体档位和截止日尚未公布。', 'Официальное руководство WTU 2026 года подтверждает полное и частичное провинциальное финансирование; точные уровни и срок пока не объявлены.', 'Der offizielle WTU-Leitfaden 2026 bestätigt vollständige und teilweise Provinzförderung; genaue Stufen und Frist sind noch nicht veröffentlicht.', 'Le guide officiel 2026 de la WTU confirme des voies provinciales intégrales et partielles ; les niveaux exacts et la date limite ne sont pas annoncés.', 'La guía oficial 2026 de WTU confirma vías provinciales completas y parciales; los niveles exactos y la fecha límite no se han anunciado.'),
  }),
  scholarship({
    id: 'scholarship-wtu-university-international-students',
    slug: 'wtu-university-international-students',
    name: localized('WTU International Student Scholarship', '武汉纺织大学来华留学生校级奖学金', 'Стипендия WTU для иностранных студентов', 'WTU-Stipendium für internationale Studierende', 'Bourse WTU pour étudiants internationaux', 'Beca WTU para estudiantes internacionales'),
    providerType: 'university',
    universityIds: ['uni-wuhan-textile-university'],
    sourceId: sourceSpecs[7].id,
    coverage: unknownCoverage,
    summary: localized('WTU’s 2026 official guide confirms a university partial-funding route; the exact award and application deadline are not announced.', '武汉纺织大学2026年官方简章确认校级部分资助路线；具体金额和申请截止日尚未公布。', 'Официальное руководство WTU 2026 года подтверждает частичную университетскую поддержку; точный размер и срок не объявлены.', 'Der offizielle WTU-Leitfaden 2026 bestätigt eine teilweise Hochschulförderung; genaue Höhe und Bewerbungsfrist sind nicht veröffentlicht.', "Le guide officiel 2026 de la WTU confirme une aide partielle de l'université ; le montant exact et la date limite ne sont pas annoncés.", 'La guía oficial 2026 de WTU confirma una ayuda parcial de la universidad; la cuantía exacta y la fecha límite no se anuncian.'),
  }),
]

const sources = read('sources.json')
const programs = read('programs.json')
const admissionCycles = read('admission-cycles.json')
const scholarships = read('scholarships.json')

for (const item of sourceSpecs) upsert(sources, item)
for (const item of programSpecs) upsert(programs, item)
for (const item of cycleSpecs) upsert(admissionCycles, item)
for (const item of scholarshipSpecs) upsert(scholarships, item)

write('sources.json', sources)
write('programs.json', programs)
write('admission-cycles.json', admissionCycles)
write('scholarships.json', scholarships)

console.log(JSON.stringify({
  checkedAt,
  sources: sourceSpecs.length,
  programs: programSpecs.length,
  historicalCycles: cycleSpecs.length,
  scholarships: scholarshipSpecs.length,
}, null, 2))
