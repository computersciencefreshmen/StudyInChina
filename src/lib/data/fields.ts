import type { Locale } from '@/i18n/config'
import { localize } from './format'
import type { LocalizedText, Program } from './types'

const PROGRAM_FIELD_KEYS = [
  'chinese-language',
  'computing-data',
  'engineering-technology',
  'architecture-built-environment',
  'natural-sciences',
  'environment-earth',
  'agriculture-veterinary',
  'medicine-health',
  'business-economics',
  'law-public-policy',
  'social-sciences',
  'education',
  'humanities-languages',
  'media-communication',
  'arts-design',
  'sport-services',
  'interdisciplinary',
] as const

export type ProgramField = (typeof PROGRAM_FIELD_KEYS)[number]

type FieldDefinition = {
  key: ProgramField
  label: LocalizedText
  description: LocalizedText
}

const text = (
  en: string,
  zh: string,
  ru: string,
  de: string,
  fr: string,
  es: string,
): LocalizedText => ({ en, zh, ru, de, fr, es })

/**
 * Applicant-facing navigation taxonomy inspired by the broad fields in
 * ISCED-F 2013. It is intentionally separate from source-backed program facts:
 * classification improves discovery but never overwrites a university's title
 * or the canonical discipline stored in the catalogue.
 */
const FIELD_DEFINITIONS: readonly FieldDefinition[] = [
  {
    key: 'chinese-language',
    label: text('Chinese language & culture', '汉语与中国文化', 'Китайский язык и культура', 'Chinesische Sprache & Kultur', 'Langue et culture chinoises', 'Lengua y cultura chinas'),
    description: text('Language study, Chinese language education and cultural immersion.', '汉语进修、国际中文教育与中国文化学习。', 'Языковые курсы, преподавание китайского и культурное погружение.', 'Sprachkurse, Chinesischdidaktik und Kulturstudien.', 'Cours de langue, didactique du chinois et immersion culturelle.', 'Cursos de idioma, enseñanza del chino e inmersión cultural.'),
  },
  {
    key: 'computing-data',
    label: text('Computing, AI & data', '计算机、人工智能与数据', 'ИТ, ИИ и данные', 'Informatik, KI & Daten', 'Informatique, IA et données', 'Informática, IA y datos'),
    description: text('Computer science, software, artificial intelligence, data and cybersecurity.', '计算机科学、软件、人工智能、数据与网络安全。', 'Информатика, ПО, искусственный интеллект, данные и кибербезопасность.', 'Informatik, Software, künstliche Intelligenz, Daten und Cybersicherheit.', 'Informatique, logiciels, intelligence artificielle, données et cybersécurité.', 'Informática, software, inteligencia artificial, datos y ciberseguridad.'),
  },
  {
    key: 'engineering-technology',
    label: text('Engineering & technology', '工程与技术', 'Инженерия и технологии', 'Ingenieurwesen & Technologie', 'Ingénierie et technologie', 'Ingeniería y tecnología'),
    description: text('Mechanical, electrical, civil, chemical, materials, energy and related engineering.', '机械、电气、土木、化工、材料、能源及相关工程。', 'Механическая, электрическая, строительная, химическая и энергетическая инженерия.', 'Maschinenbau, Elektrotechnik, Bauwesen, Chemie-, Werkstoff- und Energietechnik.', 'Génie mécanique, électrique, civil, chimique, des matériaux et de l’énergie.', 'Ingeniería mecánica, eléctrica, civil, química, de materiales y energética.'),
  },
  {
    key: 'architecture-built-environment',
    label: text('Architecture & built environment', '建筑与建成环境', 'Архитектура и городская среда', 'Architektur & gebaute Umwelt', 'Architecture et cadre bâti', 'Arquitectura y entorno construido'),
    description: text('Architecture, urban planning, landscape and the design of places.', '建筑、城乡规划、景观与空间设计。', 'Архитектура, градостроительство, ландшафт и проектирование пространств.', 'Architektur, Stadtplanung, Landschaft und Raumgestaltung.', 'Architecture, urbanisme, paysage et conception des espaces.', 'Arquitectura, urbanismo, paisaje y diseño de espacios.'),
  },
  {
    key: 'natural-sciences',
    label: text('Natural sciences & mathematics', '自然科学与数学', 'Естественные науки и математика', 'Naturwissenschaften & Mathematik', 'Sciences naturelles et mathématiques', 'Ciencias naturales y matemáticas'),
    description: text('Mathematics, statistics, physics, chemistry and fundamental life sciences.', '数学、统计、物理、化学与基础生命科学。', 'Математика, статистика, физика, химия и фундаментальные науки о жизни.', 'Mathematik, Statistik, Physik, Chemie und grundlegende Lebenswissenschaften.', 'Mathématiques, statistiques, physique, chimie et sciences fondamentales du vivant.', 'Matemáticas, estadística, física, química y ciencias básicas de la vida.'),
  },
  {
    key: 'environment-earth',
    label: text('Environment & earth sciences', '环境与地球科学', 'Экология и науки о Земле', 'Umwelt- & Geowissenschaften', 'Environnement et sciences de la Terre', 'Medio ambiente y ciencias de la Tierra'),
    description: text('Environment, ecology, geology, geography, oceans, climate and resources.', '环境、生态、地质、地理、海洋、气候与资源。', 'Экология, геология, география, океанология, климат и ресурсы.', 'Umwelt, Ökologie, Geologie, Geografie, Ozeane, Klima und Ressourcen.', 'Environnement, écologie, géologie, géographie, océans, climat et ressources.', 'Medio ambiente, ecología, geología, geografía, océanos, clima y recursos.'),
  },
  {
    key: 'agriculture-veterinary',
    label: text('Agriculture, food & veterinary', '农业、食品与兽医', 'Сельское хозяйство, пищевые науки и ветеринария', 'Agrar-, Lebensmittel- & Veterinärwissenschaften', 'Agriculture, alimentation et sciences vétérinaires', 'Agricultura, alimentación y veterinaria'),
    description: text('Agriculture, forestry, food science, animal science and veterinary medicine.', '农学、林学、食品科学、动物科学与兽医学。', 'Сельское и лесное хозяйство, пищевые науки, животноводство и ветеринария.', 'Land- und Forstwirtschaft, Lebensmittel-, Tier- und Veterinärwissenschaften.', 'Agriculture, foresterie, sciences alimentaires, animales et vétérinaires.', 'Agricultura, silvicultura, ciencia de alimentos, animales y veterinaria.'),
  },
  {
    key: 'medicine-health',
    label: text('Medicine & health', '医学与健康', 'Медицина и здоровье', 'Medizin & Gesundheit', 'Médecine et santé', 'Medicina y salud'),
    description: text('Clinical medicine, dentistry, nursing, pharmacy, public health and biomedical care.', '临床医学、口腔、护理、药学、公共卫生与生物医学健康。', 'Клиническая медицина, стоматология, сестринское дело, фармация и общественное здоровье.', 'Klinische Medizin, Zahnmedizin, Pflege, Pharmazie und öffentliche Gesundheit.', 'Médecine clinique, odontologie, soins infirmiers, pharmacie et santé publique.', 'Medicina clínica, odontología, enfermería, farmacia y salud pública.'),
  },
  {
    key: 'business-economics',
    label: text('Business, economics & management', '商业、经济与管理', 'Бизнес, экономика и управление', 'Wirtschaft, Ökonomie & Management', 'Commerce, économie et gestion', 'Negocios, economía y gestión'),
    description: text('Economics, finance, accounting, trade, marketing, logistics and management.', '经济、金融、会计、贸易、市场营销、物流与管理。', 'Экономика, финансы, учёт, торговля, маркетинг, логистика и менеджмент.', 'Ökonomie, Finanzen, Rechnungswesen, Handel, Marketing, Logistik und Management.', 'Économie, finance, comptabilité, commerce, marketing, logistique et gestion.', 'Economía, finanzas, contabilidad, comercio, marketing, logística y gestión.'),
  },
  {
    key: 'law-public-policy',
    label: text('Law, government & public policy', '法律、政府与公共政策', 'Право, управление и публичная политика', 'Recht, Verwaltung & Politik', 'Droit, administration et politiques publiques', 'Derecho, gobierno y políticas públicas'),
    description: text('Law, governance, public administration, international relations and security.', '法律、治理、公共管理、国际关系与安全研究。', 'Право, государственное управление, международные отношения и безопасность.', 'Recht, Governance, öffentliche Verwaltung, internationale Beziehungen und Sicherheit.', 'Droit, gouvernance, administration publique, relations internationales et sécurité.', 'Derecho, gobernanza, administración pública, relaciones internacionales y seguridad.'),
  },
  {
    key: 'social-sciences',
    label: text('Social & behavioural sciences', '社会与行为科学', 'Социальные и поведенческие науки', 'Sozial- & Verhaltenswissenschaften', 'Sciences sociales et comportementales', 'Ciencias sociales y del comportamiento'),
    description: text('Sociology, psychology, anthropology, demography and social work.', '社会学、心理学、人类学、人口学与社会工作。', 'Социология, психология, антропология, демография и социальная работа.', 'Soziologie, Psychologie, Anthropologie, Demografie und Sozialarbeit.', 'Sociologie, psychologie, anthropologie, démographie et travail social.', 'Sociología, psicología, antropología, demografía y trabajo social.'),
  },
  {
    key: 'education',
    label: text('Education & teacher training', '教育与教师培养', 'Образование и подготовка преподавателей', 'Bildung & Lehrkräfteausbildung', 'Éducation et formation des enseignants', 'Educación y formación docente'),
    description: text('Education studies, curriculum, pedagogy, educational technology and teacher training.', '教育学、课程、教学法、教育技术与教师培养。', 'Педагогика, учебные программы, образовательные технологии и подготовка учителей.', 'Pädagogik, Curriculum, Bildungstechnologie und Lehrkräfteausbildung.', 'Sciences de l’éducation, programmes, pédagogie, technologies éducatives et formation des enseignants.', 'Ciencias de la educación, currículo, pedagogía, tecnología educativa y formación docente.'),
  },
  {
    key: 'humanities-languages',
    label: text('Humanities & languages', '人文与语言', 'Гуманитарные науки и языки', 'Geisteswissenschaften & Sprachen', 'Sciences humaines et langues', 'Humanidades e idiomas'),
    description: text('Literature, languages, linguistics, history, philosophy, religion and heritage.', '文学、语言、语言学、历史、哲学、宗教与文化遗产。', 'Литература, языки, лингвистика, история, философия, религия и наследие.', 'Literatur, Sprachen, Linguistik, Geschichte, Philosophie, Religion und Kulturerbe.', 'Littérature, langues, linguistique, histoire, philosophie, religion et patrimoine.', 'Literatura, idiomas, lingüística, historia, filosofía, religión y patrimonio.'),
  },
  {
    key: 'media-communication',
    label: text('Media, journalism & communication', '媒体、新闻与传播', 'Медиа, журналистика и коммуникации', 'Medien, Journalismus & Kommunikation', 'Médias, journalisme et communication', 'Medios, periodismo y comunicación'),
    description: text('Journalism, publishing, media, communication and information studies.', '新闻、出版、媒体、传播与信息研究。', 'Журналистика, издательское дело, медиа, коммуникации и информационные исследования.', 'Journalismus, Verlagswesen, Medien, Kommunikation und Informationswissenschaft.', 'Journalisme, édition, médias, communication et sciences de l’information.', 'Periodismo, edición, medios, comunicación y ciencias de la información.'),
  },
  {
    key: 'arts-design',
    label: text('Arts, design & performance', '艺术、设计与表演', 'Искусство, дизайн и сценические практики', 'Kunst, Design & Performance', 'Arts, design et spectacle', 'Artes, diseño y creación escénica'),
    description: text('Fine arts, design, music, film, theatre, dance and performance.', '美术、设计、音乐、电影、戏剧、舞蹈与表演。', 'Изобразительное искусство, дизайн, музыка, кино, театр, танец и перформанс.', 'Bildende Kunst, Design, Musik, Film, Theater, Tanz und Performance.', 'Beaux-arts, design, musique, cinéma, théâtre, danse et spectacle.', 'Bellas artes, diseño, música, cine, teatro, danza y creación escénica.'),
  },
  {
    key: 'sport-services',
    label: text('Sport, tourism & services', '体育、旅游与服务', 'Спорт, туризм и сервис', 'Sport, Tourismus & Dienstleistungen', 'Sport, tourisme et services', 'Deporte, turismo y servicios'),
    description: text('Sport science, physical education, tourism, hospitality and service industries.', '体育科学、体育教育、旅游、酒店与服务业。', 'Спортивные науки, физическое воспитание, туризм, гостеприимство и сервис.', 'Sportwissenschaft, Sportpädagogik, Tourismus, Gastgewerbe und Dienstleistungen.', 'Sciences du sport, éducation physique, tourisme, hôtellerie et services.', 'Ciencias del deporte, educación física, turismo, hostelería y servicios.'),
  },
  {
    key: 'interdisciplinary',
    label: text('Interdisciplinary & emerging fields', '交叉与新兴领域', 'Междисциплинарные и новые направления', 'Interdisziplinäre & neue Felder', 'Domaines interdisciplinaires et émergents', 'Campos interdisciplinarios y emergentes'),
    description: text('Cross-disciplinary programs and titles that require further subject-level review.', '跨学科项目，以及仍需进一步细分核对的项目名称。', 'Междисциплинарные программы и направления, требующие дополнительной предметной проверки.', 'Interdisziplinäre Programme und Titel, die noch fachlich geprüft werden.', 'Programmes transdisciplinaires et intitulés nécessitant une vérification thématique.', 'Programas interdisciplinarios y títulos que requieren una revisión temática adicional.'),
  },
] as const

const LEGACY_DISCIPLINE_FIELDS: Record<Program['discipline'], ProgramField> = {
  engineering: 'engineering-technology',
  business: 'business-economics',
  medicine: 'medicine-health',
  'chinese-education': 'education',
  humanities: 'humanities-languages',
  'law-ir': 'law-public-policy',
  science: 'natural-sciences',
  'art-design': 'arts-design',
  other: 'interdisciplinary',
}

const CHINESE_LANGUAGE_PATTERNS: readonly RegExp[] = [
  /\bchinese language\b|\bmandarin\b|\binternational chinese (?:language )?education\b|\binternational education of chinese language\b|\bteaching chinese to speakers of other languages\b|\b(?:mtcsol|tcsol)\b|\bchinese (?:linguistics?|literature|culture|studies|philology)\b/i,
  /国际中文教育|汉语国际教育|对外汉语|汉语言(?:文学)?|汉语(?:进修|课程)|中文(?:进修|课程)|中国语言(?:文学)?|中国文化/i,
  /китайск(?:ий|ого|ому|им|ом|ая|ой|ую|ое|ие|их)\s+(?:язык|языка|языку|языком|языке|литератур\w*|филолог\w*|культур\w*)|китаеведен\w*|преподаван\w*\s+китайск\w*/i,
]

const RULES: ReadonlyArray<{ field: ProgramField; patterns: readonly RegExp[] }> = [
  { field: 'chinese-language', patterns: CHINESE_LANGUAGE_PATTERNS },
  { field: 'computing-data', patterns: [/\bcomputer\b|\bcomputing\b|\bsoftware\b|\bdata science\b|\bartificial intelligence\b|\bmachine learning\b|\bcyber(?:security|space)?\b|\binformatics\b|\binformation technology\b|计算机|软件|数据科学|人工智能|网络空间|信息技术/i] },
  { field: 'agriculture-veterinary', patterns: [/\bagricultur|\bagronom|\bforestry\b|\bforest\b|\bveterinar|\banimal science\b|\bcrop\b|\bhorticultur|\bplant protection\b|\bplant patholog|\bsoil science\b|\bfood science\b|\bfood safety\b|\bfisher|\baquaculture\b|\btea science\b|农业|农学|作物|园艺|林学|森林|兽医|动物科学|水产|食品科学|植物保护|土壤学|茶学/i] },
  { field: 'medicine-health', patterns: [/\bmedicine\b|\bmedical\b|\bclinical\b|\bsurgery\b|\bnursing\b|\bhealth\b|\bdent(?:al|istry)\b|\bstomatolog|\bpharmac|\bepidemiolog|\bimmunolog|\bpatholog|\bophthalm|\bpsychiatr|\bpaediatr|\bpediatr|\bgynecol|\bobstetric|\boncolog|\bcardiolog|\bneurolog|\bdermatolog|\bradiolog|\brehabilitation\b|医学|临床|口腔|护理|药学|公共卫生|免疫|病理|外科|内科|妇产|儿科|肿瘤|康复/i] },
  { field: 'architecture-built-environment', patterns: [/\barchitecture\b|\burban (?:and rural )?planning\b|\btown planning\b|\blandscape architecture\b|\bbuilt environment\b|建筑|城乡规划|城市规划|风景园林|景观建筑/i] },
  { field: 'business-economics', patterns: [/\bbusiness\b|\beconom|\bfinance\b|\baccounting\b|\bmanagement\b|\bmarketing\b|\bcommerce\b|\btrade\b|\blogistics\b|\bentrepreneur|\btourism management\b|工商管理|经济|金融|会计|管理|市场营销|国际贸易|物流/i] },
  { field: 'law-public-policy', patterns: [/\blaw\b|\blegal\b|\bjuris|\bgovernance\b|\bpublic policy\b|\bpublic administration\b|\binternational relations\b|\bdiplomacy\b|\bpolitic|\bstate security\b|\bmarxism\b|\bsocial security\b|法律|法学|公共政策|公共管理|行政管理|国际关系|外交|政治|国家安全|马克思主义/i] },
  { field: 'education', patterns: [/\beducation\b|\bpedagog|\bcurriculum\b|\binstruction\b|\bteacher\b|\bteaching\b|\beducational technology\b|教育|课程与教学|教师|教学法|教育技术| педагог/i] },
  { field: 'media-communication', patterns: [/\bjournalis|\bpublishing\b|\bmedia\b|\bcommunication studies\b|\bjournalism and communication\b|\binformation studies\b|新闻|出版|媒体|传播学|新闻与传播|信息资源管理/i] },
  { field: 'arts-design', patterns: [/\bdesign\b|\bfine art|\bart theory\b|\barts?\b|\bmusic\b|\bfilm\b|\bcinema\b|\btheatre\b|\btheater\b|\bdance\b|\bperformance\b|艺术|设计|美术|音乐|电影|戏剧|舞蹈|表演/i] },
  { field: 'sport-services', patterns: [/\bsport\b|\bphysical education\b|\bhuman movement\b|\btourism\b|\bhospitality\b|\bleisure studies\b|体育|运动|旅游|酒店|休闲/i] },
  { field: 'environment-earth', patterns: [/\benvironment|\becolog|\bgeolog|\bgeograph|\bgeophys|\boceanograph|\batmospher|\bclimat|\bearth science\b|\bwater resource\b|\bresource exploration\b|\bcarbon neutral|\bmineralog|\bpetrolog|\bsoil and water\b|环境|生态|地质|地理|地球|海洋|大气|气候|水资源|资源勘查|碳中和|矿物/i] },
  { field: 'engineering-technology', patterns: [/\bengineering\b|\bmechanics\b|\bmechanical\b|\belectrical\b|\belectronic\b|\bmaterials?\b|\benergy\b|\bpower\b|\bmanufactur|\bautomation\b|\bcontrol science\b|\baeronaut|\bastronaut|\baerospace\b|\bnuclear science\b|\btransportation\b|\bvehicle\b|\boptical\b|\boptics\b|\binstrument|\bintegrated circuit\b|\bsemiconductor\b|\bpolymer\b|\bchemical technology\b|工程|机械|电气|电子|材料|能源|动力|制造|自动化|控制|航空|航天|核科学|交通运输|车辆|光学|仪器|集成电路|半导体|高分子/i] },
  { field: 'natural-sciences', patterns: [/\bmathemat|\bstatistics?\b|\bprobability\b|\bphysics\b|\bchemistry\b|\bbiolog|\bbiochem|\bbiophys|\bgenetics?\b|\bmicrobiolog|\bastronom|\boperations research\b|数学|统计|概率|物理|化学|生物|遗传|微生物|天文|运筹/i] },
  { field: 'social-sciences', patterns: [/\bsociolog|\bpsycholog|\banthropolog|\bdemograph|\bsocial work\b|\bpopulation studies\b|\bwomen studies\b|\bgender studies\b|\bhuman geography\b|社会学|心理学|人类学|人口学|社会工作|女性研究|性别研究/i] },
  { field: 'humanities-languages', patterns: [/\bliterature\b|\blanguage\b|\blinguist|\bphilolog|\bhistory\b|\bphilosoph|\bethics\b|\blogic\b|\breligio|\bheritage\b|\bmuseolog|\bpaleograph|\baesthetics\b|\btranslation\b|\barea studies\b|文学|语言学|外国语|历史|哲学|伦理|逻辑|宗教|文化遗产|博物馆|古文字|美学|翻译/i] },
]

// Older catalog records only stored one of eight broad disciplines. Refine the
// titles that have an unambiguous applicant-facing field before preserving the
// legacy fallback. The allow-list prevents a generic word in a title from
// overriding a more trustworthy historical discipline.
const LEGACY_DISCIPLINE_REFINEMENTS: Partial<Record<Program['discipline'], readonly ProgramField[]>> = {
  engineering: ['computing-data', 'architecture-built-environment', 'environment-earth', 'agriculture-veterinary'],
  science: ['computing-data', 'agriculture-veterinary', 'medicine-health', 'environment-earth'],
  medicine: ['agriculture-veterinary'],
  business: ['sport-services'],
  humanities: ['education', 'media-communication', 'arts-design', 'sport-services', 'social-sciences'],
}

function matchesFieldRule(rule: (typeof RULES)[number], searchableName: string): boolean {
  return rule.patterns.some((pattern) => pattern.test(searchableName))
}

export function isProgramField(value: string): value is ProgramField {
  return (PROGRAM_FIELD_KEYS as readonly string[]).includes(value)
}

export function normalizeProgramField(value: string): ProgramField | null {
  if (isProgramField(value)) return value
  return (LEGACY_DISCIPLINE_FIELDS as Readonly<Record<string, ProgramField>>)[value]
    ?? null
}

export function programFieldTaxonomy(locale: Locale) {
  return FIELD_DEFINITIONS.map((field) => ({
    key: field.key,
    label: localize(field.label, locale),
    description: localize(field.description, locale),
  }))
}

export function programFieldLabel(field: ProgramField, locale: Locale): string {
  const definition = FIELD_DEFINITIONS.find((item) => item.key === field)
  return definition ? localize(definition.label, locale) : field
}

const CHINESE_LANGUAGE_SEARCH_KEYWORDS = [
  'Chinese language and culture',
  'Chinese Language and Literature',
  'International Chinese Language Education',
  'International Chinese Education',
  'Teaching Chinese to Speakers of Other Languages',
  'MTCSOL',
  'TCSOL',
  '汉语与中国文化',
  '汉语言',
  '汉语言文学',
  '国际中文教育',
  '汉语国际教育',
  '对外汉语',
  'Китайский язык и культура',
  'Китайский язык и литература',
  'Международное преподавание китайского языка',
] as const

function programNameForClassification(program: Program): string {
  return Object.values(program.name)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .normalize('NFKC')
}

export function classifyProgramField(program: Program): ProgramField {
  if (program.degreeLevel === 'language') return 'chinese-language'

  const searchableName = programNameForClassification(program)

  // Explicit Chinese-study titles outrank a broad legacy business/humanities
  // tag. The pattern deliberately excludes a standalone "Chinese" adjective,
  // so Chinese-English Computer Science remains a computing program.
  if (CHINESE_LANGUAGE_PATTERNS.some((pattern) => pattern.test(searchableName))) return 'chinese-language'

  // `chinese-education` historically combined language degrees, teacher-training
  // degrees, foundation study and a few incorrectly tagged records. Resolve its
  // clear multilingual titles before falling back to the legacy education field.
  if (program.discipline === 'chinese-education') {
    for (const rule of RULES) {
      if (rule.patterns.some((pattern) => pattern.test(searchableName))) return rule.field
    }
    return LEGACY_DISCIPLINE_FIELDS[program.discipline]
  }

  const eligibleRefinements = LEGACY_DISCIPLINE_REFINEMENTS[program.discipline] ?? []
  for (const rule of RULES) {
    if (
      eligibleRefinements.includes(rule.field)
      && matchesFieldRule(rule, searchableName)
    ) return rule.field
  }

  if (program.discipline !== 'other') return LEGACY_DISCIPLINE_FIELDS[program.discipline]

  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(searchableName))) return rule.field
  }
  return 'interdisciplinary'
}

export function programSearchKeywords(program: Program): readonly string[] {
  return classifyProgramField(program) === 'chinese-language'
    ? CHINESE_LANGUAGE_SEARCH_KEYWORDS
    : []
}
