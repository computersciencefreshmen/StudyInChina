const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const mergedPath = path.join(root, 'quality', 'official-gap-wave-2026-07-30', 'merged-candidates.json')
const waveDir = path.join(root, 'quality', 'chinese-language-wave-2026-08-02')
const packNames = ['core-degree-pack.json', 'north-east.json', 'south-west.json']

// The regional Guangzhou record has a current international-program catalogue,
// known teaching languages and a known duration. It supersedes the identity-only
// core record for the same master's degree.
const explicitProgramExclusions = new Set([
  'chinese-degree-gzhu-international-chinese-education-master',
])

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

  // These are terminology variants for the same degree identity, not fuzzy
  // guesses. Non-degree Chinese courses retain their complete normalized titles
  // so a four-week course is never collapsed into a one-year course.
  if (level !== 'language') {
    if (/国际中文教育|汉语国际教育|teaching chinese to speakers|international chinese (?:language )?education|m?t?c?sol/.test(text)) {
      return 'international-chinese-education'
    }
    if (/汉语言文学|chinese language and literature|китайск\w* язык\w* и литератур/.test(text)) {
      return 'chinese-language-literature'
    }
    if (/商务汉语|business chinese/.test(text)) return 'business-chinese'
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
  return [
    cycle.academicYear,
    cycle.intake,
    cycle.applicationOpen,
    cycle.applicationDeadline,
  ].join('|')
}

function cycleUnion(left = [], right = []) {
  const byKey = new Map()
  for (const cycle of [...left, ...right]) {
    const key = cycleKey(cycle)
    const existing = byKey.get(key)
    if (!existing || (!existing.displayAsOpen && cycle.displayAsOpen)) byKey.set(key, cycle)
  }
  return [...byKey.values()].sort((a, b) => (
    String(a.applicationDeadline ?? '9999-99-99')
      .localeCompare(String(b.applicationDeadline ?? '9999-99-99'))
  ))
}

function mergeProgram(left, right) {
  const primary = candidateScore(right) > candidateScore(left) ? right : left
  const secondary = primary === left ? right : left
  return {
    ...primary,
    candidateIds: [...new Set([
      ...(primary.candidateIds ?? [primary.candidateId]),
      ...(secondary.candidateIds ?? [secondary.candidateId]),
    ])].sort(),
    teachingLanguage: factKnown(primary.teachingLanguage)
      ? primary.teachingLanguage
      : secondary.teachingLanguage,
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
  const tiers = [...new Set([
    ...(primary.funding?.tiers ?? []),
    ...(secondary.funding?.tiers ?? []),
  ])]
  return {
    ...primary,
    candidateIds: [...new Set([
      ...(primary.candidateIds ?? [primary.candidateId]),
      ...(secondary.candidateIds ?? [secondary.candidateId]),
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
    ]) {
      aliases.set(candidateId, combined.candidateId)
    }
    aliases.set(existing.candidateId, combined.candidateId)
    aliases.set(record.candidateId, combined.candidateId)
    groups.push({ key, kept: combined.candidateId, merged: [existing.candidateId, record.candidateId] })
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

function assertHttps(candidate, kind) {
  const urls = [candidate.evidence?.officialUrl, ...(candidate.additionalEvidence ?? []).map((item) => item.officialUrl)]
  for (const url of urls) {
    if (!String(url ?? '').startsWith('https://')) {
      throw new Error(`${kind} ${candidate.candidateId} has a non-HTTPS evidence URL`)
    }
  }
}

function main() {
  const merged = readJson(mergedPath)
  const packs = packNames.map((fileName) => {
    const filePath = path.join(waveDir, fileName)
    if (!fs.existsSync(filePath)) throw new Error(`Missing Chinese-language pack: ${fileName}`)
    return { fileName, bundle: readJson(filePath) }
  })

  const newPrograms = packs.flatMap(({ bundle }) => (
    bundle.programCandidates ?? bundle.programs ?? []
  )).filter((candidate) => !explicitProgramExclusions.has(candidate.candidateId))
  const newScholarships = packs.flatMap(({ bundle }) => (
    bundle.scholarshipCandidates ?? bundle.scholarships ?? []
  ))

  const programResult = deduplicate(
    [...merged.programCandidates, ...newPrograms],
    programKey,
    mergeProgram,
  )
  const canonicalPrograms = new Map(programResult.records.map((item) => [item.candidateId, item]))

  const scholarshipInput = [...merged.scholarshipCandidates, ...newScholarships].map((candidate) => ({
    ...candidate,
    programCandidateIds: [...new Set((candidate.programCandidateIds ?? []).map(
      (candidateId) => resolveAlias(candidateId, programResult.aliases),
    ))],
  }))
  const scholarshipResult = deduplicate(scholarshipInput, scholarshipKey, mergeScholarship)

  for (const candidate of programResult.records) assertHttps(candidate, 'program')
  for (const candidate of scholarshipResult.records) {
    assertHttps(candidate, 'scholarship')
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
    schemaVersion: '2026-08-02.merged.chinese-language.v1',
    sourceFiles: [...new Set([
      ...merged.sourceFiles,
      ...packNames.map((fileName) => `../chinese-language-wave-2026-08-02/${fileName}`),
    ])],
    programCandidates: programResult.records.sort((a, b) => (
      a.institutionSlug.localeCompare(b.institutionSlug)
        || a.name.en.localeCompare(b.name.en)
    )),
    scholarshipCandidates: scholarshipResult.records.sort((a, b) => (
      a.institutionSlug.localeCompare(b.institutionSlug)
        || a.name.en.localeCompare(b.name.en)
    )),
    mergeAudit: {
      ...merged.mergeAudit,
      chineseLanguageWave: {
        rawPrograms: newPrograms.length,
        rawScholarships: newScholarships.length,
        publishedProgramCandidates: programResult.records.filter((item) => (
          newProgramIds.has(item.candidateId)
            || item.candidateIds?.some((candidateId) => newProgramIds.has(candidateId))
        )).length,
        publishedScholarshipCandidates: scholarshipResult.records.filter((item) => (
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
    chineseLanguageWave: output.mergeAudit.chineseLanguageWave,
  }, null, 2))
}

main()
