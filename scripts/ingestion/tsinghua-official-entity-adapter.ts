import {
  TSINGHUA_CATALOG_QUERY_URL,
} from './tsinghua-catalog-harvester'
import {
  type EnrichedTsinghuaCatalog,
  type EnrichedTsinghuaProgram,
  type TsinghuaFactStatus,
  type TsinghuaFieldMeta,
  summarizeTsinghuaDetails,
} from './tsinghua-program-detail-adapter'

type JsonRecord = Record<string, unknown>
type DegreeLevel = 'master' | 'doctorate'
type AttendanceMode = 'full_time' | 'part_time'
type InstructionLanguage = 'Chinese' | 'English'
type Evidence = {
  locatorType: 'json_pointer'
  locator: string
  quote: string
  officialUrl: string
  checkedAt: string
  fieldPaths: string[]
}
type ParsedFact<T> = {
  value: T | null
  status: TsinghuaFactStatus
  meta: TsinghuaFieldMeta
}

const OFFICIAL_HOST = 'yzbm.tsinghua.edu.cn'
const INSTITUTION_ID = 'uni-tsinghua-university'
const MAX_RESEARCH_DIRECTIONS_JSON_BYTES = 6_000
const FACT_STATUSES = new Set<TsinghuaFactStatus>([
  'known',
  'officially_not_announced',
  'not_applicable',
  'source_unavailable',
  'conflict',
  'stale',
])

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function optionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return text(value, label)
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return value
}

function timestamp(value: unknown, label: string): string {
  const raw = text(value, label)
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be an ISO timestamp`)
  return parsed.toISOString()
}

function officialUrl(value: unknown, label: string): string {
  let parsed: URL
  try {
    parsed = new URL(text(value, label))
  } catch {
    throw new Error(`${label} must be a valid official Tsinghua HTTPS URL`)
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname.toLowerCase() !== OFFICIAL_HOST
    || parsed.username
    || parsed.password
    || parsed.port
  ) {
    throw new Error(`${label} must use the exact https://${OFFICIAL_HOST} host`)
  }
  parsed.hash = ''
  return parsed.href
}

function normalizedKeyPart(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  if (!normalized) throw new Error(`Cannot build a stable key from ${JSON.stringify(value)}`)
  return normalized
}

function degreeLevel(value: unknown, label: string): DegreeLevel {
  if (value !== 'master' && value !== 'doctorate') {
    throw new Error(`${label} must be master or doctorate`)
  }
  return value
}

function fact<T>(input: {
  value: unknown
  label: string
  parse: (value: unknown, label: string) => T
  catalogUrl: string
  checkedAt: string
}): ParsedFact<T> {
  const root = record(input.value, input.label)
  const meta = record(root.fieldMeta, `${input.label}.fieldMeta`)
  const status = text(meta.status, `${input.label}.fieldMeta.status`) as TsinghuaFactStatus
  if (!FACT_STATUSES.has(status)) {
    throw new Error(`${input.label}.fieldMeta.status is unsupported`)
  }
  const metaUrl = officialUrl(meta.officialUrl, `${input.label}.fieldMeta.officialUrl`)
  if (metaUrl !== input.catalogUrl) {
    throw new Error(`${input.label}.fieldMeta.officialUrl conflicts with the catalog`)
  }
  const metaCheckedAt = timestamp(meta.checkedAt, `${input.label}.fieldMeta.checkedAt`)
  if (metaCheckedAt !== input.checkedAt) {
    throw new Error(`${input.label}.fieldMeta.checkedAt conflicts with the catalog`)
  }
  const sourceTitle = text(meta.sourceTitle, `${input.label}.fieldMeta.sourceTitle`)
  const rawValue = root.value
  if (status === 'known' && (rawValue === null || rawValue === undefined)) {
    throw new Error(`${input.label} is known but has no value`)
  }
  if (status !== 'known' && rawValue !== null) {
    throw new Error(`${input.label} with status ${status} must have a null value`)
  }
  const locator = optionalText(meta.locator, `${input.label}.fieldMeta.locator`)
  const quote = optionalText(meta.quote, `${input.label}.fieldMeta.quote`)
  if (status === 'known' && (!locator || !quote)) {
    throw new Error(`${input.label} known facts require an exact locator and quote`)
  }
  return {
    value: status === 'known'
      ? input.parse(rawValue, `${input.label}.value`)
      : null,
    status,
    meta: {
      status,
      officialUrl: metaUrl,
      sourceTitle,
      checkedAt: metaCheckedAt,
      ...(locator ? { locator } : {}),
      ...(quote ? { quote } : {}),
    },
  }
}

function stringValue(value: unknown, label: string): string {
  return text(value, label)
}

function attendanceValue(value: unknown, label: string): AttendanceMode {
  if (value !== 'full_time' && value !== 'part_time') {
    throw new Error(`${label} must be full_time or part_time`)
  }
  return value
}

function languageValues(value: unknown, label: string): InstructionLanguage[] {
  const values = array(value, label)
  if (values.length === 0) throw new Error(`${label} must not be empty`)
  const normalized = values.map((item, index) => {
    if (item !== 'Chinese' && item !== 'English') {
      throw new Error(`${label}[${index}] must be Chinese or English`)
    }
    return item
  })
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right, 'en'))
}

function localizedValue(
  value: unknown,
  label: string,
): { zh: string | null; en: string | null } {
  const localized = record(value, label)
  const zh = optionalText(localized['zh-CN'], `${label}.zh-CN`)
  const en = optionalText(localized.en, `${label}.en`)
  if (!zh && !en) throw new Error(`${label} must contain zh-CN or en`)
  return { zh, en }
}

function evidenceFromFact<T>(
  parsed: ParsedFact<T>,
  fieldPaths: string[],
): Evidence | null {
  if (parsed.status !== 'known') return null
  return {
    locatorType: 'json_pointer',
    locator: parsed.meta.locator!,
    quote: parsed.meta.quote!,
    officialUrl: parsed.meta.officialUrl,
    checkedAt: parsed.meta.checkedAt,
    fieldPaths,
  }
}

function deduplicateEvidence(values: Array<Evidence | null>): Evidence[] {
  const unique = new Map<string, Evidence>()
  for (const value of values) {
    if (!value) continue
    const key = JSON.stringify([
      value.locator,
      value.quote,
      value.officialUrl,
      value.checkedAt,
      [...value.fieldPaths].sort(),
    ])
    unique.set(key, value)
  }
  return [...unique.values()].sort((left, right) => (
    `${left.locator}\u0000${left.fieldPaths.join(',')}`.localeCompare(
      `${right.locator}\u0000${right.fieldPaths.join(',')}`,
      'en',
    )
  ))
}

function baseEvidence(
  entity: JsonRecord,
  label: string,
  catalogUrl: string,
  checkedAt: string,
): Evidence {
  const evidence = record(entity.evidence, `${label}.evidence`)
  const evidenceUrl = officialUrl(evidence.officialUrl, `${label}.evidence.officialUrl`)
  if (evidenceUrl !== catalogUrl) {
    throw new Error(`${label}.evidence.officialUrl conflicts with the catalog`)
  }
  const evidenceCheckedAt = timestamp(evidence.checkedAt, `${label}.evidence.checkedAt`)
  if (evidenceCheckedAt !== checkedAt) {
    throw new Error(`${label}.evidence.checkedAt conflicts with the catalog`)
  }
  return {
    locatorType: 'json_pointer',
    locator: text(evidence.locator, `${label}.evidence.locator`),
    quote: text(evidence.quote, `${label}.evidence.quote`),
    officialUrl: evidenceUrl,
    checkedAt: evidenceCheckedAt,
    fieldPaths: ['official_url', 'program_type', 'degree_level'],
  }
}

function adaptProgram(input: {
  value: unknown
  index: number
  catalogUrl: string
  checkedAt: string
  degreeLevel: DegreeLevel
}): JsonRecord {
  const label = `input.entities[${input.index}]`
  const entity = record(input.value, label)
  if (
    entity.entityType !== 'program'
    || entity.institutionId !== INSTITUTION_ID
    || entity.programType !== 'degree'
  ) {
    throw new Error(`${label} must be a Tsinghua degree program`)
  }
  if (degreeLevel(entity.degreeLevel, `${label}.degreeLevel`) !== input.degreeLevel) {
    throw new Error(`${label}.degreeLevel conflicts with the catalog`)
  }
  const department = record(entity.department, `${label}.department`)
  const departmentCode = text(department.code, `${label}.department.code`)
  const majorCode = text(entity.majorCode, `${label}.majorCode`)
  const entityKey = text(entity.entityKey, `${label}.entityKey`)
  const expectedKey = [
    'tsinghua',
    input.degreeLevel,
    normalizedKeyPart(departmentCode),
    normalizedKeyPart(majorCode),
  ].join(':')
  if (entityKey !== expectedKey) {
    throw new Error(`${label}.entityKey must be derived from degree, department, and major codes`)
  }
  const entityUrl = officialUrl(entity.officialUrl, `${label}.officialUrl`)
  if (entityUrl !== input.catalogUrl) {
    throw new Error(`${label}.officialUrl conflicts with the catalog`)
  }
  if (officialUrl(entity.officialEndpoint, `${label}.officialEndpoint`)
    !== officialUrl(TSINGHUA_CATALOG_QUERY_URL, 'TSINGHUA_CATALOG_QUERY_URL')) {
    throw new Error(`${label}.officialEndpoint conflicts with the registered query endpoint`)
  }
  const entityCheckedAt = timestamp(entity.sourceCheckedAt, `${label}.sourceCheckedAt`)
  if (entityCheckedAt !== input.checkedAt) {
    throw new Error(`${label}.sourceCheckedAt conflicts with the catalog`)
  }
  const details = record(entity.details, `${label}.details`)
  const localizations = record(details.localizations, `${label}.details.localizations`)
  const nameZh = fact({
    value: localizations['zh-CN'],
    label: `${label}.details.localizations.zh-CN`,
    parse: stringValue,
    catalogUrl: input.catalogUrl,
    checkedAt: input.checkedAt,
  })
  const nameEn = fact({
    value: localizations.en,
    label: `${label}.details.localizations.en`,
    parse: stringValue,
    catalogUrl: input.catalogUrl,
    checkedAt: input.checkedAt,
  })
  if (!nameZh.value && !nameEn.value) {
    throw new Error(`${label} has no known official program name`)
  }
  const rawNameZh = optionalText(entity.nameZh, `${label}.nameZh`)
  const rawNameEn = optionalText(entity.nameEn, `${label}.nameEn`)
  if (rawNameZh && nameZh.value !== rawNameZh) {
    throw new Error(`${label}.details Chinese name conflicts with the identity harvest`)
  }
  if (rawNameEn && nameEn.value !== rawNameEn) {
    throw new Error(`${label}.details English name conflicts with the identity harvest`)
  }

  const tracks = array(details.tracks, `${label}.details.tracks`)
  const declaredTrackCount = integer(
    entity.researchDirectionCount,
    `${label}.researchDirectionCount`,
  )
  if (declaredTrackCount !== tracks.length) {
    throw new Error(`${label}.researchDirectionCount conflicts with details.tracks`)
  }
  const directionCodes = new Set<string>()
  const attendanceFacts: Array<ParsedFact<AttendanceMode>> = []
  const languageFacts: Array<ParsedFact<InstructionLanguage[]>> = []
  const directionEvidence: Array<Evidence | null> = []
  const researchDirections = tracks.map((trackValue, trackIndex) => {
    const trackLabel = `${label}.details.tracks[${trackIndex}]`
    const track = record(trackValue, trackLabel)
    const code = text(track.code, `${trackLabel}.code`)
    if (directionCodes.has(code)) {
      throw new Error(`${label}.details.tracks contains duplicate code ${code}`)
    }
    directionCodes.add(code)
    const name = fact({
      value: track.name,
      label: `${trackLabel}.name`,
      parse: localizedValue,
      catalogUrl: input.catalogUrl,
      checkedAt: input.checkedAt,
    })
    if (!name.value) throw new Error(`${trackLabel}.name must be known`)
    const attendance = fact({
      value: track.attendanceMode,
      label: `${trackLabel}.attendanceMode`,
      parse: attendanceValue,
      catalogUrl: input.catalogUrl,
      checkedAt: input.checkedAt,
    })
    const languages = fact({
      value: track.instructionLanguages,
      label: `${trackLabel}.instructionLanguages`,
      parse: languageValues,
      catalogUrl: input.catalogUrl,
      checkedAt: input.checkedAt,
    })
    const chineseRequirement = fact({
      value: track.chineseLanguageRequirement,
      label: `${trackLabel}.chineseLanguageRequirement`,
      parse: localizedValue,
      catalogUrl: input.catalogUrl,
      checkedAt: input.checkedAt,
    })
    const englishRequirement = fact({
      value: track.englishLanguageRequirement,
      label: `${trackLabel}.englishLanguageRequirement`,
      parse: localizedValue,
      catalogUrl: input.catalogUrl,
      checkedAt: input.checkedAt,
    })
    const applicationRemarks = fact({
      value: track.applicationRemarks,
      label: `${trackLabel}.applicationRemarks`,
      parse: stringValue,
      catalogUrl: input.catalogUrl,
      checkedAt: input.checkedAt,
    })
    attendanceFacts.push(attendance)
    languageFacts.push(languages)
    directionEvidence.push(
      evidenceFromFact(name, ['research_directions']),
      evidenceFromFact(attendance, ['research_directions']),
      evidenceFromFact(languages, ['research_directions']),
      evidenceFromFact(chineseRequirement, ['research_directions']),
      evidenceFromFact(englishRequirement, ['research_directions']),
      evidenceFromFact(applicationRemarks, ['research_directions']),
    )
    return {
      code,
      nameZh: name.value.zh,
      nameEn: name.value.en,
      attendanceMode: attendance.value,
      instructionLanguages: languages.value,
      chineseLanguageRequirement: chineseRequirement.value,
      englishLanguageRequirement: englishRequirement.value,
      applicationRemarks: applicationRemarks.value,
    }
  })
  const publishableResearchDirections = Buffer.byteLength(
    JSON.stringify(researchDirections),
    'utf8',
  ) <= MAX_RESEARCH_DIRECTIONS_JSON_BYTES
    ? researchDirections
    : []

  const allAttendanceKnown = attendanceFacts.length > 0
    && attendanceFacts.every((item) => item.value !== null)
  const attendanceMode = allAttendanceKnown
    ? new Set(attendanceFacts.map((item) => item.value)).size === 1
      ? attendanceFacts[0]!.value
      : 'hybrid'
    : null
  const allLanguagesKnown = languageFacts.length > 0
    && languageFacts.every((item) => item.value !== null)
  const instructionLanguages = allLanguagesKnown
    ? [...new Set(languageFacts.flatMap((item) => item.value!))]
      .sort((left, right) => left.localeCompare(right, 'en'))
    : null
  const aggregateEvidence: Array<Evidence | null> = [
    ...(attendanceMode
      ? attendanceFacts.map((item) => evidenceFromFact(item, ['attendance_mode']))
      : []),
    ...(instructionLanguages
      ? languageFacts.map((item) => evidenceFromFact(item, ['instruction_languages']))
      : []),
  ]
  const evidence = deduplicateEvidence([
    baseEvidence(entity, label, input.catalogUrl, input.checkedAt),
    evidenceFromFact(nameZh, ['localized.name']),
    evidenceFromFact(nameEn, ['localized.name']),
    ...(publishableResearchDirections.length > 0 ? directionEvidence : []),
    ...aggregateEvidence,
  ])
  return {
    entityType: 'program',
    entityKey,
    institutionId: INSTITUTION_ID,
    programType: 'degree',
    degreeLevel: input.degreeLevel,
    ...(nameZh.value ? { nameZh: nameZh.value } : {}),
    ...(nameEn.value ? { nameEn: nameEn.value } : {}),
    ...(attendanceMode ? { attendanceMode } : {}),
    ...(instructionLanguages ? { instructionLanguages } : {}),
    ...(publishableResearchDirections.length > 0
      ? { researchDirections: publishableResearchDirections }
      : {}),
    officialUrl: entityUrl,
    sourceCheckedAt: entityCheckedAt,
    evidence,
  }
}

export function looksLikeEnrichedTsinghuaCatalog(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const root = input as JsonRecord
  return (
    typeof root.minimumPublishableDeadline === 'string'
    && root.detailCoverage !== null
    && typeof root.detailCoverage === 'object'
    && Array.isArray(root.entities)
    && root.entities.length > 0
    && root.entities.every((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const entity = value as JsonRecord
      return entity.details !== null
        && typeof entity.details === 'object'
        && !Array.isArray(entity.details)
    })
  )
}

export function adaptEnrichedTsinghuaCatalog(input: unknown): JsonRecord {
  const root = record(input, 'input')
  const catalogUrl = officialUrl(root.catalogUrl, 'input.catalogUrl')
  const checkedAt = timestamp(root.checkedAt, 'input.checkedAt')
  const catalogDegree = degreeLevel(root.degreeLevel, 'input.degreeLevel')
  const entities = array(root.entities, 'input.entities')
  const coverage = record(root.detailCoverage, 'input.detailCoverage')
  if (integer(coverage.programs, 'input.detailCoverage.programs') !== entities.length) {
    throw new Error('input.detailCoverage.programs conflicts with input.entities.length')
  }
  const summarized = summarizeTsinghuaDetails(
    entities as EnrichedTsinghuaProgram[],
  )
  if (JSON.stringify(summarized) !== JSON.stringify(coverage)) {
    throw new Error('input.detailCoverage does not reconcile with enriched program details')
  }
  const adaptedEntities = entities
    .map((value, index) => adaptProgram({
      value,
      index,
      catalogUrl,
      checkedAt,
      degreeLevel: catalogDegree,
    }))
    .sort((left, right) => String(left.entityKey).localeCompare(String(right.entityKey), 'en'))
  return {
    checkedAt,
    sourceMode: root.sourceMode,
    source: {
      title: `Tsinghua University Official International Graduate Catalog — ${catalogDegree}`,
      publisher: 'Tsinghua University',
      reviewedBy: 'tsinghua-official-entity-adapter/v1',
      languageCode: 'other',
      officialHosts: [OFFICIAL_HOST],
    },
    entities: adaptedEntities,
  }
}

export type { EnrichedTsinghuaCatalog }
