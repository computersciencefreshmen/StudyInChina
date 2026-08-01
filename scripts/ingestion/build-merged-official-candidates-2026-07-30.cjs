const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const candidateDir = path.join(root, 'quality', 'official-gap-wave-2026-07-30')
const wave7CandidateDir = path.join(root, 'quality', 'official-gap-wave-2026-08-01')
const outputPath = path.join(candidateDir, 'merged-candidates.json')
const checkedAt = '2026-08-01'

const requiredRawFiles = [
  'local-candidates.json',
  'remaining-candidates.json',
  'scholarship-local-candidates.json',
  'confirmed-gap-candidates.json',
  'local-strong-expansion.json',
  'pku-depth-wave.json',
]
const optionalRawFiles = [
  'second-school-breadth-wave.json',
  'breadth-fastpack.json',
  'wave3-east-south.json',
  'wave3-north-west.json',
  'wave3-depth.json',
  'wave4-depth-north-east.json',
  'wave4-depth-south-west.json',
  'wave4-depth-specialist.json',
  'wave4-depth-second-fastpack.json',
  'wave4-depth-medicine-fastpack.json',
  'wave5-depth-beijing.json',
  'wave5-depth-east-south.json',
  'wave5-depth-west.json',
  'wave6-priority-singletons.json',
]
const rawFiles = [
  ...requiredRawFiles,
  ...optionalRawFiles.filter((fileName) => fs.existsSync(path.join(candidateDir, fileName))),
]
const wave7RawFiles = [
  'wave7-north-west.json',
  'wave7-south-east.json',
  'wave7-special-scholarships.json',
].filter((fileName) => fs.existsSync(path.join(wave7CandidateDir, fileName)))
const rawFileEntries = [
  ...rawFiles.map((fileName) => ({
    sourceFile: fileName,
    filePath: path.join(candidateDir, fileName),
  })),
  ...wave7RawFiles.map((fileName) => ({
    sourceFile: '../official-gap-wave-2026-08-01/' + fileName,
    filePath: path.join(wave7CandidateDir, fileName),
  })),
]

const archiveInstitutionSlugs = [
  'peking-union-medical-college',
  'peoples-public-security-university-of-china',
  'shanghaitech-university',
  'jiangsu-normal-university',
  'tianjin-medical-university',
  'china-medical-university',
]

const confirmedIdentityPrograms = [
  {
    candidateId: 'confirmed-zju-chinese-language',
    institutionSlug: 'zhejiang-university',
    name: {
      en: 'Chinese Language Program',
      zh: '汉语进修项目',
      ru: 'Программа китайского языка',
    },
    programType: 'language',
    level: 'language',
    officialUrl: 'https://iczu.zju.edu.cn/iczuen/whinesewwanguagewwrograms/list.htm',
    sourceTitle: 'Zhejiang University Chinese Language Programs',
  },
  {
    candidateId: 'confirmed-hlju-chinese-language',
    institutionSlug: 'heilongjiang-university',
    name: {
      en: 'Chinese Language Program',
      zh: '汉语进修项目',
      ru: 'Программа китайского языка',
    },
    programType: 'language',
    level: 'language',
    officialUrl: 'https://hi.hlju.edu.cn/admissions/kcxm/hyjx.htm',
    sourceTitle: 'Heilongjiang University Chinese Language Program',
  },
  {
    candidateId: 'confirmed-hqu-chinese-language',
    institutionSlug: 'huaqiao-university',
    name: {
      en: 'Chinese Language Program',
      zh: '汉语进修项目',
      ru: 'Программа китайского языка',
    },
    programType: 'language',
    level: 'language',
    officialUrl: 'https://zsc.hqu.edu.cn/info/1079/8792.htm',
    sourceTitle: 'Huaqiao University Chinese Language Program',
  },
  {
    candidateId: 'confirmed-gznu-chinese-language',
    institutionSlug: 'guizhou-normal-university',
    name: {
      en: 'Chinese Language Program',
      zh: '汉语进修项目',
      ru: 'Программа китайского языка',
    },
    programType: 'language',
    level: 'language',
    officialUrl: 'https://sie.gznu.edu.cn/info/1771/89595.htm',
    sourceTitle: 'Guizhou Normal University Chinese Language Program',
  },
  {
    candidateId: 'confirmed-swu-chinese-language-training',
    institutionSlug: 'southwest-university',
    name: {
      en: 'Chinese Language Training Program',
      zh: '汉语培训项目',
      ru: 'Программа обучения китайскому языку',
    },
    programType: 'language',
    level: 'language',
    officialUrl: 'https://admissions.swu.edu.cn/info/1048/1051.htm',
    sourceTitle: 'Southwest University Chinese Language Training Program',
  },
  {
    candidateId: 'confirmed-nxu-chinese-language',
    institutionSlug: 'ningxia-university',
    name: {
      en: 'Chinese Language Program',
      zh: '汉语进修项目',
      ru: 'Программа китайского языка',
    },
    programType: 'language',
    level: 'language',
    officialUrl: 'https://hzjl.nxu.edu.cn/info/1035/1628.htm',
    sourceTitle: 'Ningxia University Chinese Language Program',
  },
  {
    candidateId: 'confirmed-qhu-chinese-language-student',
    institutionSlug: 'qinghai-university',
    name: {
      en: 'Chinese Language Student Program',
      zh: '汉语言生项目',
      ru: 'Программа изучения китайского языка',
    },
    programType: 'language',
    level: 'language',
    officialUrl: 'https://international.qhu.edu.cn/info/1051/1095.htm',
    sourceTitle: 'Qinghai University Chinese Language Student Program',
  },
  {
    candidateId: 'confirmed-shzu-clinical-medicine-mbbs',
    institutionSlug: 'shihezi-university',
    name: {
      en: 'Clinical Medicine (MBBS)',
      zh: '临床医学（MBBS）',
      ru: 'Клиническая медицина (MBBS)',
    },
    programType: 'degree',
    level: 'bachelor',
    officialUrl: 'https://www.shzu.edu.cn/2024/1101/c2a211876/page.htm',
    sourceTitle: 'Shihezi University Clinical Medicine (MBBS)',
  },
  {
    candidateId: 'confirmed-cnu-international-admissions-entry',
    institutionSlug: 'capital-normal-university',
    name: {
      en: 'International Admissions Program Entry',
      zh: '国际学生招生项目入口',
      ru: 'Каталог программ для иностранных студентов',
    },
    programType: 'degree',
    level: 'other',
    officialUrl: 'https://eng.cnu.edu.cn/international/internationaladmission/index.htm',
    sourceTitle: 'Capital Normal University International Admission',
  },
]

const exactRussianNames = new Map(Object.entries({
  'international business': 'Международный бизнес',
  'international law': 'Международное право',
  accounting: 'Бухгалтерский учёт',
  'e-commerce': 'Электронная коммерция',
  'clinical medicine': 'Клиническая медицина',
  'clinical medicine (mbbs)': 'Клиническая медицина (MBBS)',
  stomatology: 'Стоматология',
  pharmacy: 'Фармация',
  finance: 'Финансы',
  'business administration': 'Управление бизнесом',
  'international economics and trade': 'Международная экономика и торговля',
  'international trade': 'Международная торговля',
  'financial management': 'Финансовый менеджмент',
  'tourism management': 'Управление туризмом',
  translation: 'Перевод',
  'chinese language program': 'Программа китайского языка',
  'chinese language training program': 'Программа обучения китайскому языку',
  'chinese language and culture program': 'Программа китайского языка и культуры',
  'chinese language preparatory program': 'Подготовительная программа китайского языка',
  'chinese language student program': 'Программа изучения китайского языка',
  'chinese language and literature': 'Китайский язык и литература',
  'teaching chinese to speakers of other languages': 'Преподавание китайского языка как иностранного',
  'mechanical design, manufacturing and automation': 'Проектирование, производство и автоматизация машин',
  'mechanical design and manufacturing and automation': 'Проектирование, производство и автоматизация машин',
  'computer science and technology': 'Компьютерные науки и технологии',
  'artificial intelligence': 'Искусственный интеллект',
  'software engineering': 'Программная инженерия',
  'food science and engineering': 'Пищевая наука и инженерия',
  'biomedical engineering': 'Биомедицинская инженерия',
  'mechatronic engineering': 'Мехатронная инженерия',
  'materials science and engineering': 'Материаловедение и инженерия',
  'marine navigation': 'Судовождение',
  'transportation management (shipping)': 'Управление морскими перевозками',
  'transportation management': 'Управление транспортом',
  'logistics management': 'Управление логистикой',
  'traffic engineering': 'Транспортная инженерия',
  'digital economy': 'Цифровая экономика',
  'chinese culture': 'Китайская культура',
  'chinese culture and communication': 'Китайская культура и коммуникация',
  'chinese and international trade': 'Китайский язык и международная торговля',
  'chinese business': 'Китайский язык для бизнеса',
  'chinese-thai translation': 'Китайско-тайский перевод',
  'international admissions program entry': 'Каталог программ для иностранных студентов',
  'zhejiang government scholarship': 'Стипендия правительства провинции Чжэцзян',
  'general scholarship': 'Общая университетская стипендия',
  'president freshmen scholarship': 'Стипендия ректора для первокурсников',
  'guangxi government asean scholarship': 'Стипендия правительства Гуанси для стран АСЕАН',
  'guangdong government scholarship': 'Стипендия правительства провинции Гуандун',
  'freshmen aid': 'Финансовая поддержка первокурсников',
  'academic scholarship': 'Академическая стипендия',
  'international chinese language teachers scholarship': 'Международная стипендия преподавателей китайского языка',
  'china link scholarship': 'Стипендия China Link',
  'tianjin government scholarship': 'Стипендия правительства Тяньцзиня',
  'shanghai government scholarship': 'Стипендия правительства Шанхая',
  'chinese government scholarship': 'Стипендия правительства Китая',
  'university scholarship': 'Университетская стипендия',
}).map(([key, value]) => [key.toLowerCase(), value]))

const candidateRussianOverrides = new Map(Object.entries({
  'local-kmmu-medical-advanced-training': 'Повышение квалификации по медицине',
  'local-dlufl-b-chinese-culture': 'Китайский язык и культура',
  'local-ynnu-b-chinese-education-overseas': 'Китайский язык и обучение за рубежом',
  'local-shmtu-b-transport-management-shipping-bilingual': 'Управление транспортом (морские перевозки), двуязычная программа',
  'local-kmmu-freshmen-aid': 'Стипендия помощи первокурсникам Куньминского медицинского университета',
}))

const russianPhraseReplacements = [
  ['International Chinese Language Teachers Scholarship', 'Международная стипендия преподавателей китайского языка'],
  ['Chinese Government Scholarship', 'Стипендия правительства Китая'],
  ['Government Scholarship', 'Правительственная стипендия'],
  ['University Scholarship', 'Университетская стипендия'],
  ['Outstanding International Student', 'выдающихся иностранных студентов'],
  ['International Economics and Trade', 'Международная экономика и торговля'],
  ['Teaching Chinese to Speakers of Other Languages', 'Преподавание китайского языка как иностранного'],
  ['Mechanical Design and Manufacturing and Automation', 'Проектирование, производство и автоматизация машин'],
  ['Mechanical Design, Manufacturing and Automation', 'Проектирование, производство и автоматизация машин'],
  ['Chinese Language and Literature', 'Китайский язык и литература'],
  ['Chinese Language and Culture', 'Китайский язык и культура'],
  ['Chinese Language Preparatory', 'Подготовительный курс китайского языка'],
  ['Chinese Language Training', 'Обучение китайскому языку'],
  ['Chinese Language', 'Китайский язык'],
  ['Clinical Medicine', 'Клиническая медицина'],
  ['International Business', 'Международный бизнес'],
  ['International Law', 'Международное право'],
  ['International Trade', 'Международная торговля'],
  ['Financial Management', 'Финансовый менеджмент'],
  ['Tourism Management', 'Управление туризмом'],
  ['Business Administration', 'Управление бизнесом'],
  ['Computer Science and Technology', 'Компьютерные науки и технологии'],
  ['Artificial Intelligence', 'Искусственный интеллект'],
  ['Software Engineering', 'Программная инженерия'],
  ['Food Science and Engineering', 'Пищевая наука и инженерия'],
  ['Biomedical Engineering', 'Биомедицинская инженерия'],
  ['Materials Science and Engineering', 'Материаловедение и инженерия'],
  ['Logistics Management', 'Управление логистикой'],
  ['Traffic Engineering', 'Транспортная инженерия'],
  ['Digital Economy', 'Цифровая экономика'],
  ['Marine Navigation', 'Судовождение'],
  ['Mechatronic Engineering', 'Мехатронная инженерия'],
  ['Accounting', 'Бухгалтерский учёт'],
  ['Stomatology', 'Стоматология'],
  ['Pharmacy', 'Фармация'],
  ['Finance', 'Финансы'],
  ['Translation', 'Перевод'],
  ['Scholarship', 'Стипендия'],
  ['Program', 'Программа'],
]

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function buildExistingRussianIndex() {
  const index = new Map()
  for (const fileName of ['programs.json', 'scholarships.json']) {
    const filePath = path.join(root, 'content', 'data', fileName)
    if (!fs.existsSync(filePath)) continue
    for (const item of readJson(filePath)) {
      if (!item.name?.ru) continue
      if (item.name.en) index.set(`en:${normalizeText(item.name.en)}`, item.name.ru)
      if (item.name.zh) index.set(`zh:${normalizeText(item.name.zh)}`, item.name.ru)
    }
  }
  return index
}

const translationAudit = {
  raw: 0,
  reusedCatalog: 0,
  exactDictionary: 0,
  phraseDictionary: 0,
  safeFallback: 0,
  fallbackCandidateIds: [],
}

function russianName(rawName, kind, candidateId, existingRussianIndex) {
  if (rawName?.ru?.trim()) {
    translationAudit.raw += 1
    return rawName.ru.trim()
  }
  const candidateOverride = candidateRussianOverrides.get(candidateId)
  if (candidateOverride) {
    translationAudit.exactDictionary += 1
    return candidateOverride
  }
  const existing = existingRussianIndex.get(`en:${normalizeText(rawName?.en)}`)
    ?? existingRussianIndex.get(`zh:${normalizeText(rawName?.zh)}`)
  if (existing) {
    translationAudit.reusedCatalog += 1
    return existing
  }
  const english = String(rawName?.en ?? '').trim()
  const exact = exactRussianNames.get(english.toLowerCase())
  if (exact) {
    translationAudit.exactDictionary += 1
    return exact
  }
  let translated = english
  for (const [source, target] of russianPhraseReplacements) {
    translated = translated.replace(new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), target)
  }
  if (translated !== english && /[\u0400-\u04ff]/.test(translated)) {
    translationAudit.phraseDictionary += 1
    return translated
  }
  translationAudit.safeFallback += 1
  translationAudit.fallbackCandidateIds.push(candidateId)
  return kind === 'scholarship'
    ? `Стипендия «${english}»`
    : `Образовательная программа «${english}»`
}

function localizedName(rawName, kind, candidateId, existingRussianIndex) {
  const en = String(rawName?.en ?? '').trim()
  const zh = String(rawName?.zh ?? '').trim()
  if (!en || !zh) throw new Error(`${candidateId} requires both English and Chinese names`)
  return {
    en,
    zh,
    ru: russianName(rawName, kind, candidateId, existingRussianIndex),
  }
}

function normalizeLevel(candidate) {
  const programType = String(candidate.programType ?? '').toLowerCase()
  const source = String(candidate.level ?? candidate.degreeLevel ?? '').toLowerCase()
  if (programType === 'language' || source === 'language') return 'language'
  if (programType === 'foundation' || source === 'foundation') return 'foundation'
  if (source === 'bachelor' || source === 'undergraduate') return 'bachelor'
  if (source === 'master' || source === 'graduate') return 'master'
  if (['doctorate', 'doctoral', 'phd'].includes(source)) return 'doctorate'
  return 'other'
}

function normalizeStatusFact(value, fallbackStatus = 'officially_not_announced') {
  if (value && !Array.isArray(value) && typeof value === 'object' && value.status) {
    return deepClone(value)
  }
  if (Array.isArray(value)) {
    const options = value
      .map((item) => typeof item === 'string' ? item.trim() : item)
      .filter(Boolean)
    return options.length > 0
      ? { status: 'known', value: options.join(' or '), options }
      : { status: fallbackStatus, value: null, options: [] }
  }
  if (typeof value === 'string' && value.trim()) {
    return { status: 'known', value: value.trim() }
  }
  return { status: fallbackStatus, value: null }
}

function normalizeTeachingLanguage(value) {
  if (value && !Array.isArray(value) && typeof value === 'object' && value.status) {
    return deepClone(value)
  }
  const values = (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
  return values.length > 0
    ? { status: 'known', value: values.join(' / '), values }
    : { status: 'officially_not_announced', value: null, values: [] }
}

function normalizeTuitionPeriod(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/_/g, '-')
  if (!text) return null
  if (text.includes('semester')) return 'semester'
  if (text.includes('month')) return 'month'
  if (text.includes('program')) return 'program'
  if (text.includes('year')) return 'year'
  return 'other'
}

function normalizeTuition(value) {
  if (value && !Array.isArray(value) && typeof value === 'object' && value.status) {
    const normalized = deepClone(value)
    if (Object.prototype.hasOwnProperty.call(normalized, 'period')) {
      normalized.period = normalizeTuitionPeriod(normalized.period)
    }
    if (Array.isArray(normalized.options)) {
      normalized.options = normalized.options.map((item) => ({
        ...item,
        period: normalizeTuitionPeriod(item?.period),
      }))
    }
    return normalized
  }
  const options = (Array.isArray(value) ? value : [])
    .map((item) => ({
      amount: Number.isFinite(item?.amountCny) ? item.amountCny : null,
      currency: 'CNY',
      period: normalizeTuitionPeriod(item?.period),
      qualifier: item?.qualifier ?? null,
    }))
    .filter((item) => item.amount !== null)
  if (options.length === 0) {
    return {
      status: 'officially_not_announced',
      amount: null,
      currency: 'CNY',
      period: null,
      options: [],
    }
  }
  return {
    status: 'known',
    amount: options.length === 1 ? options[0].amount : null,
    currency: 'CNY',
    period: options.length === 1 ? options[0].period : null,
    qualifier: options.length === 1 ? options[0].qualifier : 'multiple official fee options',
    options,
  }
}

function normalizeIntake(value) {
  const text = String(value ?? '').toLowerCase()
  if (text.includes('spring')) return 'spring'
  if (text.includes('autumn') || text.includes('fall')) return 'autumn'
  const month = Number(text.match(/^\d{4}-(\d{2})$/)?.[1])
  if (month >= 1 && month <= 6) return 'spring'
  if (month >= 7 && month <= 12) return 'autumn'
  return 'other'
}

function academicYearFromIntake(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const start = month >= 8 ? year : year - 1
  return `${start}-${start + 1}`
}

function normalizeCycle(cycle, sourceFormat) {
  if (!cycle) return null
  const deadline = validDate(cycle.applicationDeadline)
    ? cycle.applicationDeadline
    : validDate(cycle.date)
      ? cycle.date
      : null
  const openDate = validDate(cycle.applicationOpen) ? cycle.applicationOpen : null
  const intakeLabel = cycle.intake ?? null
  const rawStatusAsOfCheckedAt = cycle.statusAsOfCheckedAt
    ?? (cycle.displayAsOpen ? 'open' : 'closed_or_not_current')
  const statusAsOfCheckedAt = rawStatusAsOfCheckedAt === 'open'
    ? 'open'
    : 'closed_or_not_current'
  const displayAsOpen = statusAsOfCheckedAt === 'open'
    && (deadline === null || deadline >= checkedAt)
  return {
    academicYear: /^\d{4}-\d{4}$/.test(cycle.academicYear ?? '')
      ? cycle.academicYear
      : academicYearFromIntake(intakeLabel),
    intake: normalizeIntake(intakeLabel),
    intakeLabel,
    applicationOpen: openDate,
    applicationDeadline: deadline,
    statusAsOfCheckedAt,
    displayAsOpen,
    sourceFormat,
  }
}

function normalizeCycles(candidate) {
  const cycles = []
  if (candidate.cycle) {
    const normalized = normalizeCycle(candidate.cycle, 'canonical')
    if (normalized) cycles.push(normalized)
  }
  for (const cycle of candidate.cycles ?? []) {
    const normalized = normalizeCycle(cycle, cycle.sourceFormat ?? 'canonical-list')
    if (normalized) cycles.push(normalized)
  }
  for (const deadline of candidate.applicationDeadlines ?? []) {
    const normalized = normalizeCycle(deadline, 'alternate')
    if (normalized) cycles.push(normalized)
  }
  const unique = new Map()
  for (const cycle of cycles) {
    const key = [
      cycle.academicYear,
      cycle.intake,
      cycle.intakeLabel,
      cycle.applicationOpen,
      cycle.applicationDeadline,
    ].join('|')
    const existing = unique.get(key)
    if (!existing || (!existing.displayAsOpen && cycle.displayAsOpen)) unique.set(key, cycle)
  }
  return [...unique.values()].sort((left, right) => (
    String(left.applicationDeadline ?? '9999-99-99')
      .localeCompare(String(right.applicationDeadline ?? '9999-99-99'))
  ))
}

function normalizeEvidence(candidate) {
  const officialUrl = candidate.evidence?.officialUrl ?? candidate.officialUrl
  const sourceTitle = candidate.evidence?.sourceTitle ?? candidate.officialTitle
  const sourceCheckedAt = candidate.evidence?.checkedAt ?? candidate.checkedAt ?? checkedAt
  const summary = candidate.evidence?.summary ?? candidate.evidenceSummary
  if (!String(officialUrl ?? '').startsWith('https://')) {
    throw new Error(`${candidate.candidateId} requires an official HTTPS URL`)
  }
  if (!sourceTitle) throw new Error(`${candidate.candidateId} requires a source title`)
  return {
    officialUrl,
    sourceTitle,
    checkedAt: validDate(sourceCheckedAt) ? sourceCheckedAt : checkedAt,
    summary: typeof summary === 'string'
      ? summary
      : deepClone(summary ?? 'Official program identity confirmed; dynamic facts remain unannounced.'),
  }
}

function normalizeAdditionalEvidence(candidate, primaryUrl) {
  const records = []
  const seen = new Set([primaryUrl])
  const add = (item, fallbackTitle = null) => {
    const officialUrl = typeof item === 'string' ? item : item?.officialUrl ?? item?.url
    if (typeof officialUrl !== 'string' || !officialUrl.startsWith('https://')) return
    if (seen.has(officialUrl)) return
    seen.add(officialUrl)
    records.push({
      officialUrl,
      sourceTitle: typeof item === 'object' ? item.sourceTitle ?? item.title ?? fallbackTitle : fallbackTitle,
    })
  }
  add(candidate.supportingOfficialUrl, 'Supporting official source')
  for (const item of candidate.additionalEvidence ?? []) add(item)
  return records
}
function normalizeProgram(candidate, sourceFile, existingRussianIndex) {
  const institutionSlug = candidate.institutionSlug ?? candidate.universitySlug
  if (!institutionSlug) throw new Error(`${candidate.candidateId} requires an institution slug`)
  const level = normalizeLevel(candidate)
  const evidence = normalizeEvidence(candidate)
  const additionalEvidence = normalizeAdditionalEvidence(candidate, evidence.officialUrl)
  return {
    candidateId: candidate.candidateId,
    candidateIds: [candidate.candidateId],
    institutionSlug,
    name: localizedName(candidate.name, 'program', candidate.candidateId, existingRussianIndex),
    programType: candidate.programType ?? (
      level === 'language' ? 'language' : level === 'foundation' ? 'foundation' : 'degree'
    ),
    level,
    teachingLanguage: normalizeTeachingLanguage(candidate.teachingLanguage),
    duration: normalizeStatusFact(candidate.duration),
    tuition: normalizeTuition(candidate.tuition),
    cycles: normalizeCycles(candidate),
    evidence,
    additionalEvidence,
    applicationUrl: candidate.applicationUrl ?? null,
    recommendedAction: candidate.recommendedAction ?? 'upsert_verified_identity',
    qualityTier: candidate.qualityTier ?? 'official-source-normalized',
    riskFlags: deepClone(candidate.riskFlags ?? []),
    sourceFiles: [sourceFile],
  }
}

function coverageTierStrings(coverage) {
  if (!coverage || typeof coverage !== 'object') return []
  const strings = []
  const visit = (value, prefix) => {
    if (value === null || value === undefined || value === '') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, prefix)
      return
    }
    if (typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        visit(nested, prefix ? `${prefix}.${key}` : key)
      }
      return
    }
    strings.push(`${prefix}: ${String(value)}`)
  }
  visit(coverage, '')
  return strings
}

function normalizeFunding(candidate) {
  if (candidate.funding) return deepClone(candidate.funding)
  const tiers = coverageTierStrings(candidate.coverage)
  return {
    status: tiers.length > 0 ? 'known' : 'officially_not_announced',
    tiers,
    structured: deepClone(candidate.coverage ?? {}),
  }
}

function normalizeScholarship(candidate, sourceFile, existingRussianIndex) {
  const institutionSlug = candidate.institutionSlug ?? candidate.universitySlug
  if (!institutionSlug) throw new Error(`${candidate.candidateId} requires an institution slug`)
  const evidence = normalizeEvidence(candidate)
  const additionalEvidence = normalizeAdditionalEvidence(candidate, evidence.officialUrl)
  return {
    candidateId: candidate.candidateId,
    candidateIds: [candidate.candidateId],
    institutionSlug,
    name: localizedName(candidate.name, 'scholarship', candidate.candidateId, existingRussianIndex),
    scholarshipType: candidate.scholarshipType ?? null,
    scope: candidate.scope ?? (candidate.applicableLevels ?? []).join(', '),
    applicableLevels: deepClone(candidate.applicableLevels ?? []),
    programCandidateIds: deepClone(candidate.programCandidateIds ?? []),
    funding: normalizeFunding(candidate),
    cycles: normalizeCycles(candidate),
    evidence,
    additionalEvidence,
    recommendedAction: candidate.recommendedAction ?? 'upsert_verified_identity',
    qualityTier: candidate.qualityTier ?? 'official-source-normalized',
    riskFlags: deepClone(candidate.riskFlags ?? []),
    sourceFiles: [sourceFile],
  }
}

function confirmedProgram(candidate, existingRussianIndex) {
  return normalizeProgram({
    ...candidate,
    teachingLanguage: { status: 'officially_not_announced', value: null },
    duration: { status: 'officially_not_announced', value: null },
    tuition: {
      status: 'officially_not_announced',
      amount: null,
      currency: 'CNY',
      period: null,
    },
    cycle: null,
    evidence: {
      officialUrl: candidate.officialUrl,
      sourceTitle: candidate.sourceTitle,
      checkedAt,
      summary: 'A named international-student program identity is confirmed on the official university source. No current deadline, fee, duration, or teaching-language fact is asserted by this merge.',
    },
    recommendedAction: 'upsert_verified_identity',
    qualityTier: 'official-identity-only',
  }, 'confirmed-hard-gap-identities', existingRussianIndex)
}

function knownFactScore(fact) {
  return fact?.status === 'known' ? 1 : 0
}

function candidateScore(candidate) {
  return candidate.cycles.filter((cycle) => cycle.displayAsOpen).length * 100
    + knownFactScore(candidate.teachingLanguage) * 10
    + knownFactScore(candidate.duration) * 8
    + knownFactScore(candidate.tuition) * 6
    + (candidate.name.ru ? 4 : 0)
    + (candidate.evidence.checkedAt === checkedAt ? 2 : 0)
}

function mergeCycleLists(left, right) {
  const unique = new Map()
  for (const cycle of [...left, ...right]) {
    const key = [
      cycle.academicYear,
      cycle.intake,
      cycle.intakeLabel,
      cycle.applicationOpen,
      cycle.applicationDeadline,
    ].join('|')
    const existing = unique.get(key)
    if (!existing || (!existing.displayAsOpen && cycle.displayAsOpen)) unique.set(key, cycle)
  }
  return [...unique.values()].sort((a, b) => (
    String(a.applicationDeadline ?? '9999-99-99')
      .localeCompare(String(b.applicationDeadline ?? '9999-99-99'))
  ))
}

function mergeEvidence(primary, secondary) {
  const evidence = deepClone(primary.evidence)
  const all = [
    ...primary.additionalEvidence,
    ...secondary.additionalEvidence,
    { officialUrl: secondary.evidence.officialUrl, sourceTitle: secondary.evidence.sourceTitle },
  ]
  const seen = new Set([evidence.officialUrl])
  const additionalEvidence = []
  for (const item of all) {
    if (!item?.officialUrl || seen.has(item.officialUrl)) continue
    seen.add(item.officialUrl)
    additionalEvidence.push(item)
  }
  return { evidence, additionalEvidence }
}

function mergeCandidate(primary, secondary) {
  const evidence = mergeEvidence(primary, secondary)
  return {
    ...primary,
    candidateIds: [...new Set([...primary.candidateIds, ...secondary.candidateIds])].sort(),
    name: {
      en: primary.name.en || secondary.name.en,
      zh: primary.name.zh || secondary.name.zh,
      ru: primary.name.ru || secondary.name.ru,
    },
    teachingLanguage: knownFactScore(primary.teachingLanguage)
      ? primary.teachingLanguage
      : secondary.teachingLanguage,
    duration: knownFactScore(primary.duration) ? primary.duration : secondary.duration,
    tuition: knownFactScore(primary.tuition) ? primary.tuition : secondary.tuition,
    cycles: mergeCycleLists(primary.cycles, secondary.cycles),
    ...evidence,
    sourceFiles: [...new Set([...primary.sourceFiles, ...secondary.sourceFiles])].sort(),
    riskFlags: [...new Set([...primary.riskFlags, ...secondary.riskFlags])],
  }
}

function deduplicate(candidates, kind) {
  const byIdentity = new Map()
  const duplicateGroups = []
  for (const candidate of candidates) {
    const key = kind === 'program'
      ? `${candidate.institutionSlug}|${candidate.level}|${normalizeText(candidate.name.en)}`
      : `${candidate.institutionSlug}|${normalizeText(candidate.name.en)}`
    const existing = byIdentity.get(key)
    if (!existing) {
      byIdentity.set(key, candidate)
      continue
    }
    const primary = candidateScore(candidate) > candidateScore(existing) ? candidate : existing
    const secondary = primary === candidate ? existing : candidate
    const merged = mergeCandidate(primary, secondary)
    byIdentity.set(key, merged)
    duplicateGroups.push({
      identityKey: key,
      candidateIds: [...new Set([...existing.candidateIds, ...candidate.candidateIds])].sort(),
      keptCandidateId: merged.candidateId,
    })
  }
  const records = [...byIdentity.values()].sort((left, right) => (
    left.institutionSlug.localeCompare(right.institutionSlug)
      || left.name.en.localeCompare(right.name.en)
      || left.candidateId.localeCompare(right.candidateId)
  ))
  return { records, duplicateGroups }
}

function assertUniqueCandidateIds(programs, scholarships) {
  const ids = new Set()
  for (const candidate of [...programs, ...scholarships]) {
    if (!candidate.candidateId) throw new Error('Candidate id is required')
    if (ids.has(candidate.candidateId)) {
      throw new Error(`Duplicate canonical candidate id: ${candidate.candidateId}`)
    }
    ids.add(candidate.candidateId)
  }
}

function mergeStaticRecord(recordsById, idsBySlug, item, kind, sourceFile) {
  if (!item?.id || !item?.slug) {
    throw new Error(`${sourceFile} has a ${kind} without id/slug`)
  }
  const clone = deepClone(item)
  const existingById = recordsById.get(item.id)
  if (existingById) {
    if (JSON.stringify(existingById.record) !== JSON.stringify(clone)) {
      throw new Error(`Conflicting ${kind} id ${item.id} in ${existingById.sourceFile} and ${sourceFile}`)
    }
    return
  }
  const existingIdForSlug = idsBySlug.get(item.slug)
  if (existingIdForSlug && existingIdForSlug !== item.id) {
    throw new Error(`Duplicate ${kind} slug ${item.slug}: ${existingIdForSlug} and ${item.id}`)
  }
  recordsById.set(item.id, { record: clone, sourceFile })
  idsBySlug.set(item.slug, item.id)
}

function main() {
  const existingRussianIndex = buildExistingRussianIndex()
  const normalizedPrograms = []
  const normalizedScholarships = []
  const citiesById = new Map()
  const cityIdsBySlug = new Map()
  const universitiesById = new Map()
  const universityIdsBySlug = new Map()

  for (const { sourceFile: fileName, filePath } of rawFileEntries) {
    const bundle = readJson(filePath)
    for (const city of bundle.cities ?? []) {
      mergeStaticRecord(citiesById, cityIdsBySlug, city, 'city', fileName)
    }
    for (const university of bundle.universities ?? []) {
      mergeStaticRecord(
        universitiesById,
        universityIdsBySlug,
        university,
        'university',
        fileName,
      )
    }
    const programs = bundle.programCandidates ?? bundle.programs ?? []
    const scholarships = bundle.scholarshipCandidates ?? bundle.scholarships ?? []
    normalizedPrograms.push(
      ...programs.map((candidate) => normalizeProgram(
        candidate,
        fileName,
        existingRussianIndex,
      )),
    )
    normalizedScholarships.push(
      ...scholarships.map((candidate) => normalizeScholarship(
        candidate,
        fileName,
        existingRussianIndex,
      )),
    )
  }

  normalizedPrograms.push(
    ...confirmedIdentityPrograms.map((candidate) => (
      confirmedProgram(candidate, existingRussianIndex)
    )),
  )

  const programs = deduplicate(normalizedPrograms, 'program')
  const scholarships = deduplicate(normalizedScholarships, 'scholarship')
  assertUniqueCandidateIds(programs.records, scholarships.records)

  const institutionSlugs = new Set([
    ...programs.records.map((candidate) => candidate.institutionSlug),
    ...scholarships.records.map((candidate) => candidate.institutionSlug),
  ])
  const output = {
    schemaVersion: '2026-08-01.merged.v3',
    generatedAt: `${checkedAt}T00:00:00+08:00`,
    sourceFiles: rawFileEntries.map(({ sourceFile }) => sourceFile),
    cities: [...citiesById.values()]
      .map(({ record }) => record)
      .sort((left, right) => left.slug.localeCompare(right.slug)),
    universities: [...universitiesById.values()]
      .map(({ record }) => record)
      .sort((left, right) => left.slug.localeCompare(right.slug)),
    programCandidates: programs.records,
    scholarshipCandidates: scholarships.records,
    archiveInstitutionSlugs,
    archiveDecisions: archiveInstitutionSlugs.map((institutionSlug) => ({
      institutionSlug,
      action: 'archive_from_applicant_catalog',
      reasonCode: 'no_publishable_official_program_candidate_in_current_release',
      checkedAt,
      note: 'Archive until a named official program accepting individual international applicants is verified. This is a release-quality decision, not a claim that the university never educates international students.',
    })),
    mergeAudit: {
      mergedCities: citiesById.size,
      mergedUniversities: universitiesById.size,
      rawProgramCandidates: normalizedPrograms.length,
      rawScholarshipCandidates: normalizedScholarships.length,
      mergedProgramCandidates: programs.records.length,
      mergedScholarshipCandidates: scholarships.records.length,
      institutionsRepresented: institutionSlugs.size,
      archiveInstitutions: archiveInstitutionSlugs.length,
      openProgramCycles: programs.records
        .flatMap((candidate) => candidate.cycles)
        .filter((cycle) => cycle.displayAsOpen).length,
      openScholarshipCycles: scholarships.records
        .flatMap((candidate) => candidate.cycles)
        .filter((cycle) => cycle.displayAsOpen).length,
      programDuplicateGroups: programs.duplicateGroups,
      scholarshipDuplicateGroups: scholarships.duplicateGroups,
      translationAudit,
    },
  }
  writeJson(outputPath, output)
  console.log(JSON.stringify({
    output: path.relative(root, outputPath),
    ...output.mergeAudit,
  }, null, 2))
}

main()
