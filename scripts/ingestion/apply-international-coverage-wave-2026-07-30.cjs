const fs = require('node:fs')
const path = require('node:path')
const { classifyCandidateDiscipline } = require('./classify-candidate-discipline.cjs')

const root = path.resolve(__dirname, '..', '..')
const dataDir = path.join(root, 'content', 'data')
const mergedPath = path.join(
  root,
  'quality',
  'official-gap-wave-2026-07-30',
  'merged-candidates.json',
)

const WAVE_PREFIXES = {
  program: 'prog-gap-',
  cycle: 'cycle-gap-',
  scholarship: 'sch-gap-',
  programSource: 'src-gap-program-',
  scholarshipSource: 'src-gap-scholarship-',
  citySource: 'src-gap-city-',
  universitySource: 'src-gap-university-',
}

const LEGACY_DUPLICATE_PROGRAM_MERGES = [
  {
    removeId: 'program-shanghai-jiao-tong-university-long-term-chinese-language-course-full-tim',
    keepId: 'program-shanghai-jiao-tong-university-chinese-language-program-language',
    migrateSupportingSources: true,
  },
  {
    removeId: 'program-nanjing-university-long-term-chinese-language-program-language',
    keepId: 'program-nanjing-university-chinese-language-program-language',
    migrateSupportingSources: true,
  },
  {
    removeId: 'program-zhejiang-gongshang-university-international-business-bachelor',
    keepId: 'prog-gap-local-zjgsu-b-international-business-en',
    migrateSupportingSources: false,
  },
  {
    removeId: 'program-zhejiang-sci-tech-university-chinese-language-program-language',
    keepId: 'prog-gap-prog-zstu-chinese-language-nondegree',
    migrateSupportingSources: false,
  },
  {
    removeId: 'program-heilongjiang-university-chinese-language-program-language',
    keepId: 'prog-gap-confirmed-hlju-chinese-language',
    migrateSupportingSources: false,
  },
  {
    removeId: 'program-south-china-normal-university-chinese-language-bachelor',
    keepId: 'prog-gap-chinese-degree-scnu-chinese-language-bachelor',
    migrateSupportingSources: true,
  },
]

const LEGACY_DUPLICATE_SCHOLARSHIP_MERGES = [
  {
    removeId: 'sch-gap-sch-gdufs-guangdong-government',
    keepId: 'scholarship-gdufs-guangdong-government',
    keepSlug: 'gdufs-guangdong-government',
  },
  {
    removeId: 'sch-gap-pku-depth-pku-scholarship-international-students',
    keepId: 'scholarship-peking-university-international-student',
    keepSlug: 'peking-university-international-student',
  },
]

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function readData(name) {
  return readJson(path.join(dataDir, name))
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function isoDate(value, label) {
  const date = String(value ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${label} must contain a YYYY-MM-DD date`)
  }
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${label} is not a real calendar date`)
  }
  return date
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

const CATALOG_AS_OF_DATE = isoDate(
  process.env.CATALOG_AS_OF_DATE,
  'CATALOG_AS_OF_DATE',
)

function httpsUrl(value, label) {
  const url = new URL(String(value))
  if (url.protocol !== 'https:') throw new Error(`${label} must use HTTPS`)
  return url.toString()
}

function localizedText(value, fallback) {
  const result = {}
  for (const locale of ['en', 'zh', 'ru']) {
    if (typeof value?.[locale] === 'string' && value[locale].trim()) {
      result[locale] = value[locale].trim()
    }
  }
  if (Object.keys(result).length === 0 && fallback) result.en = fallback
  if (Object.keys(result).length === 0) throw new Error('Localized text is empty')
  return result
}

function localizedSummary(value, fallback) {
  if (typeof value === 'string' && value.trim()) {
    return { en: value.trim(), zh: value.trim() }
  }
  try {
    return localizedText(value, fallback)
  } catch {
    return { en: fallback, zh: fallback }
  }
}

function normalizedName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function degreeLevel(candidate) {
  const value = String(candidate.level ?? candidate.degreeLevel ?? '').toLowerCase()
  if (candidate.programType === 'foundation') return 'foundation'
  if (candidate.programType === 'language' || value === 'non_degree') return 'language'
  if (value === 'bachelor' || value === 'undergraduate') return 'bachelor'
  if (value === 'master' || value === 'graduate') return 'master'
  if (['doctorate', 'doctoral', 'phd'].includes(value)) return 'doctorate'
  return 'other'
}

function parseLanguages(candidate) {
  const fact = candidate.teachingLanguage
  if (fact && typeof fact === 'object' && !Array.isArray(fact)) {
    if (fact.status !== 'known') return []
  }
  const raw = fact && typeof fact === 'object' && !Array.isArray(fact)
    ? fact.value ?? fact.values ?? []
    : fact ?? []
  const values = Array.isArray(raw) ? raw : String(raw).split(/[,+/&]|\band\b/i)
  const result = []
  for (const value of values) {
    const text = String(value).trim()
    const lower = text.toLowerCase()
    if (!text) continue
    if (lower.includes('chinese') && !result.includes('Chinese')) result.push('Chinese')
    if (lower.includes('english') && !result.includes('English')) result.push('English')
    if (lower.includes('russian') && !result.includes('Russian')) result.push('Russian')
    if (
      !lower.includes('chinese')
      && !lower.includes('english')
      && !lower.includes('russian')
      && !result.includes(text)
    ) {
      result.push(text)
    }
  }
  return result
}

function parseDuration(candidate) {
  const fact = candidate.duration
  if (fact && typeof fact === 'object' && !Array.isArray(fact) && fact.status !== 'known') {
    return { durationMonths: null }
  }
  const raw = fact && typeof fact === 'object' && !Array.isArray(fact)
    ? fact.value ?? fact.options ?? []
    : fact
  const values = Array.isArray(raw) ? raw : raw ? [raw] : []
  const months = []
  const numberWords = new Map([
    ['one', 1],
    ['two', 2],
    ['three', 3],
    ['four', 4],
    ['five', 5],
    ['six', 6],
  ])
  const addMonths = (amount, unit) => {
    if (unit.startsWith('year') || unit.startsWith('academic')) months.push(Math.round(amount * 12))
    else if (unit.startsWith('semester')) months.push(Math.round(amount * 6))
    else if (unit.startsWith('week')) months.push(Math.max(1, Math.ceil(amount / 4)))
    else months.push(Math.round(amount))
  }
  for (const value of values) {
    const text = String(value)
      .toLowerCase()
      .replace(/\b(one|two|three|four|five|six)\b/g, (word) => String(numberWords.get(word)))
    for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(academic\s+years?|years?|semesters?|months?|weeks?)/g)) {
      addMonths(Number(match[1]), match[2])
    }
    const groupedPattern = /((?:\d+(?:\.\d+)?)(?:\s*(?:[-–—]|,\s*(?:or\s*)?|\bor\b|\band\b)\s*\d+(?:\.\d+)?)+)\s*(academic\s+years?|years?|semesters?|months?|weeks?)/g
    for (const match of text.matchAll(groupedPattern)) {
      for (const amount of match[1].match(/\d+(?:\.\d+)?/g) ?? []) {
        addMonths(Number(amount), match[2])
      }
    }
  }
  const valid = months.filter((value) => Number.isInteger(value) && value > 0 && value <= 120)
  if (valid.length === 0) return { durationMonths: null }
  const minimum = Math.min(...valid)
  const maximum = Math.max(...valid)
  return maximum === minimum
    ? { durationMonths: minimum }
    : { durationMonths: minimum, durationMonthsMax: maximum }
}

function discipline(candidate) {
  return classifyCandidateDiscipline(candidate)
}

function tuition(candidate) {
  const value = candidate.tuition ?? {}
  const amount = value.status === 'known'
    ? Number(value.amount ?? value.amountCny)
    : Number.NaN
  if (!Number.isFinite(amount) || amount < 0) {
    return { tuitionCny: null, tuitionPeriod: null, tuitionStatus: null }
  }
  const rawPeriod = String(value.period ?? '').toLowerCase()
  let period = 'other'
  if (rawPeriod.includes('semester')) period = 'semester'
  else if (rawPeriod.includes('month')) period = 'month'
  else if (rawPeriod.includes('program')) period = 'program'
  else if (rawPeriod.includes('year')) period = 'academic-year'
  return {
    tuitionCny: amount,
    tuitionPeriod: period,
    tuitionStatus: value.qualifier ? 'reference' : 'confirmed',
  }
}

function normalizeAcademicYear(value, deadline) {
  const raw = String(value ?? '')
  if (/^\d{4}-\d{4}$/.test(raw) && Number(raw.slice(5)) === Number(raw.slice(0, 4)) + 1) {
    return raw
  }
  const year = Number(raw.match(/\d{4}/)?.[0] ?? String(deadline ?? '').slice(0, 4))
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`Cannot derive academic year from ${raw || deadline}`)
  }
  return `${year}-${year + 1}`
}

function normalizeIntake(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'spring' || text.includes('spring')) return 'spring'
  if (text === 'autumn' || text === 'fall' || text.includes('autumn') || text.includes('fall')) return 'autumn'
  return 'other'
}

function groupOpenCycles(candidate) {
  const grouped = new Map()
  for (const cycle of candidate.cycles ?? []) {
    if (!cycle.displayAsOpen) continue
    const deadline = cycle.applicationDeadline ? isoDate(cycle.applicationDeadline, `${candidate.candidateId} deadline`) : null
    const opensOn = cycle.applicationOpen ? isoDate(cycle.applicationOpen, `${candidate.candidateId} opens`) : null
    const academicYear = normalizeAcademicYear(cycle.academicYear, deadline)
    const intake = normalizeIntake(cycle.intake)
    const key = `${academicYear}:${intake}`
    const existing = grouped.get(key)
    grouped.set(key, {
      academicYear,
      intake,
      opensOn: [existing?.opensOn, opensOn].filter(Boolean).sort().at(0) ?? null,
      closesOn: [existing?.closesOn, deadline].filter(Boolean).sort().at(-1) ?? null,
    })
  }
  return [...grouped.values()]
}

function groupProgramCycles(candidate, checkedAt) {
  const grouped = new Map()
  for (const cycle of candidate.cycles ?? []) {
    const deadline = cycle.applicationDeadline ? isoDate(cycle.applicationDeadline, `${candidate.candidateId} deadline`) : null
    const opensOn = cycle.applicationOpen ? isoDate(cycle.applicationOpen, `${candidate.candidateId} opens`) : null
    const academicYear = normalizeAcademicYear(cycle.academicYear, deadline ?? checkedAt)
    const intake = normalizeIntake(cycle.intake)
    const key = `${academicYear}:${intake}`
    const existing = grouped.get(key)
    grouped.set(key, {
      academicYear,
      intake,
      opensOn: [existing?.opensOn, opensOn].filter(Boolean).sort().at(0) ?? null,
      closesOn: [existing?.closesOn, deadline].filter(Boolean).sort().at(-1) ?? null,
      displayAsOpen: Boolean(existing?.displayAsOpen || cycle.displayAsOpen),
    })
  }
  return [...grouped.values()]
}

function normalizeExpiredTuitionCycles(state) {
  let converted = 0
  const cycleIds = new Set(state.cycles.map((cycle) => cycle.id))
  state.cycles = state.cycles.map((cycle) => {
    if (cycle.id.endsWith('-fee-reference')
      || typeof cycle.tuitionCny !== 'number'
      || cycle.closesOn === null
      || addDays(cycle.closesOn, 30) >= CATALOG_AS_OF_DATE) {
      return cycle
    }
    const referenceId = `${cycle.id}-fee-reference`
    if (cycleIds.has(referenceId)) {
      throw new Error(`Cannot convert expired tuition cycle ${cycle.id}: ${referenceId} already exists`)
    }
    cycleIds.delete(cycle.id)
    cycleIds.add(referenceId)
    const reference = {
      ...cycle,
      id: referenceId,
      opensOn: null,
      closesOn: null,
      dateStatus: 'not-announced',
      tuitionStatus: 'reference',
    }
    delete reference.notes
    converted += 1
    return reference
  })
  return converted
}

function sourceRecord(id, candidate, kind, evidence = candidate.evidence) {
  const url = httpsUrl(evidence?.officialUrl, `${candidate.candidateId} official URL`)
  const checkedAt = isoDate(candidate.evidence?.checkedAt, `${candidate.candidateId} checkedAt`)
  const title = String(evidence?.sourceTitle ?? candidate.evidence?.sourceTitle ?? candidate.name?.en ?? candidate.candidateId)
  return {
    id,
    url,
    title,
    publisher: candidate.institutionSlug,
    kind,
    language: /[\u4e00-\u9fff]/.test(title) ? 'zh' : 'en',
    official: true,
    accessedAt: checkedAt,
  }
}

function sourceRecords(baseId, candidate, kind) {
  const records = [sourceRecord(baseId, candidate, kind)]
  for (const [index, evidence] of (candidate.additionalEvidence ?? []).entries()) {
    records.push(sourceRecord(`${baseId}-support-${index + 1}`, candidate, kind, evidence))
  }
  return records
}

function providerType(candidate) {
  const allowedTypes = new Set(['csc', 'province', 'city', 'university', 'other'])
  for (const explicitType of [candidate.providerType, candidate.scholarshipType]) {
    const normalized = String(explicitType ?? '').trim().toLowerCase()
    if (allowedTypes.has(normalized)) return normalized
    if (normalized.startsWith('municipal')) return 'city'
    if (normalized.startsWith('provincial')) return 'province'
    if (normalized.startsWith('university')) return 'university'
  }
  const text = `${candidate.name?.en ?? ''} ${candidate.name?.zh ?? ''}`.toLowerCase()
  if (/chinese government|china link|silk road|中国政府/.test(text)) return 'csc'
  if (/provincial|province|省政府/.test(text)) return 'province'
  if (/beijing government|municipal|city|北京市?政府|市政府/.test(text)) return 'city'
  if (/university|president|academic|freshmen|大学|校长|学业/.test(text)) return 'university'
  return 'other'
}

function scholarshipCoverage(candidate) {
  const tiers = candidate.funding?.tiers ?? []
  const text = Array.isArray(tiers) ? tiers.join(' ').toLowerCase() : String(tiers).toLowerCase()
  const hasFullTier = /\bfull\b|全额|一等奖|100%/.test(text)
  const hasPartialTier = /\bpartial\b|部分|[二三]等奖|50%|70%|40%|30%|20%|10%/.test(text)
  if (hasFullTier && hasPartialTier) {
    return {
      tuition: 'unknown',
      accommodation: 'unknown',
      insurance: 'unknown',
      stipendCnyPerMonth: null,
    }
  }
  const fullTuition = /full scholarship|full tuition|covers? tuition|tuition waiver|\btuition\b|免.*学费|100%/.test(text)
  const partialTuition = /partial|50%|70%|40%|30%|20%|10%|second prize/.test(text)
  const accommodation = /accommodation|housing|住宿/.test(text)
  const insurance = /insurance|医疗保险/.test(text)
  const monthlyAmounts = [...text.matchAll(/(?:cny|rmb)\s*([\d,]+)\s*(?:monthly|per month)/g)]
    .map((match) => Number(match[1].replaceAll(',', '')))
  return {
    tuition: fullTuition && !partialTuition ? 'full' : fullTuition || partialTuition ? 'partial' : 'unknown',
    accommodation: accommodation ? 'full' : 'unknown',
    insurance: insurance ? true : 'unknown',
    stipendCnyPerMonth: monthlyAmounts.length === 1 ? monthlyAmounts[0] : null,
  }
}

function assertUnique(items, field, label) {
  const seen = new Set()
  for (const item of items) {
    if (seen.has(item[field])) throw new Error(`Duplicate ${label} ${field}: ${item[field]}`)
    seen.add(item[field])
  }
}

function upsertByIdAndSlug(items, record, label) {
  const slugConflict = items.find(
    (item) => item.slug === record.slug && item.id !== record.id,
  )
  if (slugConflict) {
    throw new Error(
      `Duplicate ${label} slug ${record.slug}: ${slugConflict.id} and ${record.id}`,
    )
  }
  const existingIndex = items.findIndex((item) => item.id === record.id)
  if (existingIndex >= 0) items[existingIndex] = record
  else items.push(record)
}

function upsertById(items, record) {
  const existingIndex = items.findIndex((item) => item.id === record.id)
  if (existingIndex >= 0) items[existingIndex] = record
  else items.push(record)
}

function staticSource(id, url, title, publisher, kind, accessedAt) {
  return {
    id,
    url: httpsUrl(url, `${id} official URL`),
    title,
    publisher,
    kind,
    language: /[\u4e00-\u9fff]/.test(title) ? 'zh' : 'en',
    official: true,
    accessedAt: isoDate(accessedAt, `${id} accessedAt`),
  }
}

function importStaticCatalog(merged, state) {
  const newCities = merged.cities ?? []
  const newUniversities = merged.universities ?? []

  for (const city of newCities) {
    upsertByIdAndSlug(state.cities, city, 'city')
  }
  const cityIds = new Set(state.cities.map((city) => city.id))

  for (const university of newUniversities) {
    if (!cityIds.has(university.cityId)) {
      throw new Error(`Unknown city ${university.cityId} for ${university.slug}`)
    }
    upsertByIdAndSlug(state.universities, university, 'university')
    if (!Array.isArray(university.sourceIds) || university.sourceIds.length === 0) {
      throw new Error(`${university.slug} requires an official source id`)
    }
    for (const sourceId of university.sourceIds) {
      upsertById(state.sources, staticSource(
        sourceId,
        university.officialUrl,
        `${university.name.en} official international admissions`,
        university.name.en,
        'university',
        university.verifiedAt,
      ))
    }
  }

  const newUniversitiesByCity = new Map()
  for (const university of newUniversities) {
    if (!newUniversitiesByCity.has(university.cityId)) {
      newUniversitiesByCity.set(university.cityId, university)
    }
  }
  for (const city of newCities) {
    if (!Array.isArray(city.sourceIds) || city.sourceIds.length === 0) {
      throw new Error(`${city.slug} requires an official source id`)
    }
    const representative = newUniversitiesByCity.get(city.id)
    if (!representative) {
      throw new Error(`No official university source can ground new city ${city.slug}`)
    }
    for (const sourceId of city.sourceIds) {
      upsertById(state.sources, staticSource(
        sourceId,
        representative.officialUrl,
        `Official university source confirming ${city.name.en} location`,
        representative.name.en,
        'city',
        city.verifiedAt,
      ))
    }
  }

  return {
    cities: newCities.length,
    universities: newUniversities.length,
  }
}

function cleanPreviousWave(state) {
  const oldProgramIds = new Set(
    state.programs
      .filter((item) => item.id.startsWith(WAVE_PREFIXES.program))
      .map((item) => item.id),
  )
  state.programs = state.programs.filter((item) => !oldProgramIds.has(item.id))
  state.cycles = state.cycles.filter(
    (item) => !item.id.startsWith(WAVE_PREFIXES.cycle) && !oldProgramIds.has(item.programId),
  )
  state.scholarships = state.scholarships.filter(
    (item) => !item.id.startsWith(WAVE_PREFIXES.scholarship),
  )
  state.sources = state.sources.filter(
    (item) => !item.id.startsWith(WAVE_PREFIXES.programSource)
      && !item.id.startsWith(WAVE_PREFIXES.scholarshipSource)
      && !item.id.startsWith(WAVE_PREFIXES.citySource)
      && !item.id.startsWith(WAVE_PREFIXES.universitySource),
  )
  return {
    programs: oldProgramIds.size,
  }
}

function mergeLegacyDuplicatePrograms(state) {
  let removedPrograms = 0
  let removedDraftCycles = 0
  let migratedVerifiedCycles = 0
  let migratedSupportingSources = 0

  for (const rule of LEGACY_DUPLICATE_PROGRAM_MERGES) {
    const keeper = state.programs.find((program) => program.id === rule.keepId)
    if (!keeper) throw new Error(`Missing canonical program ${rule.keepId}`)
    const duplicate = state.programs.find((program) => program.id === rule.removeId)
    if (!duplicate) continue

    if (rule.migrateSupportingSources) {
      const previousCount = keeper.sourceIds.length
      keeper.sourceIds = [...new Set([...keeper.sourceIds, ...duplicate.sourceIds])]
      migratedSupportingSources += keeper.sourceIds.length - previousCount
    }

    const keeperCycleKeys = new Set(
      state.cycles
        .filter((cycle) => cycle.programId === keeper.id)
        .map((cycle) => [
          cycle.academicYear,
          cycle.intake,
          cycle.opensOn,
          cycle.closesOn,
        ].join('|')),
    )
    state.cycles = state.cycles.flatMap((cycle) => {
      if (cycle.programId !== duplicate.id) return [cycle]
      if (cycle.status !== 'verified') {
        removedDraftCycles += 1
        return []
      }
      const cycleKey = [
        cycle.academicYear,
        cycle.intake,
        cycle.opensOn,
        cycle.closesOn,
      ].join('|')
      if (keeperCycleKeys.has(cycleKey)) return []
      keeperCycleKeys.add(cycleKey)
      migratedVerifiedCycles += 1
      return [{ ...cycle, programId: keeper.id }]
    })

    state.scholarships = state.scholarships.map((scholarship) => ({
      ...scholarship,
      programIds: [...new Set(
        scholarship.programIds.map((programId) => (
          programId === duplicate.id ? keeper.id : programId
        )),
      )],
    }))
    state.programs = state.programs.filter((program) => program.id !== duplicate.id)
    removedPrograms += 1
  }

  return {
    removedPrograms,
    removedDraftCycles,
    migratedVerifiedCycles,
    migratedSupportingSources,
  }
}

function mergeLegacyDuplicateScholarships(state) {
  let removedScholarships = 0
  let migratedScholarshipSources = 0

  for (const rule of LEGACY_DUPLICATE_SCHOLARSHIP_MERGES) {
    const duplicate = state.scholarships.find((scholarship) => scholarship.id === rule.removeId)
    if (!duplicate) continue
    let keeper = state.scholarships.find((scholarship) => scholarship.id === rule.keepId)
    const previousSourceIds = keeper?.sourceIds ?? []
    if (!keeper) {
      const duplicateIndex = state.scholarships.indexOf(duplicate)
      keeper = { ...duplicate, id: rule.keepId, slug: rule.keepSlug }
      state.scholarships[duplicateIndex] = keeper
    } else {
      Object.assign(keeper, duplicate, { id: rule.keepId, slug: rule.keepSlug })
      state.scholarships = state.scholarships.filter(
        (scholarship) => scholarship.id !== duplicate.id,
      )
    }
    const sourceIds = [...new Set([...previousSourceIds, ...duplicate.sourceIds])]
    migratedScholarshipSources += Math.max(0, sourceIds.length - previousSourceIds.length)
    keeper.sourceIds = sourceIds
    removedScholarships += 1
  }

  return {
    removedScholarships,
    migratedScholarshipSources,
  }
}

function importProgram(candidate, state) {
  const university = state.universityBySlug.get(candidate.institutionSlug)
  if (!university) throw new Error(`Unknown institution slug: ${candidate.institutionSlug}`)
  if (university.status === 'archived') {
    throw new Error(`Program candidate targets archived institution: ${candidate.institutionSlug}`)
  }
  const token = slugify(candidate.candidateId)
  const level = degreeLevel(candidate)
  const id = `${WAVE_PREFIXES.program}${token}`
  const slug = `gap-${token}-${level}`
  const sourceId = `${WAVE_PREFIXES.programSource}${token}`
  const checkedAt = isoDate(candidate.evidence?.checkedAt, `${candidate.candidateId} checkedAt`)
  const languages = parseLanguages(candidate)
  const duration = parseDuration(candidate)
  const names = localizedText(candidate.name, candidate.candidateId)
  const officialUrl = httpsUrl(candidate.evidence?.officialUrl, `${candidate.candidateId} official URL`)
  const summary = localizedSummary(candidate.evidence?.summary, `Official international program: ${names.en ?? names.zh}`)

  const candidateSources = sourceRecords(sourceId, candidate, 'program')
  const sourceIds = candidateSources.map((item) => item.id)
  state.sources.push(...candidateSources)
  state.programs.push({
    id,
    slug,
    universityId: university.id,
    name: names,
    degreeLevel: level,
    discipline: discipline(candidate),
    teachingLanguages: languages,
    ...duration,
    programUrl: officialUrl,
    applyUrl: candidate.applicationUrl
      ? httpsUrl(candidate.applicationUrl, `${candidate.candidateId} application URL`)
      : null,
    languageRequirements: [],
    verificationScope: duration.durationMonths !== null || languages.length > 0 ? 'facts' : 'identity',
    sourceIds,
    verifiedAt: checkedAt,
    reviewAfter: addDays(checkedAt, 30),
    status: 'verified',
  })

  const cycleTuition = tuition(candidate)
  const programCycles = groupProgramCycles(candidate, checkedAt)
  const hasOpenCycle = (candidate.cycles ?? []).some((cycle) => cycle.displayAsOpen)
  let feeReferenceCycle = null

  if (cycleTuition.tuitionCny !== null && !hasOpenCycle) {
    if (programCycles.length === 0) {
      const checkedYear = Number(checkedAt.slice(0, 4))
      feeReferenceCycle = {
        academicYear: `${checkedYear}-${checkedYear + 1}`,
        intake: 'other',
        opensOn: null,
        closesOn: null,
        displayAsOpen: false,
      }
      programCycles.push(feeReferenceCycle)
    } else {
      const latestCycle = [...programCycles].sort((left, right) => (
        left.academicYear.localeCompare(right.academicYear)
        || (left.closesOn ?? left.opensOn ?? '').localeCompare(right.closesOn ?? right.opensOn ?? '')
        || left.intake.localeCompare(right.intake)
      )).at(-1)
      const hasNoDates = latestCycle.opensOn === null && latestCycle.closesOn === null
      const isPastGrace = latestCycle.closesOn !== null
        && addDays(latestCycle.closesOn, 30) < CATALOG_AS_OF_DATE
      if (hasNoDates || isPastGrace) feeReferenceCycle = latestCycle
    }
  }

  for (const cycle of programCycles) {
    const isFeeReference = cycle === feeReferenceCycle
    state.cycles.push({
      id: isFeeReference
        ? `${WAVE_PREFIXES.cycle}${token}-${cycle.academicYear}-${cycle.intake}-fee-reference`
        : `${WAVE_PREFIXES.cycle}${token}-${cycle.academicYear}-${cycle.intake}`,
      programId: id,
      academicYear: cycle.academicYear,
      intake: cycle.intake,
      opensOn: isFeeReference ? null : cycle.opensOn,
      closesOn: isFeeReference ? null : cycle.closesOn,
      dateStatus: isFeeReference
        ? 'not-announced'
        : cycle.opensOn || cycle.closesOn
          ? 'published'
          : cycle.displayAsOpen
            ? 'rolling'
            : 'not-announced',
      ...cycleTuition,
      tuitionStatus: isFeeReference ? 'reference' : cycleTuition.tuitionStatus,
      evidenceBasis: 'cycle-specific',
      factScope: cycleTuition.tuitionCny === null ? 'dates-only' : 'partial',
      applicationFeeCny: null,
      ...(isFeeReference ? {} : { notes: summary }),
      sourceIds,
      verifiedAt: checkedAt,
      reviewAfter: addDays(checkedAt, 7),
      status: 'verified',
    })
  }
}

function importScholarship(candidate, state) {
  const university = state.universityBySlug.get(candidate.institutionSlug)
  if (!university) throw new Error(`Unknown scholarship institution: ${candidate.institutionSlug}`)
  if (university.status === 'archived') return
  const token = slugify(candidate.candidateId)
  const id = `${WAVE_PREFIXES.scholarship}${token}`
  const sourceId = `${WAVE_PREFIXES.scholarshipSource}${token}`
  const checkedAt = isoDate(candidate.evidence?.checkedAt, `${candidate.candidateId} checkedAt`)
  const names = localizedText(candidate.name, candidate.candidateId)
  const openCycles = groupOpenCycles(candidate)
  const deadline = openCycles.map((cycle) => cycle.closesOn).filter(Boolean).sort().at(-1) ?? null
  const tierSummary = Array.isArray(candidate.funding?.tiers)
    ? candidate.funding.tiers.join('; ')
    : ''
  const summary = localizedSummary(
    candidate.evidence?.summary,
    [candidate.scope, tierSummary, `Official scholarship: ${names.en ?? names.zh}`]
      .filter(Boolean)
      .join(' '),
  )

  const candidateSources = sourceRecords(sourceId, candidate, 'scholarship')
  const sourceIds = candidateSources.map((item) => item.id)
  const programIds = (candidate.programCandidateIds ?? []).map((candidateId) => {
    const programId = `${WAVE_PREFIXES.program}${slugify(candidateId)}`
    const program = state.programs.find((item) => item.id === programId)
    if (!program || program.universityId !== university.id) {
      throw new Error(`${candidate.candidateId} references unknown program candidate ${candidateId}`)
    }
    return programId
  })
  state.sources.push(...candidateSources)
  state.scholarships.push({
    id,
    slug: `gap-${token}`,
    name: names,
    providerType: providerType(candidate),
    universityIds: [university.id],
    programIds,
    coverage: scholarshipCoverage(candidate),
    deadline,
    applicationUrl: httpsUrl(candidate.evidence?.officialUrl, `${candidate.candidateId} official URL`),
    summary,
    sourceIds,
    verifiedAt: checkedAt,
    reviewAfter: addDays(checkedAt, deadline ? 7 : 30),
    status: 'verified',
  })
}

function main() {
  if (!fs.existsSync(mergedPath)) {
    throw new Error(`Merged candidate file is missing: ${mergedPath}`)
  }
  const merged = readJson(mergedPath)
  if (!Array.isArray(merged.programCandidates) || !Array.isArray(merged.scholarshipCandidates)) {
    throw new Error('Merged candidate file must contain programCandidates and scholarshipCandidates arrays')
  }
  const archiveInstitutionSlugs = new Set(merged.archiveInstitutionSlugs ?? [])
  const state = {
    sources: readData('sources.json'),
    cities: readData('cities.json'),
    universities: readData('universities.json'),
    programs: readData('programs.json'),
    cycles: readData('admission-cycles.json'),
    scholarships: readData('scholarships.json'),
  }

  const removed = cleanPreviousWave(state)
  const importedStatic = importStaticCatalog(merged, state)
  state.universities = state.universities.map((university) => (
    archiveInstitutionSlugs.has(university.slug)
      ? { ...university, status: 'archived' }
      : university
  ))
  state.universityBySlug = new Map(state.universities.map((item) => [item.slug, item]))

  for (const slug of archiveInstitutionSlugs) {
    if (!state.universityBySlug.has(slug)) throw new Error(`Unknown archive institution slug: ${slug}`)
  }
  for (const candidate of merged.programCandidates) importProgram(candidate, state)
  for (const candidate of merged.scholarshipCandidates) importScholarship(candidate, state)
  const duplicateCleanup = {
    ...mergeLegacyDuplicatePrograms(state),
    ...mergeLegacyDuplicateScholarships(state),
  }
  const normalizedExpiredTuitionCycles = normalizeExpiredTuitionCycles(state)

  assertUnique(state.sources, 'id', 'source')
  assertUnique(state.cities, 'id', 'city')
  assertUnique(state.cities, 'slug', 'city')
  assertUnique(state.universities, 'id', 'university')
  assertUnique(state.universities, 'slug', 'university')
  assertUnique(state.programs, 'id', 'program')
  assertUnique(state.programs, 'slug', 'program')
  assertUnique(state.cycles, 'id', 'cycle')
  assertUnique(state.scholarships, 'id', 'scholarship')
  assertUnique(state.scholarships, 'slug', 'scholarship')

  const semanticProgramIdentities = new Map()
  for (const program of state.programs) {
    const key = [
      program.universityId,
      program.degreeLevel,
      normalizedName(program.name.en ?? program.name.zh),
    ].join(':')
    const existingId = semanticProgramIdentities.get(key)
    if (existingId) {
      throw new Error(`Duplicate semantic program identity ${key}: ${existingId}, ${program.id}`)
    }
    semanticProgramIdentities.set(key, program.id)
  }

  const validCityIds = new Set(state.cities.map((city) => city.id))
  for (const university of state.universities) {
    if (!validCityIds.has(university.cityId)) {
      throw new Error(`University ${university.slug} references missing city ${university.cityId}`)
    }
  }

  const programIdentityKeys = new Set()
  for (const candidate of merged.programCandidates) {
    const level = degreeLevel(candidate)
    const key = [
      candidate.institutionSlug,
      level,
      normalizedName(candidate.name?.en ?? candidate.name?.zh),
    ].join(':')
    if (programIdentityKeys.has(key)) throw new Error(`Merged program identity is duplicated: ${key}`)
    programIdentityKeys.add(key)
  }

  writeJson(path.join(dataDir, 'sources.json'), state.sources)
  writeJson(path.join(dataDir, 'cities.json'), state.cities)
  writeJson(path.join(dataDir, 'universities.json'), state.universities)
  writeJson(path.join(dataDir, 'programs.json'), state.programs)
  writeJson(path.join(dataDir, 'admission-cycles.json'), state.cycles)
  writeJson(path.join(dataDir, 'scholarships.json'), state.scholarships)

  console.log(JSON.stringify({
    mergedPath: path.relative(root, mergedPath),
    asOfDate: CATALOG_AS_OF_DATE,
    removedPreviousWave: removed,
    duplicateCleanup,
    normalizedExpiredTuitionCycles,
    archiveInstitutionSlugs: [...archiveInstitutionSlugs].sort(),
    imported: {
      ...importedStatic,
      programs: merged.programCandidates.length,
      scholarships: merged.scholarshipCandidates.length,
    },
    totals: {
      sources: state.sources.length,
      cities: state.cities.length,
      universities: state.universities.length,
      programs: state.programs.length,
      cycles: state.cycles.length,
      scholarships: state.scholarships.length,
    },
  }, null, 2))
}

main()
