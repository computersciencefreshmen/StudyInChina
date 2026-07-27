import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CHECKED_AT = '2026-07-27'
const DEFAULT_TARGET_COUNT = 100
const DEFAULT_MAX_PER_INSTITUTION = 3
const EXCLUDED_INSTITUTION_IDS = new Set([
  'uni-peking-university',
  'uni-tsinghua-university',
  'uni-zhejiang-university',
])
const EXCLUDED_INSTITUTION_NAMES = new Set([
  '北京大学',
  '清华大学',
  '浙江大学',
])

type JsonRecord = Record<string, unknown>

type CoverageInstitution = {
  ordinal: number
  targetId: string
  institutionId: string | null
  nameZh: string
  nameEn: string | null
  province: string | null
  status: string
  sources: Array<{
    category: string
    officialUrl: string
  }>
}

type CoverageDocument = {
  institutions: CoverageInstitution[]
}

type ReviewRecord = {
  institutionId: string
  institutionZh: string
  institutionEn: string
  institutionRu: string
  cityZh: string
  cityEn: string
  cityRu: string
  province: string
  targetOrdinal: number
  programNameOriginal: string
  programNameEn: string
  programNameRu: string
  programType: string
  degreeLevel: string
  teachingLanguage: string
  intake: string
  applicationOpen: string | null
  applicationOpenStatus: 'known' | 'officially_not_announced'
  deadline: string | null
  deadlineStatus: 'known' | 'rolling' | 'officially_not_announced' | 'expired'
  cycleStatus: string
  publicationTier: 'cycle_ready' | 'program_identity_only'
  internationalEligibilityEvidence: string
  individualApplicationEvidence: string
  officialUrl: string
  catalogUrl: string
  checkedAt: string
  evidenceStatus: 'verified'
  sourceFile: string
}

type ReviewExclusion = {
  institutionZh: string
  programName: string
  reason: string
  sourceUrl: string | null
  sourceFile: string
}

function parseJson(value: string): unknown {
  return JSON.parse(value.replace(/^\uFEFF/u, ''))
}

function object(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableText(value: unknown): string | null {
  const normalized = text(value)
  return normalized || null
}

function dateOnly(value: unknown): string | null {
  const normalized = nullableText(value)
  if (!normalized) return null
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) return null
  const parsed = new Date(`${normalized}T00:00:00.000Z`)
  return Number.isNaN(parsed.valueOf()) ? null : normalized
}

function httpsUrl(value: unknown): string | null {
  const normalized = nullableText(value)
  if (!normalized) return null
  try {
    const parsed = new URL(normalized)
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.port
    ) return null
    parsed.hash = ''
    return parsed.href
  } catch {
    return null
  }
}

function stableInstitutionId(
  institution: CoverageInstitution,
  fallbackName?: string,
): string {
  if (institution.institutionId) return institution.institutionId
  const slug = (fallbackName || institution.nameEn || institution.nameZh)
    .normalize('NFKD')
    .toLocaleLowerCase('en')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return slug ? `uni-${slug}` : institution.targetId
}

function registrableInstitutionDomain(hostname: string): string {
  const parts = hostname.toLocaleLowerCase('en').split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  const suffix = parts.slice(-2).join('.')
  if (suffix === 'edu.cn' || suffix === 'ac.cn') {
    return parts.slice(-3).join('.')
  }
  return parts.slice(-2).join('.')
}

function isOfficialInstitutionUrl(
  value: string,
  institution: CoverageInstitution,
): boolean {
  let candidateHost: string
  try {
    candidateHost = new URL(value).hostname.toLocaleLowerCase('en')
  } catch {
    return false
  }
  const candidateDomain = registrableInstitutionDomain(candidateHost)
  return institution.sources.some((source) => {
    const officialUrl = httpsUrl(source.officialUrl)
    if (!officialUrl) return false
    const officialHost = new URL(officialUrl).hostname.toLocaleLowerCase('en')
    return (
      candidateHost === officialHost
      || candidateHost.endsWith(`.${officialHost}`)
      || officialHost.endsWith(`.${candidateHost}`)
      || candidateDomain === registrableInstitutionDomain(officialHost)
    )
  })
}

function isGenericDegreeProgramName(
  programName: string,
  programType: string,
): boolean {
  if (programType.toLocaleLowerCase('en') !== 'degree') return false
  const normalized = programName
    .toLocaleLowerCase('en')
    .replace(/[’']/gu, '')
    .replace(/[\p{P}\p{S}_]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return [
    /^(?:international )?(?:undergraduate|bachelors?|masters?|doctoral|doctorate|phd) (?:degree )?programs?(?: for international students)?$/u,
    /^(?:chinese|english)(?: taught)? (?:undergraduate|bachelors?|masters?|doctoral|doctorate|phd) (?:degree )?programs?$/u,
    /^(?:undergraduate|bachelors?|masters?|doctoral|doctorate|phd) programs? for international students$/u,
  ].some((pattern) => pattern.test(normalized))
}

function canonicalProgramKey(record: ReviewRecord): string {
  const name = record.programNameOriginal
    .toLocaleLowerCase('en')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
  return `${record.institutionId}|${name}|${record.intake.toLocaleLowerCase('en')}`
}

function normalizeDegreeLevel(value: unknown): string {
  const level = text(value).toLocaleLowerCase('en').replace(/[._-]+/g, ' ').trim()
  if (!level || level === 'not applicable' || level === 'non degree') {
    return 'not_applicable'
  }
  if (level.includes('bachelor') || level.includes('undergraduate')) return 'bachelor'
  if (level.includes('master')) return 'master'
  if (
    level.includes('doctor')
    || level.includes('phd')
    || level.includes('ph d')
  ) return 'doctorate'
  return level.replace(/\s+/g, '_')
}

function normalizeProgramType(value: unknown, degreeLevel: string): string {
  const type = text(value).toLocaleLowerCase('en').replace(/[._-]+/gu, ' ').trim()
  if (/degree|bachelor|undergraduate|master|doctor|ph\s*d/iu.test(type)) {
    return 'degree'
  }
  if (/language|chinese/iu.test(type)) return 'language'
  if (/foundation|preparator/iu.test(type)) return 'foundation'
  if (/visit/iu.test(type)) return 'visiting'
  if (/exchange/iu.test(type)) return 'exchange'
  if (/short|summer|winter/iu.test(type)) return 'short_term'
  if (type) return type.replace(/\s+/gu, '_')
  return degreeLevel === 'not_applicable' ? 'short_term' : 'degree'
}

function publicationTier(
  cycleStatus: string,
  deadline: string | null,
): ReviewRecord['publicationTier'] {
  const status = cycleStatus.toLocaleLowerCase('en')
  if (
    status.includes('closed')
    || status.includes('expired')
    || status.includes('ended')
  ) return 'program_identity_only'
  if (deadline && deadline >= CHECKED_AT) return 'cycle_ready'
  if (
    status.includes('open')
    || status.includes('future')
    || status.includes('rolling')
    || status.includes('active')
    || status.includes('current')
  ) return 'cycle_ready'
  return 'program_identity_only'
}

function normalizeCandidate(
  raw: unknown,
  sourceFile: string,
  coverageByName: Map<string, CoverageInstitution>,
  coverageById: Map<string, CoverageInstitution>,
): { record: ReviewRecord | null; exclusion: ReviewExclusion | null } {
  let candidate: JsonRecord
  try {
    candidate = object(raw, `${sourceFile}.record`)
  } catch (error) {
    return {
      record: null,
      exclusion: {
        institutionZh: '',
        programName: '',
        reason: error instanceof Error ? error.message : 'invalid_record',
        sourceUrl: null,
        sourceFile,
      },
    }
  }

  const institutionZh = text(candidate.institutionZh)
  const suppliedInstitutionId = text(candidate.institutionId)
  const institution = (
    coverageById.get(suppliedInstitutionId)
    ?? coverageByName.get(institutionZh)
  )
  const programNameOriginal = (
    text(candidate.programNameOriginal)
    || text(candidate.programNameEn)
  )
  const programNameEn = text(candidate.programNameEn) || programNameOriginal
  const degreeLevel = normalizeDegreeLevel(candidate.degreeLevel)
  const programType = normalizeProgramType(candidate.programType, degreeLevel)
  const officialUrl = httpsUrl(candidate.officialUrl)
  const submittedCatalogUrl = httpsUrl(candidate.catalogUrl)
  const exclusionBase = {
    institutionZh,
    programName: programNameOriginal,
    sourceUrl: officialUrl,
    sourceFile,
  }

  if (!institution) {
    return {
      record: null,
      exclusion: { ...exclusionBase, reason: 'institution_not_in_official_target_registry' },
    }
  }
  if (
    institution.status !== 'source_manifest_complete'
    || EXCLUDED_INSTITUTION_IDS.has(institution.institutionId ?? '')
    || EXCLUDED_INSTITUTION_NAMES.has(institution.nameZh)
  ) {
    return {
      record: null,
      exclusion: { ...exclusionBase, reason: 'institution_outside_first_batch_policy' },
    }
  }
  if (!programNameOriginal) {
    return {
      record: null,
      exclusion: { ...exclusionBase, reason: 'program_name_missing' },
    }
  }
  if (
    isGenericDegreeProgramName(programNameOriginal, programType)
    || isGenericDegreeProgramName(programNameEn, programType)
  ) {
    return {
      record: null,
      exclusion: { ...exclusionBase, reason: 'generic_degree_catalog_not_concrete_program' },
    }
  }
  if (!officialUrl) {
    return {
      record: null,
      exclusion: { ...exclusionBase, reason: 'official_https_evidence_missing' },
    }
  }
  if (!isOfficialInstitutionUrl(officialUrl, institution)) {
    return {
      record: null,
      exclusion: { ...exclusionBase, reason: 'source_domain_not_registered_official' },
    }
  }
  const catalogUrl = (
    submittedCatalogUrl
    && isOfficialInstitutionUrl(submittedCatalogUrl, institution)
  ) ? submittedCatalogUrl : officialUrl
  const internationalEvidence = text(candidate.internationalEligibilityEvidence)
  const individualEvidence = text(candidate.individualApplicationEvidence)
  if (!internationalEvidence || !individualEvidence) {
    return {
      record: null,
      exclusion: { ...exclusionBase, reason: 'international_or_individual_eligibility_unproven' },
    }
  }
  const evidenceStatus = text(candidate.evidenceStatus).toLocaleLowerCase('en')
  const evidenceVerified = (
    evidenceStatus === 'verified'
    || evidenceStatus.startsWith('verified_')
    || evidenceStatus.startsWith('official_verified')
    || evidenceStatus.startsWith('official_program_identity_')
  )
  if (!evidenceVerified) {
    return {
      record: null,
      exclusion: { ...exclusionBase, reason: 'evidence_status_not_verified' },
    }
  }

  const deadline = dateOnly(candidate.deadline)
  const applicationOpen = dateOnly(candidate.applicationOpen)
  const cycleStatus = text(candidate.cycleStatus) || 'program_identity_verified'
  const tier = publicationTier(cycleStatus, deadline)
  const deadlineStatus = deadline
    ? (deadline >= CHECKED_AT ? 'known' : 'expired')
    : (
        cycleStatus.toLocaleLowerCase('en').includes('rolling')
          ? 'rolling'
          : 'officially_not_announced'
      )

  return {
    exclusion: null,
    record: {
      institutionId: stableInstitutionId(institution, text(candidate.institutionEn)),
      institutionZh: institution.nameZh,
      institutionEn: (
        text(candidate.institutionEn)
        || institution.nameEn
        || institution.nameZh
      ),
      institutionRu: (
        text(candidate.institutionRu)
        || text(candidate.institutionEn)
        || institution.nameEn
        || institution.nameZh
      ),
      cityZh: text(candidate.cityZh),
      cityEn: text(candidate.cityEn),
      cityRu: text(candidate.cityRu),
      province: text(candidate.province) || institution.province || '',
      targetOrdinal: institution.ordinal,
      programNameOriginal,
      programNameEn,
      programNameRu: text(candidate.programNameRu) || programNameEn,
      programType,
      degreeLevel,
      teachingLanguage: text(candidate.teachingLanguage) || 'source_language',
      intake: text(candidate.intake) || 'not_applicable',
      applicationOpen,
      applicationOpenStatus: applicationOpen
        ? 'known'
        : 'officially_not_announced',
      deadline,
      deadlineStatus,
      cycleStatus,
      publicationTier: tier,
      internationalEligibilityEvidence: internationalEvidence.slice(0, 400),
      individualApplicationEvidence: individualEvidence.slice(0, 400),
      officialUrl,
      catalogUrl,
      checkedAt: text(candidate.checkedAt) || CHECKED_AT,
      evidenceStatus: 'verified',
      sourceFile,
    },
  }
}

function normalizeAgentExclusion(
  raw: unknown,
  sourceFile: string,
): ReviewExclusion {
  const candidate = object(raw, `${sourceFile}.exclusion`)
  return {
    institutionZh: text(
      candidate.institutionZh
      ?? candidate.institution
      ?? candidate.school,
    ),
    programName: text(
      candidate.programName
      ?? candidate.programNameOriginal
      ?? candidate.name,
    ),
    reason: text(candidate.reason) || 'agent_excluded',
    sourceUrl: httpsUrl(
      candidate.sourceUrl
      ?? candidate.officialUrl
      ?? candidate.catalogUrl,
    ),
    sourceFile,
  }
}

function selectBroadBatch(
  candidates: ReviewRecord[],
  targetCount: number,
  maxPerInstitution: number,
): { selected: ReviewRecord[]; reserve: ReviewRecord[]; exclusions: ReviewExclusion[] } {
  const deduplicated = new Map<string, ReviewRecord>()
  const exclusions: ReviewExclusion[] = []
  for (const candidate of candidates.sort((left, right) => (
    left.targetOrdinal - right.targetOrdinal
    || left.programNameOriginal.localeCompare(right.programNameOriginal, 'en')
  ))) {
    const key = canonicalProgramKey(candidate)
    if (deduplicated.has(key)) {
      exclusions.push({
        institutionZh: candidate.institutionZh,
        programName: candidate.programNameOriginal,
        reason: 'duplicate_program_candidate',
        sourceUrl: candidate.officialUrl,
        sourceFile: candidate.sourceFile,
      })
      continue
    }
    deduplicated.set(key, candidate)
  }

  const groups = new Map<string, ReviewRecord[]>()
  for (const candidate of deduplicated.values()) {
    const group = groups.get(candidate.institutionId) ?? []
    if (group.length >= maxPerInstitution) {
      exclusions.push({
        institutionZh: candidate.institutionZh,
        programName: candidate.programNameOriginal,
        reason: `per_institution_cap_${maxPerInstitution}`,
        sourceUrl: candidate.officialUrl,
        sourceFile: candidate.sourceFile,
      })
      continue
    }
    group.push(candidate)
    groups.set(candidate.institutionId, group)
  }

  const selected: ReviewRecord[] = []
  for (let pass = 0; pass < maxPerInstitution; pass += 1) {
    for (const group of groups.values()) {
      const candidate = group[pass]
      if (!candidate || selected.length >= targetCount) continue
      selected.push(candidate)
    }
  }
  const selectedKeys = new Set(selected.map(canonicalProgramKey))
  const reserve = [...groups.values()]
    .flat()
    .filter((candidate) => !selectedKeys.has(canonicalProgramKey(candidate)))
  return { selected, reserve, exclusions }
}

function parseArguments(arguments_: string[]): {
  coveragePath: string
  inputDirectories: string[]
  outputPath: string
  targetCount: number
  maxPerInstitution: number
} {
  const values = new Map<string, string>()
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index]
    const value = arguments_[index + 1]
    if (!key?.startsWith('--') || !value) {
      throw new Error('Arguments must use --key value pairs')
    }
    values.set(key.slice(2), value)
  }
  return {
    coveragePath: resolve(
      values.get('coverage')
      ?? 'src/data/generated/double-first-class-coverage.json',
    ),
    inputDirectories: (
      values.get('input')
      ?? '.pipeline-build/first100'
    ).split(',').map((directory) => resolve(directory.trim())),
    outputPath: resolve(
      values.get('output')
      ?? 'quality/international-program-review/first-100-2026-07-26.json',
    ),
    targetCount: Number(values.get('target') ?? DEFAULT_TARGET_COUNT),
    maxPerInstitution: Number(
      values.get('max-per-institution')
      ?? DEFAULT_MAX_PER_INSTITUTION,
    ),
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const coverage = parseJson(
    await readFile(options.coveragePath, 'utf8'),
  ) as CoverageDocument
  const coverageByName = new Map(
    coverage.institutions.map((institution) => [institution.nameZh, institution]),
  )
  const coverageById = new Map(
    coverage.institutions.map((institution) => [
      stableInstitutionId(institution),
      institution,
    ]),
  )

  const sourceFiles = (
    await Promise.all(options.inputDirectories.map(async (inputDirectory) => (
      (await readdir(inputDirectory))
        .filter((fileName) => fileName.endsWith('.json'))
        .map((fileName) => ({
          inputDirectory,
          fileName,
          sourceFile: `${basename(inputDirectory)}/${fileName}`,
        }))
    )))
  ).flat().sort((left, right) => (
    left.sourceFile.localeCompare(right.sourceFile, 'en')
  ))
  if (sourceFiles.length === 0) {
    throw new Error(
      `No JSON review inputs found in ${options.inputDirectories.join(', ')}`,
    )
  }

  const candidates: ReviewRecord[] = []
  const exclusions: ReviewExclusion[] = []
  let inputCandidateCount = 0
  for (const source of sourceFiles) {
    const { inputDirectory, fileName, sourceFile } = source
    const document = object(
      parseJson(await readFile(join(inputDirectory, fileName), 'utf8')),
      sourceFile,
    )
    const rawRecords = Array.isArray(document.records) ? document.records : []
    const rawExclusions = Array.isArray(document.exclusions)
      ? document.exclusions
      : []
    inputCandidateCount += rawRecords.length
    for (const rawRecord of rawRecords) {
      const normalized = normalizeCandidate(
        rawRecord,
        sourceFile,
        coverageByName,
        coverageById,
      )
      if (normalized.record) candidates.push(normalized.record)
      if (normalized.exclusion) exclusions.push(normalized.exclusion)
    }
    for (const rawExclusion of rawExclusions) {
      exclusions.push(normalizeAgentExclusion(rawExclusion, sourceFile))
    }
  }

  const selection = selectBroadBatch(
    candidates,
    options.targetCount,
    options.maxPerInstitution,
  )
  exclusions.push(...selection.exclusions)
  const cycleReady = selection.selected.filter(
    (record) => record.publicationTier === 'cycle_ready',
  ).length
  const institutions = new Set(
    selection.selected.map((record) => record.institutionId),
  )
  const output = {
    format: 'studyinchina.international-program-review',
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    checkedAt: CHECKED_AT,
    reviewStatus: 'candidate_not_published',
    policy: {
      officialSourcesOnly: true,
      internationalEligibilityRequired: true,
      individualApplicationRequired: true,
      excludedInstitutions: [...EXCLUDED_INSTITUTION_NAMES],
      targetCount: options.targetCount,
      maxPerInstitution: options.maxPerInstitution,
      selectionMethod: 'institution_round_robin',
    },
    summary: {
      inputFiles: sourceFiles.length,
      inputCandidates: inputCandidateCount,
      normalizedVerifiedCandidates: candidates.length,
      selectedRecords: selection.selected.length,
      selectedInstitutions: institutions.size,
      cycleReady,
      programIdentityOnly: selection.selected.length - cycleReady,
      reserveRecords: selection.reserve.length,
      exclusions: exclusions.length,
      targetMet: selection.selected.length >= options.targetCount,
    },
    records: selection.selected,
    reserve: selection.reserve,
    exclusions,
  }
  await mkdir(dirname(options.outputPath), { recursive: true })
  await writeFile(
    options.outputPath,
    `${JSON.stringify(output, null, 2)}\n`,
    'utf8',
  )
  console.log(JSON.stringify({
    outputPath: options.outputPath,
    ...output.summary,
  }))
  if (!output.summary.targetMet) process.exitCode = 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

export {
  canonicalProgramKey,
  isGenericDegreeProgramName,
  isOfficialInstitutionUrl,
  normalizeCandidate,
  publicationTier,
  selectBroadBatch,
}
