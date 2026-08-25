const fs = require('node:fs')
const path = require('node:path')

const checkedAt = '2026-08-25'
const reviewAfter = '2026-09-24'
const icltReviewAfter = '2026-09-01'
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

const degreeGuideUrl = 'https://iie.gdufs.edu.cn/info/1099/5488.htm'
const languageGuideUrl = 'https://iie.gdufs.edu.cn/info/1099/5508.htm'
const universityScholarshipUrl = 'https://iie.gdufs.edu.cn/info/1126/5578.htm'
const applicationPortalUrl = 'https://gdufs.17gz.org/'

const sourceSpecs = [
  {
    id: 'src-gdufs-2026-degree-admissions',
    url: degreeGuideUrl,
    title: '2026年秋季国际学生·学历生报名通知',
    publisher: 'Guangdong University of Foreign Studies',
    kind: 'admissions',
    language: 'zh',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'source-gdufs-2026-autumn-chinese-language-program',
    url: languageGuideUrl,
    title: 'GDUFS 2026 Autumn Chinese Language Program Admissions',
    publisher: 'Guangdong University of Foreign Studies',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'src-gdufs-iclt-scholarship',
    url: 'https://iie.gdufs.edu.cn/info/1087/1536.htm',
    title: '国际中文教师奖学金（研修生及本科生奖学金）申请办法',
    publisher: 'Guangdong University of Foreign Studies',
    kind: 'program',
    language: 'zh',
    official: true,
    accessedAt: checkedAt,
  },
  {
    id: 'source-gdufs-2026-university-scholarship',
    url: universityScholarshipUrl,
    title: 'GDUFS 2026 International Student Scholarship',
    publisher: 'Guangdong University of Foreign Studies',
    kind: 'scholarship',
    language: 'zh',
    official: true,
    accessedAt: checkedAt,
  },
]

const chineseBachelorRequirements = [{
  test: 'HSK',
  minimum: 'No HSK is required for Year 1; direct entry to Year 2 requires HSK 4 (180), and direct entry to Year 3 requires HSK 5 (180).',
}]
const englishBachelorRequirements = [
  { test: 'IELTS', minimum: '5.5' },
  { test: 'TOEFL', minimum: '70' },
  {
    test: 'other',
    minimum: 'Equivalent English-medium evidence may be assessed by GDUFS; HSK 4 is required before graduation, not as a universal admission prerequisite.',
  },
]
const mtcoslRequirements = [{ test: 'HSK', minimum: 'Level 5, score 210' }]
const doctorateRequirements = [{ test: 'HSK', minimum: 'Level 5, score 180' }]
const mbaRequirements = [
  {
    test: 'other',
    minimum: 'English proficiency evidence such as GMAT, GRE, TOEFL or IELTS, or another accepted certificate, plus relevant work experience; HSK 4 is required before graduation.',
  },
]
const languageSemesterRequirements = [{
  test: 'other',
  minimum: 'The 2026 self-funded semester route states no Chinese-language prerequisite; applicants must be 18–35 and eligible for a Chinese study visa.',
}]
const icltSemesterRequirements = [
  { test: 'HSK', minimum: 'Level 3, score 180' },
  {
    test: 'other',
    minimum: 'An HSKK result and a recommendation from an eligible recommending institution are required by the scholarship route.',
  },
]

const currentDegreeProgram = {
  applyUrl: applicationPortalUrl,
  verificationScope: 'facts',
  verifiedAt: checkedAt,
  reviewAfter,
  status: 'verified',
}

const programSpecs = [
  {
    id: 'program-guangdong-university-of-foreign-studies-chinese-language-bachelor',
    ...currentDegreeProgram,
    programUrl: 'https://iie.gdufs.edu.cn/info/1078/3350.htm',
    sourceIds: ['src-gdufs-chinese-language-bachelor', 'src-gdufs-2026-degree-admissions'],
    name: localized('Chinese Language', '汉语言', 'Китайский язык', 'Chinesische Sprache', 'Langue chinoise', 'Lengua china'),
    teachingLanguages: ['Chinese'],
    durationMonths: 48,
    durationMonthsMax: null,
    languageRequirements: chineseBachelorRequirements,
  },
  {
    id: 'program-guangdong-university-of-foreign-studies-international-business-bachelor',
    ...currentDegreeProgram,
    programUrl: 'https://iie-en.gdufs.edu.cn/info/1132/1951.htm',
    sourceIds: ['src-gdufs-international-business-bachelor', 'src-gdufs-2026-degree-admissions'],
    name: localized('International Business', '国际商务', 'Международный бизнес', 'Internationales Geschäft', 'Commerce international', 'Negocios internacionales'),
    teachingLanguages: ['English'],
    durationMonths: 48,
    durationMonthsMax: null,
    languageRequirements: englishBachelorRequirements,
  },
  {
    id: 'program-guangdong-university-of-foreign-studies-global-economic-governance-doctorate',
    ...currentDegreeProgram,
    programUrl: 'https://giis.gdufs.edu.cn/info/1643/16885.htm',
    sourceIds: ['src-gdufs-global-economic-governance', 'src-gdufs-2026-degree-admissions'],
    name: localized('Global Economic Governance', '全球经济治理', 'Глобальное экономическое управление', 'Globale Wirtschaftsgovernance', 'Gouvernance économique mondiale', 'Gobernanza económica mundial'),
    teachingLanguages: ['Chinese'],
    durationMonths: 48,
    durationMonthsMax: null,
    languageRequirements: doctorateRequirements,
  },
  {
    id: 'program-guangdong-university-of-foreign-studies-iclt-one-semester-language',
    name: localized('International Chinese Language Teachers Scholarship One-Semester Study', '国际中文教师奖学金一学期研修', 'Семестровая программа Международной стипендии преподавателей китайского языка', 'Internationales Chinesischlehrkräfte-Stipendium — einsemestriges Studium', 'Bourse internationale des enseignants de chinois — séjour d’un semestre', 'Beca Internacional para Profesores de Chino — estudios de un semestre'),
    teachingLanguages: ['Chinese'],
    durationMonths: 5,
    durationMonthsMax: null,
    programUrl: 'https://iie.gdufs.edu.cn/info/1087/1536.htm',
    applyUrl: applicationPortalUrl,
    languageRequirements: icltSemesterRequirements,
    sourceIds: ['src-gdufs-iclt-scholarship'],
    verificationScope: 'facts',
    verifiedAt: checkedAt,
    reviewAfter,
    status: 'verified',
  },
  {
    id: 'program-guangdong-university-of-foreign-studies-chinese-language-semester-language',
    slug: 'guangdong-university-of-foreign-studies-chinese-language-semester-language',
    universityId: 'uni-guangdong-university-of-foreign-studies',
    name: localized('Chinese Language Semester Program', '汉语进修（一学期）', 'Семестровая программа китайского языка', 'Chinesisch-Sprachprogramm (ein Semester)', 'Programme semestriel de langue chinoise', 'Programa semestral de lengua china'),
    degreeLevel: 'language',
    discipline: 'chinese-education',
    teachingLanguages: ['Chinese'],
    durationMonths: 4,
    durationMonthsMax: null,
    programUrl: languageGuideUrl,
    applyUrl: applicationPortalUrl,
    languageRequirements: languageSemesterRequirements,
    sourceIds: ['source-gdufs-2026-autumn-chinese-language-program'],
    verificationScope: 'facts',
    verifiedAt: checkedAt,
    reviewAfter,
    status: 'verified',
  },
  {
    id: 'prog-gap-prog-gdufs-chinese-thai-translation-bachelor',
    ...currentDegreeProgram,
    programUrl: 'https://iie-en.gdufs.edu.cn/info/1132/2191.htm',
    sourceIds: ['src-gap-program-prog-gdufs-chinese-thai-translation-bachelor', 'src-gdufs-2026-degree-admissions'],
    name: localized('Chinese Language (Chinese–Thai Translation)', '汉语言（中泰翻译）', 'Китайский язык (китайско-тайский перевод)', 'Chinesische Sprache (Chinesisch–Thai-Übersetzen)', 'Langue chinoise (traduction chinois-thaï)', 'Lengua china (traducción chino-tailandés)'),
    teachingLanguages: ['Chinese'],
    durationMonths: 48,
    durationMonthsMax: null,
    languageRequirements: chineseBachelorRequirements,
  },
  {
    id: 'prog-gap-prog-gdufs-chinese-business-bachelor',
    ...currentDegreeProgram,
    programUrl: 'https://iie-en.gdufs.edu.cn/info/1132/2191.htm',
    sourceIds: ['src-gap-program-prog-gdufs-chinese-business-bachelor', 'src-gdufs-2026-degree-admissions'],
    name: localized('Chinese Language (Business Chinese)', '汉语言（商务汉语）', 'Китайский язык (деловой китайский)', 'Chinesische Sprache (Wirtschaftschinesisch)', 'Langue chinoise (chinois des affaires)', 'Lengua china (chino de negocios)'),
    teachingLanguages: ['Chinese'],
    durationMonths: 48,
    durationMonthsMax: null,
    languageRequirements: chineseBachelorRequirements,
  },
  {
    id: 'prog-gap-prog-gdufs-chinese-culture-communication-bachelor',
    ...currentDegreeProgram,
    programUrl: 'https://iie-en.gdufs.edu.cn/info/1132/2191.htm',
    sourceIds: ['src-gap-program-prog-gdufs-chinese-culture-communication-bachelor', 'src-gdufs-2026-degree-admissions'],
    name: localized('Chinese Language (Culture and Communication)', '汉语言（文化传播）', 'Китайский язык (культура и коммуникация)', 'Chinesische Sprache (Kultur und Kommunikation)', 'Langue chinoise (culture et communication)', 'Lengua china (cultura y comunicación)'),
    teachingLanguages: ['Chinese'],
    durationMonths: 48,
    durationMonthsMax: null,
    languageRequirements: chineseBachelorRequirements,
  },
  {
    id: 'prog-gap-clw-sw-gdufs-iclt-year',
    name: localized('International Chinese Language Education — One-Academic-Year Study', '国际中文教育一学年研修', 'Годовая программа международного преподавания китайского языка', 'Internationales Chinesisch — Studienprogramm für ein akademisches Jahr', 'Éducation internationale du chinois — programme d’une année universitaire', 'Educación internacional del chino — programa de un año académico'),
  },
  {
    id: 'prog-gap-chinese-degree-gdufs-international-chinese-education-master',
    ...currentDegreeProgram,
    programUrl: 'https://iie.gdufs.edu.cn/info/1099/5488.htm',
    sourceIds: [
      'src-gap-program-chinese-degree-gdufs-international-chinese-education-master',
      'src-gap-program-chinese-degree-gdufs-international-chinese-education-master-support-1',
      'src-gdufs-2026-degree-admissions',
    ],
    name: localized('International Chinese Language Education (MTCOSL)', '国际中文教育硕士（MTCOSL）', 'Международное преподавание китайского языка (MTCOSL)', 'Internationale chinesische Sprachausbildung (MTCOSL)', 'Éducation internationale de la langue chinoise (MTCOSL)', 'Educación internacional de la lengua china (MTCOSL)'),
    teachingLanguages: ['Chinese'],
    durationMonths: 36,
    durationMonthsMax: null,
    languageRequirements: mtcoslRequirements,
  },
  {
    id: 'prog-gap-prog-gdufs-mba-international-2026',
    ...currentDegreeProgram,
    programUrl: 'https://englishmba.gdufs.edu.cn/info/1010/3448.htm',
    sourceIds: ['src-gap-program-prog-gdufs-mba-international-2026', 'src-gdufs-2026-degree-admissions'],
    name: localized('MBA Program for International Students', '国际学生MBA项目', 'Программа MBA для иностранных студентов', 'MBA-Programm für internationale Studierende', 'MBA pour étudiants internationaux', 'MBA para estudiantes internacionales'),
    teachingLanguages: ['English'],
    durationMonths: 24,
    durationMonthsMax: 36,
    languageRequirements: mbaRequirements,
  },
]

const degreeProgramIds = [
  'program-guangdong-university-of-foreign-studies-chinese-language-bachelor',
  'program-guangdong-university-of-foreign-studies-international-business-bachelor',
  'program-guangdong-university-of-foreign-studies-global-economic-governance-doctorate',
  'prog-gap-prog-gdufs-chinese-thai-translation-bachelor',
  'prog-gap-prog-gdufs-chinese-business-bachelor',
  'prog-gap-prog-gdufs-chinese-culture-communication-bachelor',
  'prog-gap-chinese-degree-gdufs-international-chinese-education-master',
  'prog-gap-prog-gdufs-mba-international-2026',
]

const closedDegreeNotes = localized(
  'Verified from the official 2026 guide. Applications ran from 1 March to 20 June 2026 and are closed; no 2027 dates are inferred.',
  '依据2026年官方简章核验。申请期为2026年3月1日至6月20日，现已截止；不推定2027年日期。',
  'Данные подтверждены официальным руководством 2026 года. Приём заявок шёл с 1 марта по 20 июня 2026 года и завершён; даты 2027 года не предполагаются.',
  'Bestätigt durch den offiziellen Leitfaden 2026. Die Bewerbungsfrist vom 1. März bis 20. Juni 2026 ist abgelaufen; Termine für 2027 werden nicht abgeleitet.',
  'Vérifié dans le guide officiel 2026. La période du 1er mars au 20 juin 2026 est close ; aucune date 2027 n’est déduite.',
  'Verificado en la guía oficial de 2026. El plazo del 1 de marzo al 20 de junio de 2026 está cerrado; no se infieren fechas de 2027.',
)

function closedDegreeCycle({ id, programId, tuitionCny, tuitionPeriod = 'academic-year', notes = closedDegreeNotes }) {
  return {
    id,
    programId,
    academicYear: '2026-2027',
    intake: 'autumn',
    opensOn: '2026-03-01',
    closesOn: '2026-06-20',
    dateStatus: 'previous-cycle-reference',
    tuitionCny,
    tuitionPeriod,
    tuitionStatus: 'confirmed',
    evidenceBasis: 'cycle-specific',
    factScope: 'complete',
    applicationFeeCny: 500,
    notes,
    sourceIds: ['src-gdufs-2026-degree-admissions'],
    verifiedAt: checkedAt,
    reviewAfter: checkedAt,
    status: 'stale',
  }
}

const cycleSpecs = [
  {
    id: 'cycle-2027-gdufs-iclt-one-semester-spring',
    programId: 'program-guangdong-university-of-foreign-studies-iclt-one-semester-language',
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
    sourceIds: ['src-gdufs-iclt-scholarship'],
    verifiedAt: checkedAt,
    reviewAfter: '2026-09-01',
    status: 'verified',
  },
  closedDegreeCycle({
    id: 'cycle-2026-gdufs-chinese-language-bachelor-autumn',
    programId: 'program-guangdong-university-of-foreign-studies-chinese-language-bachelor',
    tuitionCny: 20000,
  }),
  closedDegreeCycle({
    id: 'cycle-2026-gdufs-international-business-bachelor-autumn',
    programId: 'program-guangdong-university-of-foreign-studies-international-business-bachelor',
    tuitionCny: 33800,
  }),
  closedDegreeCycle({
    id: 'cycle-2026-gdufs-global-economic-governance-doctorate-autumn',
    programId: 'program-guangdong-university-of-foreign-studies-global-economic-governance-doctorate',
    tuitionCny: 30000,
  }),
  {
    id: 'cycle-2026-gdufs-chinese-language-semester-autumn',
    programId: 'program-guangdong-university-of-foreign-studies-chinese-language-semester-language',
    academicYear: '2026-2027',
    intake: 'autumn',
    opensOn: '2026-03-23',
    closesOn: '2026-06-30',
    dateStatus: 'previous-cycle-reference',
    tuitionCny: 8600,
    tuitionPeriod: 'semester',
    tuitionStatus: 'confirmed',
    evidenceBasis: 'cycle-specific',
    factScope: 'complete',
    applicationFeeCny: 500,
    notes: localized(
      'The official 2026 autumn self-funded route ran from 3 September to 31 December 2026. Its application window is closed; the separate spring 2027 scholarship cycle remains unchanged.',
      '官网公布的2026年秋季自费项目学习期为2026年9月3日至12月31日，申请现已截止；另有的2027春季奖学金周期保持不变。',
      'Официальная осенняя платная программа 2026 года проходила с 3 сентября по 31 декабря 2026 года. Приём закрыт; отдельный стипендиальный цикл весны 2027 года сохранён.',
      'Das offizielle selbstfinanzierte Herbstprogramm 2026 lief vom 3. September bis 31. Dezember 2026. Die Bewerbung ist geschlossen; der separate Stipendienzyklus Frühjahr 2027 bleibt bestehen.',
      'La session autofinancée d’automne 2026 allait du 3 septembre au 31 décembre 2026. Les candidatures sont closes ; le cycle de bourse du printemps 2027 est conservé.',
      'La convocatoria autofinanciada de otoño de 2026 abarcó del 3 de septiembre al 31 de diciembre de 2026. Está cerrada; se mantiene el ciclo de beca de primavera de 2027.',
    ),
    sourceIds: ['source-gdufs-2026-autumn-chinese-language-program'],
    verifiedAt: checkedAt,
    reviewAfter: checkedAt,
    status: 'stale',
  },
  closedDegreeCycle({
    id: 'cycle-gap-prog-gdufs-chinese-thai-translation-bachelor-2026-2027-other-fee-reference',
    programId: 'prog-gap-prog-gdufs-chinese-thai-translation-bachelor',
    tuitionCny: 20000,
  }),
  closedDegreeCycle({
    id: 'cycle-gap-prog-gdufs-chinese-business-bachelor-2026-2027-other-fee-reference',
    programId: 'prog-gap-prog-gdufs-chinese-business-bachelor',
    tuitionCny: 20000,
  }),
  closedDegreeCycle({
    id: 'cycle-gap-prog-gdufs-chinese-culture-communication-bachelor-2026-2027-other-fee-reference',
    programId: 'prog-gap-prog-gdufs-chinese-culture-communication-bachelor',
    tuitionCny: 20000,
  }),
  closedDegreeCycle({
    id: 'cycle-gap-chinese-degree-gdufs-international-chinese-education-master-2026-2027-autumn',
    programId: 'prog-gap-chinese-degree-gdufs-international-chinese-education-master',
    tuitionCny: 28000,
  }),
  closedDegreeCycle({
    id: 'cycle-gap-prog-gdufs-mba-international-2026-2026-2027-other-fee-reference',
    programId: 'prog-gap-prog-gdufs-mba-international-2026',
    tuitionCny: 108000,
    tuitionPeriod: 'program',
    notes: localized(
      'The official fee table lists CNY 54,000/year for the two-year full-time MBA and CNY 36,000/year for the three-year part-time MBA; both equal CNY 108,000 total tuition. This combined identity therefore stores the program total to avoid overstating the three-year route.',
      '官方学费表列明：2年全日制MBA每年54,000元，3年非全日制MBA每年36,000元，两者总学费均为108,000元。该合并身份因此记录项目总价，避免把三年路线误算为162,000元。',
      'Официальная таблица указывает 54 000 юаней в год для двухлетней очной MBA и 36 000 в год для трёхлетней заочной MBA; общая стоимость обеих программ — 108 000 юаней.',
      'Die offizielle Tabelle nennt 54.000 CNY/Jahr für das zweijährige Vollzeit-MBA und 36.000 CNY/Jahr für das dreijährige Teilzeit-MBA; beide ergeben insgesamt 108.000 CNY.',
      'Le tableau officiel indique 54 000 CNY/an pour le MBA à temps plein de deux ans et 36 000 CNY/an pour le MBA à temps partiel de trois ans, soit 108 000 CNY au total dans les deux cas.',
      'La tabla oficial indica 54.000 CNY/año para el MBA de dos años a tiempo completo y 36.000 CNY/año para el MBA de tres años a tiempo parcial; ambos suman 108.000 CNY.',
    ),
  }),
]

const scholarshipSpecs = [
  {
    id: 'scholarship-gdufs-international-student',
    name: localized('GDUFS International Student Scholarship', '广外来华留学生奖学金', 'Стипендия GDUFS для иностранных студентов', 'GDUFS-Stipendium für internationale Studierende', 'Bourse GDUFS pour étudiants internationaux', 'Beca GDUFS para estudiantes internacionales'),
    providerType: 'university',
    universityIds: ['uni-guangdong-university-of-foreign-studies'],
    programIds: degreeProgramIds,
    coverage: {
      tuition: 'partial',
      accommodation: 'unknown',
      insurance: 'unknown',
      stipendCnyPerMonth: null,
    },
    deadline: '2026-07-05',
    applicationUrl: universityScholarshipUrl,
    summary: localized(
      'For 2026, selected new degree students could receive full or 50% first-year tuition, and eligible continuing degree students could receive full or 50% next-year tuition. The official page also covers Chinese-language students enrolled for at least one academic year. This catalog currently links only the audited degree-program identities; a language-program link is withheld until an eligible identity is safely mapped. The published deadline has passed.',
      '2026年，获选学历新生可获第一学年全额或50%学费资助，符合条件的在读学历生可获下一学年全额或50%学费资助。官网还覆盖学习期限不少于一学年的汉语生。当前目录仅关联已审计的学历项目身份；在安全映射符合条件的语言项目身份前，暂不建立语言项目关联。官网截止日现已过期。',
      'В 2026 году отобранные новые студенты программ с присуждением степени могли получить 100% или 50% платы за первый год, а подходящие продолжающие студенты — за следующий год. Официальная страница также охватывает слушателей китайского языка со сроком обучения не менее одного учебного года. Сейчас каталог связывает только проверенные degree-программы; связь с языковой программой отложена до безопасного сопоставления. Срок уже прошёл.',
      '2026 konnten ausgewählte neue Degree-Studierende 100 % oder 50 % der Studiengebühren des ersten Jahres und berechtigte fortgeschrittene Studierende entsprechend für das Folgejahr erhalten. Die offizielle Seite umfasst auch Chinesischlernende mit einer Studiendauer von mindestens einem akademischen Jahr. Der Katalog verknüpft derzeit nur geprüfte Degree-Programme; die Sprachprogramm-Zuordnung bleibt bis zu einer sicheren Identitätszuordnung zurückgestellt. Die Frist ist abgelaufen.',
      'En 2026, les nouveaux étudiants diplômants sélectionnés pouvaient obtenir 100 % ou 50 % des frais de première année et les étudiants admissibles en cours ceux de l’année suivante. La page officielle couvre aussi les étudiants de chinois inscrits pour au moins une année universitaire. Le catalogue ne relie actuellement que les programmes diplômants audités ; le lien avec un programme de langue est différé jusqu’à une correspondance sûre. La date limite est passée.',
      'En 2026, los nuevos estudiantes de titulación seleccionados podían recibir el 100 % o el 50 % de la matrícula del primer año y los estudiantes elegibles ya inscritos la del año siguiente. La página oficial también cubre a estudiantes de chino matriculados durante al menos un año académico. El catálogo solo vincula por ahora las identidades de titulación auditadas; la relación con un programa de idioma se retiene hasta lograr una correspondencia segura. El plazo ha vencido.',
    ),
    sourceIds: ['source-gdufs-2026-university-scholarship'],
    verifiedAt: checkedAt,
    reviewAfter: checkedAt,
    status: 'stale',
  },
  {
    id: 'scholarship-gdufs-guangdong-government',
    name: localized('Guangdong Government Outstanding International Student Scholarship at GDUFS', '广东外语外贸大学广东省政府来粤留学生奖学金', 'Стипендия правительства Гуандуна для иностранных студентов в GDUFS', 'Guangdong-Regierungsstipendium für internationale Studierende an der GDUFS', 'Bourse du gouvernement du Guangdong à la GDUFS', 'Beca del Gobierno de Guangdong en GDUFS'),
    providerType: 'province',
    universityIds: ['uni-guangdong-university-of-foreign-studies'],
    programIds: degreeProgramIds,
    coverage: {
      tuition: 'unknown',
      accommodation: 'unknown',
      insurance: 'unknown',
      stipendCnyPerMonth: null,
    },
    deadline: null,
    applicationUrl: null,
    summary: localized(
      'The official 2026 GDUFS guide lists one-time awards of CNY 10,000 for bachelor, CNY 20,000 for master and CNY 30,000 for doctorate students. It does not publish a current application deadline on the verified page.',
      '广外2026年官方简章列明一次性资助：本科1万元、硕士2万元、博士3万元；已核验页面未公布当期申请截止日。',
      'Официальное руководство GDUFS 2026 года указывает единовременные выплаты: 10 000 юаней для бакалавров, 20 000 для магистров и 30 000 для докторантов. Текущий срок на проверенной странице не опубликован.',
      'Der offizielle GDUFS-Leitfaden 2026 nennt einmalige Beträge von 10.000 CNY für Bachelor-, 20.000 CNY für Master- und 30.000 CNY für Promotionsstudierende. Eine aktuelle Frist ist dort nicht veröffentlicht.',
      'Le guide officiel GDUFS 2026 indique des aides uniques de 10 000 CNY en licence, 20 000 CNY en master et 30 000 CNY en doctorat. La page vérifiée ne publie pas de date limite actuelle.',
      'La guía oficial de GDUFS de 2026 indica ayudas únicas de 10.000 CNY para grado, 20.000 CNY para máster y 30.000 CNY para doctorado. La página verificada no publica un plazo actual.',
    ),
    sourceIds: ['src-gdufs-2026-degree-admissions'],
    verifiedAt: checkedAt,
    reviewAfter,
    status: 'verified',
  },
  {
    id: 'scholarship-gdufs-iclt-one-semester-2027',
    name: localized(
      'International Chinese Language Teachers Scholarship at GDUFS (Spring 2027)',
      '广外国际中文教师奖学金（2027春）',
      'Международная стипендия преподавателей китайского языка в GDUFS (весна 2027)',
      'Internationales Stipendium für Chinesischlehrkräfte an der GDUFS (Frühjahr 2027)',
      'Bourse internationale pour enseignants de chinois à la GDUFS (printemps 2027)',
      'Beca Internacional para Profesores de Chino en GDUFS (primavera de 2027)',
    ),
    providerType: 'other',
    universityIds: ['uni-guangdong-university-of-foreign-studies'],
    programIds: ['program-guangdong-university-of-foreign-studies-iclt-one-semester-language'],
    coverage: {
      tuition: 'full',
      accommodation: 'full',
      insurance: true,
      stipendCnyPerMonth: 2500,
    },
    deadline: '2026-10-31',
    applicationUrl: 'https://www.chinese.cn/page/#/pcpage/project_detail',
    summary: localized(
      'The five-month spring 2027 route requires applications through both the scholarship platform and GDUFS, plus a recommendation from an eligible institution.',
      '2027年春季五个月项目须同时通过奖学金平台和广外系统申请，并取得具备资格机构的推荐。',
      'Для пятимесячной программы весны 2027 года требуется подача через платформу стипендии и систему GDUFS, а также рекомендация уполномоченной организации.',
      'Für das fünfmonatige Programm im Frühjahr 2027 sind Bewerbungen über die Stipendienplattform und die GDUFS sowie eine Empfehlung einer berechtigten Institution erforderlich.',
      'Le programme de cinq mois du printemps 2027 exige une candidature sur la plateforme de bourse et auprès de la GDUFS, ainsi qu’une recommandation d’un établissement habilité.',
      'El programa de cinco meses de primavera de 2027 exige solicitudes mediante la plataforma de becas y GDUFS, además de la recomendación de una institución habilitada.',
    ),
    sourceIds: ['src-gdufs-iclt-scholarship'],
    verifiedAt: checkedAt,
    reviewAfter: icltReviewAfter,
    status: 'verified',
  },
]
let sources = read('sources.json')
const programs = read('programs.json')
let admissionCycles = read('admission-cycles.json')
const scholarships = read('scholarships.json')

// Remove only the duplicate source ID introduced by the first revision of this importer.
// The existing normalized admissions source remains canonical for the 2026 guide URL.
sources = sources.filter((source) => source.id !== 'source-gdufs-2026-degree-programs')
for (const source of sourceSpecs) upsertById(sources, source)

for (const spec of programSpecs) {
  const existing = programs.find((program) => program.id === spec.id)
  const isNewSelfFundedIdentity = spec.id === 'program-guangdong-university-of-foreign-studies-chinese-language-semester-language'
  if (!existing && !isNewSelfFundedIdentity) {
    throw new Error(`Expected GDUFS program is missing: ${spec.id}`)
  }
  upsertById(programs, spec, Boolean(existing))
}

// These three records projected current facts into unannounced 2027 cycles. Replace
// them with exact, closed 2026 evidence instead of preserving speculative dates.
const unsupportedProjectedCycleIds = new Set([
  'cycle-2027-gdufs-chinese-language-bachelor-spring',
  'cycle-2027-gdufs-international-business-autumn',
  'cycle-2027-gdufs-global-economic-governance-autumn',
])
admissionCycles = admissionCycles.filter((cycle) => !unsupportedProjectedCycleIds.has(cycle.id))
for (const cycle of cycleSpecs) upsertById(admissionCycles, cycle)

for (const spec of scholarshipSpecs) {
  const existing = scholarships.find((scholarship) => scholarship.id === spec.id)
  if (!existing) throw new Error(`Expected GDUFS scholarship is missing: ${spec.id}`)
  upsertById(scholarships, spec, true)
}

write('sources.json', sources)
write('programs.json', programs)
write('admission-cycles.json', admissionCycles)
write('scholarships.json', scholarships)

console.log(JSON.stringify({
  checkedAt,
  sourcesUpserted: sourceSpecs.length,
  programsUpdated: programSpecs.length,
  cyclesUpserted: cycleSpecs.length,
  unsupportedProjectedCyclesRemoved: unsupportedProjectedCycleIds.size,
  scholarshipsUpdated: scholarshipSpecs.length,
}, null, 2))
