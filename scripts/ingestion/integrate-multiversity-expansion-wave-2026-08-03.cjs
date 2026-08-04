const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const mergedPath = path.join(root, 'quality', 'official-gap-wave-2026-07-30', 'merged-candidates.json')
const waveDirectoryName = process.env.CANDIDATE_WAVE_DIRECTORY ?? 'multiversity-expansion-wave-2026-08-03'
const waveDir = path.join(root, 'quality', waveDirectoryName)
const packNames = (process.env.CANDIDATE_WAVE_PACKS ?? 'north-east.json,jiangzhehu.json,central-south-west.json')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const today = process.env.CANDIDATE_WAVE_DATE ?? '2026-08-03'
const auditKey = process.env.CANDIDATE_WAVE_AUDIT_KEY ?? 'multiUniversityWave20260803'
const schemaVersion = process.env.CANDIDATE_WAVE_SCHEMA_VERSION ?? '2026-08-03.merged.multiversity-expansion.v1'

if (!/^[a-z0-9][a-z0-9-]*$/i.test(waveDirectoryName)) {
  throw new Error('CANDIDATE_WAVE_DIRECTORY must be one directory name under quality/')
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
  throw new Error('CANDIDATE_WAVE_DATE must use YYYY-MM-DD')
}
if (!/^[A-Za-z][A-Za-z0-9]*$/.test(auditKey)) {
  throw new Error('CANDIDATE_WAVE_AUDIT_KEY must be a safe object key')
}
if (packNames.length === 0 || packNames.some((fileName) => (
  path.basename(fileName) !== fileName || !fileName.endsWith('.json')
))) {
  throw new Error('CANDIDATE_WAVE_PACKS must contain comma-separated JSON basenames')
}
const factStatuses = new Set([
  'known',
  'officially_not_announced',
  'not_applicable',
  'source_unavailable',
  'conflict',
  'stale',
])
const catalogRegions = new Set([
  "north",
  "northeast",
  "east",
  "south",
  "central",
  "southwest",
  "northwest",
])
const blockedSourceHosts = [
  'china-admissions.com',
  'cucas.cn',
  'bachelorsportal.com',
  'mastersportal.com',
  'scholarshipchina.com',
  'cscscholarship.org',
]

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\u0400-\u04ff]+/g, '')
}

function canonicalProgramSubject(candidate) {
  const text = [candidate.name?.en, candidate.name?.zh, candidate.name?.ru]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKC')
    .toLowerCase()
  const level = candidate.level ?? candidate.degreeLevel ?? 'other'

  if (level !== 'language') {
    if (/国际中文教育|汉语国际教育|teaching chinese to speakers|international chinese (?:language )?education|m?t?c?sol/.test(text)) {
      return 'international-chinese-education'
    }
    if (/汉语言文学|chinese language and literature|китайск\w* язык\w* и литератур/.test(text)) {
      return 'chinese-language-literature'
    }
    if (/商务汉语|business chinese|chinese for business/.test(text)) return 'business-chinese'
  }

  const english = normalizeText(candidate.name?.en)
    .replace(/bachelors?program|masters?program|doctoralprogram|doctorate|bachelor|master|phd|degree/g, '')
  return english || normalizeText(candidate.name?.zh)
}

function programKey(candidate) {
  return [
    candidate.institutionSlug,
    candidate.level ?? candidate.degreeLevel ?? 'other',
    canonicalProgramSubject(candidate),
  ].join('|')
}

function canonicalScholarshipSubject(candidate) {
  const text = [candidate.name?.en, candidate.name?.zh]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKC')
    .toLowerCase()
  if (/international chinese language teachers|国际中文教师|孔子学院奖学金/.test(text)) {
    return 'international-chinese-language-teachers-scholarship'
  }
  if (/chinese government scholarship|中国政府奖学金/.test(text)) {
    if (/silk road|一带一路|丝绸之路/.test(text)) return 'chinese-government-scholarship-silk-road'
    if (/high[- ]level postgraduate|高水平研究生/.test(text)) return 'chinese-government-scholarship-high-level-postgraduate'
    if (/bilateral|双边/.test(text)) return 'chinese-government-scholarship-bilateral'
    return 'chinese-government-scholarship'
  }
  return normalizeText(candidate.name?.en) || normalizeText(candidate.name?.zh)
}

function scholarshipKey(candidate) {
  return `${candidate.institutionSlug}|${canonicalScholarshipSubject(candidate)}`
}

function factKnown(value) {
  return value?.status === 'known'
}

function candidateScore(candidate) {
  return (factKnown(candidate.teachingLanguage) ? 16 : 0)
    + (factKnown(candidate.duration) ? 12 : 0)
    + (factKnown(candidate.tuition) ? 10 : 0)
    + (candidate.cycles?.length ?? 0) * 3
    + (candidate.additionalEvidence?.length ?? 0)
    + (candidate.qualityTier === 'A' ? 2 : 0)
}

function scholarshipScore(candidate) {
  return (factKnown(candidate.funding) ? 16 : 0)
    + (candidate.funding?.tiers?.length ?? 0) * 2
    + (candidate.cycles?.length ?? 0) * 3
    + (candidate.programCandidateIds?.length ?? 0)
    + (candidate.additionalEvidence?.length ?? 0)
    + (candidate.qualityTier === 'A' ? 2 : 0)
}

function evidenceUnion(primary, secondary) {
  const seen = new Set([primary.evidence?.officialUrl])
  const additionalEvidence = []
  for (const item of [
    ...(primary.additionalEvidence ?? []),
    secondary.evidence,
    ...(secondary.additionalEvidence ?? []),
  ]) {
    if (!item?.officialUrl || seen.has(item.officialUrl)) continue
    seen.add(item.officialUrl)
    additionalEvidence.push({
      officialUrl: item.officialUrl,
      sourceTitle: item.sourceTitle ?? 'Supporting official source',
    })
  }
  return additionalEvidence
}

function cycleKey(cycle) {
  return [cycle.academicYear, cycle.intake, cycle.applicationOpen, cycle.applicationDeadline].join('|')
}

function cycleUnion(left = [], right = []) {
  const byKey = new Map()
  for (const cycle of [...left, ...right]) {
    const key = cycleKey(cycle)
    const existing = byKey.get(key)
    if (!existing || (!existing.displayAsOpen && cycle.displayAsOpen)) byKey.set(key, cycle)
  }
  return [...byKey.values()].sort((a, b) => (
    String(a.applicationDeadline ?? '9999-99-99').localeCompare(String(b.applicationDeadline ?? '9999-99-99'))
  ))
}

function mergeProgram(left, right) {
  const primary = candidateScore(right) > candidateScore(left) ? right : left
  const secondary = primary === left ? right : left
  return {
    ...primary,
    // `left` is always the already-canonical record because existing catalog
    // candidates are ordered before a new wave. Preserve its stable public ID
    // even when the new source supplies richer facts.
    candidateId: left.candidateId,
    candidateIds: [...new Set([
      primary.candidateId,
      secondary.candidateId,
      ...(primary.candidateIds ?? []),
      ...(secondary.candidateIds ?? []),
    ])].sort(),
    teachingLanguage: factKnown(primary.teachingLanguage) ? primary.teachingLanguage : secondary.teachingLanguage,
    duration: factKnown(primary.duration) ? primary.duration : secondary.duration,
    tuition: factKnown(primary.tuition) ? primary.tuition : secondary.tuition,
    cycles: cycleUnion(primary.cycles, secondary.cycles),
    additionalEvidence: evidenceUnion(primary, secondary),
    sourceFiles: [...new Set([...(primary.sourceFiles ?? []), ...(secondary.sourceFiles ?? [])])].sort(),
    riskFlags: [...new Set([...(primary.riskFlags ?? []), ...(secondary.riskFlags ?? [])])],
  }
}

function mergeScholarship(left, right) {
  const primary = scholarshipScore(right) > scholarshipScore(left) ? right : left
  const secondary = primary === left ? right : left
  const tiers = [...new Set([...(primary.funding?.tiers ?? []), ...(secondary.funding?.tiers ?? [])])]
  return {
    ...primary,
    candidateId: left.candidateId,
    candidateIds: [...new Set([
      primary.candidateId,
      secondary.candidateId,
      ...(primary.candidateIds ?? []),
      ...(secondary.candidateIds ?? []),
    ])].sort(),
    applicableLevels: [...new Set([
      ...(primary.applicableLevels ?? []),
      ...(secondary.applicableLevels ?? []),
    ])],
    programCandidateIds: [...new Set([
      ...(primary.programCandidateIds ?? []),
      ...(secondary.programCandidateIds ?? []),
    ])],
    funding: {
      ...(factKnown(primary.funding) ? primary.funding : secondary.funding),
      status: tiers.length > 0 ? 'known' : primary.funding?.status ?? secondary.funding?.status,
      tiers,
    },
    cycles: cycleUnion(primary.cycles, secondary.cycles),
    additionalEvidence: evidenceUnion(primary, secondary),
    sourceFiles: [...new Set([...(primary.sourceFiles ?? []), ...(secondary.sourceFiles ?? [])])].sort(),
    riskFlags: [...new Set([...(primary.riskFlags ?? []), ...(secondary.riskFlags ?? [])])],
  }
}

function deduplicate(records, keyFor, merge) {
  const byKey = new Map()
  const aliases = new Map()
  const groups = []
  for (const record of records) {
    const key = keyFor(record)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, record)
      continue
    }
    const combined = merge(existing, record)
    byKey.set(key, combined)
    for (const candidateId of [
      ...(existing.candidateIds ?? [existing.candidateId]),
      ...(record.candidateIds ?? [record.candidateId]),
    ]) aliases.set(candidateId, combined.candidateId)
    aliases.set(existing.candidateId, combined.candidateId)
    aliases.set(record.candidateId, combined.candidateId)
    const mergedIds = [...new Set([existing.candidateId, record.candidateId])]
    if (mergedIds.length > 1) {
      groups.push({ key, kept: combined.candidateId, merged: mergedIds })
    }
  }
  return { records: [...byKey.values()], aliases, groups }
}

function resolveAlias(candidateId, aliases) {
  let current = candidateId
  const seen = new Set()
  while (aliases.has(current) && !seen.has(current)) {
    seen.add(current)
    current = aliases.get(current)
  }
  return current
}

function assertOfficialUrl(value, label) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} has an invalid official URL`)
  }
  if (url.protocol !== 'https:') throw new Error(`${label} has a non-HTTPS official URL`)
  if (blockedSourceHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error(`${label} uses a blocked aggregator source: ${url.hostname}`)
  }
}

function assertLocalizedName(name, label) {
  for (const locale of ['en', 'zh', 'ru']) {
    const value = name?.[locale]
    if (!value || /^[?？\s]+$/.test(value) || /待翻译|translation pending/i.test(value)) {
      throw new Error(`${label} has an invalid ${locale} name`)
    }
  }
}

function assertCycle(cycle, label) {
  if (cycle.applicationDeadline && cycle.applicationDeadline <= today && cycle.displayAsOpen) {
    throw new Error(`${label} exposes a closed deadline as open: ${cycle.applicationDeadline}`)
  }
  if (cycle.displayAsOpen && cycle.statusAsOfCheckedAt !== 'open') {
    throw new Error(`${label} has inconsistent open-cycle state`)
  }
}
function mergeStaticEntities(base, additions, kind) {
  const output = [...base]
  const byId = new Map(output.map((entity) => [entity.id, entity]))
  const bySlug = new Map(output.map((entity) => [entity.slug, entity]))
  for (const entity of additions) {
    const idMatch = byId.get(entity.id)
    const slugMatch = bySlug.get(entity.slug)
    if (idMatch && slugMatch && idMatch !== slugMatch) {
      throw new Error(`${kind} ${entity.id}/${entity.slug} conflicts with two canonical entities`)
    }
    const existing = idMatch ?? slugMatch
    if (!existing) {
      output.push(entity)
      byId.set(entity.id, entity)
      bySlug.set(entity.slug, entity)
      continue
    }
    const index = output.indexOf(existing)
    const mergedEntity = {
      ...existing,
      ...entity,
      id: existing.id,
      slug: existing.slug,
      sourceIds: [...new Set([...(existing.sourceIds ?? []), ...(entity.sourceIds ?? [])])],
    }
    output[index] = mergedEntity
    byId.set(mergedEntity.id, mergedEntity)
    bySlug.set(mergedEntity.slug, mergedEntity)
  }
  return output
}

function assertStaticCity(city) {
  const label = `city ${city.id ?? city.slug ?? '<missing-id>'}`
  if (!city.id || !city.slug) throw new Error(`${label} requires id and slug`)
  assertLocalizedName(city.name, label)
  if (!Array.isArray(city.sourceIds) || city.sourceIds.length === 0) throw new Error(`${label} requires sourceIds`)
  if (city.verifiedAt !== today) throw new Error(`${label} must be verified on ${today}`)
}

function assertStaticUniversity(university, cityIds) {
  const label = `university ${university.id ?? university.slug ?? '<missing-id>'}`
  if (!university.id || !university.slug) throw new Error(`${label} requires id and slug`)
  assertLocalizedName(university.name, label)
  assertOfficialUrl(university.officialUrl, label)
  if (university.admissionsUrl) assertOfficialUrl(university.admissionsUrl, `${label} admissionsUrl`)
  if (!cityIds.has(university.cityId)) throw new Error(`${label} references an unknown city: ${university.cityId}`)
  if (!catalogRegions.has(university.region)) throw new Error(`${label} has an invalid region: ${university.region}`)
  if (!Array.isArray(university.sourceIds) || university.sourceIds.length === 0) throw new Error(`${label} requires sourceIds`)
  if (university.verifiedAt !== today) throw new Error(`${label} must be verified on ${today}`)
}


function assertCandidate(candidate, kind, universitySlugs) {
  const label = `${kind} ${candidate.candidateId ?? '<missing-id>'}`
  if (!candidate.candidateId) throw new Error(`${label} is missing candidateId`)
  if (!universitySlugs.has(candidate.institutionSlug)) {
    throw new Error(`${label} references an unknown institution: ${candidate.institutionSlug}`)
  }
  assertLocalizedName(candidate.name, label)
  assertOfficialUrl(candidate.evidence?.officialUrl, label)
  for (const evidence of candidate.additionalEvidence ?? []) assertOfficialUrl(evidence.officialUrl, label)
  if (candidate.applicationUrl) assertOfficialUrl(candidate.applicationUrl, `${label} applicationUrl`)
  for (const fact of kind === 'program'
    ? [candidate.teachingLanguage, candidate.duration, candidate.tuition]
    : [candidate.funding]) {
    if (!factStatuses.has(fact?.status)) throw new Error(`${label} has an invalid fact status`)
  }
  for (const cycle of candidate.cycles ?? []) assertCycle(cycle, label)
}

function main() {
  const merged = readJson(mergedPath)
  const catalogUniversities = readJson(path.join(root, 'content', 'data', 'universities.json'))
  const catalogCities = readJson(path.join(root, 'content', 'data', 'cities.json'))
  const packs = packNames.map((fileName) => {
    const filePath = path.join(waveDir, fileName)
    if (!fs.existsSync(filePath)) throw new Error(`Missing multi-university pack: ${fileName}`)
    return { fileName, bundle: readJson(filePath) }
  })
  const rawNewCities = packs.flatMap(({ bundle }) => bundle.cities ?? [])
  const rawNewUniversities = packs.flatMap(({ bundle }) => bundle.universities ?? [])
  const mergedCities = mergeStaticEntities(merged.cities ?? [], rawNewCities, 'city')
  const mergedUniversities = mergeStaticEntities(merged.universities ?? [], rawNewUniversities, 'university')
  const cityIds = new Set([
    ...catalogCities.map((city) => city.id),
    ...mergedCities.map((city) => city.id),
  ])
  for (const city of rawNewCities) assertStaticCity(city)
  for (const university of rawNewUniversities) assertStaticUniversity(university, cityIds)
  const universitySlugs = new Set([
    ...catalogUniversities.map((university) => university.slug),
    ...mergedUniversities.map((university) => university.slug),
  ])
  const rawNewPrograms = packs.flatMap(({ bundle }) => bundle.programCandidates ?? bundle.programs ?? [])
  const quarantinedPrograms = rawNewPrograms.filter((candidate) => (
    candidate.recommendedAction === 'quarantine'
      || candidate.riskFlags?.includes('catalog_level_candidate_requires_major_reconciliation')
  ))
  const newPrograms = rawNewPrograms.filter((candidate) => !quarantinedPrograms.includes(candidate))
  const quarantinedProgramIds = new Set(quarantinedPrograms.map((item) => item.candidateId))
  const newScholarships = packs.flatMap(({ bundle }) => bundle.scholarshipCandidates ?? bundle.scholarships ?? [])

  const rawIds = new Set()
  for (const candidate of [...rawNewPrograms, ...newScholarships]) {
    if (rawIds.has(candidate.candidateId)) throw new Error(`Duplicate raw candidateId: ${candidate.candidateId}`)
    rawIds.add(candidate.candidateId)
  }
  for (const candidate of rawNewPrograms) assertCandidate(candidate, 'program', universitySlugs)
  for (const candidate of newScholarships) assertCandidate(candidate, 'scholarship', universitySlugs)

  const programResult = deduplicate([...merged.programCandidates, ...newPrograms], programKey, mergeProgram)
  const canonicalPrograms = new Map(programResult.records.map((item) => [item.candidateId, item]))
  const droppedScholarshipProgramReferences = []
  const scholarshipInput = [...merged.scholarshipCandidates, ...newScholarships].map((candidate) => {
    const programCandidateIds = []
    for (const candidateId of candidate.programCandidateIds ?? []) {
      if (quarantinedProgramIds.has(candidateId)) {
        droppedScholarshipProgramReferences.push({
          scholarshipCandidateId: candidate.candidateId,
          programCandidateId: candidateId,
        })
        continue
      }
      programCandidateIds.push(resolveAlias(candidateId, programResult.aliases))
    }
    return {
      ...candidate,
      programCandidateIds: [...new Set(programCandidateIds)],
    }
  })
  const scholarshipResult = deduplicate(scholarshipInput, scholarshipKey, mergeScholarship)

  for (const candidate of scholarshipResult.records) {
    for (const programCandidateId of candidate.programCandidateIds ?? []) {
      const program = canonicalPrograms.get(programCandidateId)
      if (!program || program.institutionSlug !== candidate.institutionSlug) {
        throw new Error(`${candidate.candidateId} has an invalid program reference: ${programCandidateId}`)
      }
    }
  }

  const newProgramIds = new Set(newPrograms.map((item) => item.candidateId))
  const newScholarshipIds = new Set(newScholarships.map((item) => item.candidateId))
  const output = {
    ...merged,
    cities: mergedCities.sort((left, right) => left.slug.localeCompare(right.slug)),
    universities: mergedUniversities.sort((left, right) => left.slug.localeCompare(right.slug)),
    schemaVersion,
    sourceFiles: [...new Set([
      ...merged.sourceFiles,
      ...packNames.map((fileName) => path
        .relative(path.dirname(mergedPath), path.join(waveDir, fileName))
        .replaceAll('\\', '/')),
    ])],
    programCandidates: programResult.records.sort((a, b) => (
      a.institutionSlug.localeCompare(b.institutionSlug) || a.name.en.localeCompare(b.name.en)
    )),
    scholarshipCandidates: scholarshipResult.records.sort((a, b) => (
      a.institutionSlug.localeCompare(b.institutionSlug) || a.name.en.localeCompare(b.name.en)
    )),
    mergeAudit: {
      ...merged.mergeAudit,
      [auditKey]: {
        rawCities: rawNewCities.length,
        rawUniversities: rawNewUniversities.length,
        rawPrograms: rawNewPrograms.length,
        publishablePrograms: newPrograms.length,
        quarantinedPrograms: quarantinedPrograms.map((item) => item.candidateId).sort(),
        rawScholarships: newScholarships.length,
        droppedScholarshipProgramReferences,
        representedProgramCandidates: programResult.records.filter((item) => (
          newProgramIds.has(item.candidateId)
            || item.candidateIds?.some((candidateId) => newProgramIds.has(candidateId))
        )).length,
        representedScholarshipCandidates: scholarshipResult.records.filter((item) => (
          newScholarshipIds.has(item.candidateId)
            || item.candidateIds?.some((candidateId) => newScholarshipIds.has(candidateId))
        )).length,
        programDuplicateGroups: programResult.groups,
        scholarshipDuplicateGroups: scholarshipResult.groups,
      },
    },
  }

  writeJson(mergedPath, output)
  console.log(JSON.stringify({
    output: path.relative(root, mergedPath),
    programs: output.programCandidates.length,
    scholarships: output.scholarshipCandidates.length,
    wave: output.mergeAudit[auditKey],
  }, null, 2))
}

main()
