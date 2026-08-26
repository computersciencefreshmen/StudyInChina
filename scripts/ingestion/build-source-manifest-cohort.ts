import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SOURCE_CATEGORIES } from '../../workers/ingestion/src/manifest-schema'
import type {
  SourceCategory,
  SourceEntityType,
  SourceManifestV1,
} from '../../workers/ingestion/src/types'
import {
  sourceManifestV2Schema,
  type SourceManifestV2,
} from '../source-manifest-registry'
import {
  validateDoubleFirstClassRegistry,
  type DoubleFirstClassRegistry,
} from './double-first-class-registry'
import {
  loadSourceReconciliations,
  type ReconciledInstitution,
  type ReconciledSourceCategory,
} from './source-reconciliation'

export const CURRENT_SOURCE_MANIFEST_COHORT_INPUTS = {
  registry: 'content/source-manifests/double-first-class/targets.v1.json',
  universities: 'content/data/universities.json',
  sources: 'content/data/sources.json',
  programs: 'content/data/programs.json',
  admissionCycles: 'content/data/admission-cycles.json',
  scholarships: 'content/data/scholarships.json',
} as const

export const SOURCE_MANIFEST_COHORT_RECONCILIATION_DIRECTORY =
  'content/source-registry/reconciliation'

type SourceManifestCohortCatalogInputName =
  keyof typeof CURRENT_SOURCE_MANIFEST_COHORT_INPUTS

export type SourceManifestCohortInputName =
  | SourceManifestCohortCatalogInputName
  | `sourceReconciliation:${string}`

const SOURCE_MANIFEST_COHORT_INPUT_ORDER: SourceManifestCohortCatalogInputName[] = [
  'registry',
  'universities',
  'sources',
  'programs',
  'admissionCycles',
  'scholarships',
]

export type SourceManifestCohortInputFingerprint = {
  name: SourceManifestCohortInputName
  repositoryPath: string
  sha256: string
  byteLength: number
}

export type SourceManifestCohortArtifactFile = {
  path: string
  mediaType: 'application/json'
  sha256: string
  byteLength: number
}

export type SourceManifestCohortArtifactManifest = {
  format: 'studyinchina.source-manifest-v2-candidate-bundle'
  formatVersion: 1
  cohortId: string
  checkedAt: string
  disposition: 'candidate_only'
  summary: SourceManifestCohortGapReport['summary']
  policy: {
    sourceOfTruth: string
    publication: string
    network: string
  }
  inputs: SourceManifestCohortInputFingerprint[]
  files: SourceManifestCohortArtifactFile[]
}

export type SourceManifestCohortArtifactWrite = {
  outputDirectory: string
  manifestDirectory: string
  gapReportPath: string
  artifactManifestPath: string
  checksumPath: string
  verifiedFiles: number
}

export type SourceManifestCohortArtifactVerification = {
  outputDirectory: string
  cohortId: string
  checkedAt: string
  candidateManifests: number
  exactOfficialHttpsSources: number
  verifiedFiles: number
}

type SourceManifestCohortCli =
  | { mode: 'dry-run'; checkedAt: string }
  | { mode: 'write-artifact'; checkedAt: string; artifactOutput: string }
  | { mode: 'verify-artifact'; artifactOutput: string }



export const EXCLUDED_MILITARY_INSTITUTION_NAMES = new Set([
  '国防科技大学',
  '海军军医大学',
  '空军军医大学',
])

type InstitutionTarget = {
  targetId: string
  ordinal: number
  officialNameZh: string
  catalogInstitutionId?: string
}

export type SourceManifestCohortRegistry = {
  cohort: { id: string }
  targets: InstitutionTarget[]
}

export type CatalogUniversityInput = {
  id?: unknown
  slug?: unknown
  name?: { en?: unknown; zh?: unknown }
  sourceIds?: unknown
}

export type CatalogSourceInput = {
  id?: unknown
  url?: unknown
  title?: unknown
  kind?: unknown
  official?: unknown
}

export type CatalogProgramInput = {
  id?: unknown
  universityId?: unknown
  name?: { en?: unknown; zh?: unknown }
  sourceIds?: unknown
}

export type CatalogAdmissionCycleInput = {
  id?: unknown
  programId?: unknown
  sourceIds?: unknown
}

export type CatalogScholarshipInput = {
  id?: unknown
  name?: { en?: unknown; zh?: unknown }
  providerType?: unknown
  universityIds?: unknown
  sourceIds?: unknown
}

export type BuildSourceManifestCohortInput = {
  registry: SourceManifestCohortRegistry
  universities: CatalogUniversityInput[]
  sources: CatalogSourceInput[]
  programs: CatalogProgramInput[]
  admissionCycles: CatalogAdmissionCycleInput[]
  sourceReconciliations: ReconciledInstitution[]
  scholarships: CatalogScholarshipInput[]
  checkedAt: string
}

export type CandidateManifestFile = {
  fileName: string
  manifest: SourceManifestV2
}

export type SourceRejection = {
  sourceId: string
  reason:
    | 'missing_source_record'
    | 'not_official'
    | 'not_https'
    | 'unsupported_source_kind'
    | 'institution_ownership_mismatch'
}

export type InstitutionCoverageGap = {
  targetId: string
  ordinal: number
  officialNameZh: string
  institutionId: string
  mappedSourceCount: number
  reconciliationEntryCount: number
  mappedCategories: SourceCategory[]
  discoveryPendingCategories: SourceCategory[]
  rejectedSources: SourceRejection[]
}

export type CohortGap = {
  targetId: string
  ordinal: number
  officialNameZh: string
  institutionId?: string
  code: 'catalog_mapping_missing' | 'catalog_university_missing' | 'no_safe_entity_source'
  note: string
}

export type SourceManifestCohortGapReport = {
  format: 'studyinchina.source-manifest-v2-gap-report'
  formatVersion: 1
  cohortId: string
  checkedAt: string
  policy: {
    mapping: string
    missingCoverage: string
    officialAbsence: string
  }
  summary: {
    officialTargets: number
    militaryExcluded: number
    eligibleTargets: number
    catalogLinkedManifests: number
    reconciliationFallbackManifests: number
    candidateManifests: number
    exactOfficialHttpsSources: number
    targetsWithoutCandidate: number
  }
  militaryExclusions: Array<{
    targetId: string
    ordinal: number
    officialNameZh: string
  }>
  gaps: CohortGap[]
  institutionCoverage: InstitutionCoverageGap[]
}

export type SourceManifestCohortBuild = {
  candidates: CandidateManifestFile[]
  gapReport: SourceManifestCohortGapReport
  summary: SourceManifestCohortGapReport['summary']
}

type SafeCatalogSource = {
  id: string
  url: string
  host: string
  title: string
  kind: 'program' | 'scholarship' | 'university' | 'admissions' | 'government' | 'city'
}

type ReconciliationCandidate = {
  officialKey: string
  officialName: string
  entityType: 'program' | 'scholarship'
  rawSourceIds: Set<string>
}

const SUPPORTED_SOURCE_KINDS = new Set<SafeCatalogSource['kind']>([
  'program',
  'scholarship',
  'university',
  'admissions',
  'government',
  'city',
])

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
}

function addSourceInstitutionOwners(
  ownership: Map<string, Set<string>>,
  sourceIds: string[],
  institutionIds: string[],
): void {
  for (const sourceId of sourceIds) {
    const owners = ownership.get(sourceId) ?? new Set<string>()
    for (const institutionId of institutionIds) owners.add(institutionId)
    ownership.set(sourceId, owners)
  }
}

function hasExactInstitutionOwnership(
  source: SafeCatalogSource,
  institutionId: string,
  sourceOwnerInstitutionIds: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (source.kind === 'government' || source.kind === 'city') return true
  const owners = sourceOwnerInstitutionIds.get(source.id)
  if (!owners || owners.size === 0) return true
  return owners.size === 1 && owners.has(institutionId)
}

function localizedName(
  name: { en?: unknown; zh?: unknown } | undefined,
  fallback: string,
): string {
  if (typeof name?.en === 'string' && name.en.trim()) return name.en.trim()
  if (typeof name?.zh === 'string' && name.zh.trim()) return name.zh.trim()
  return fallback
}

function assertCheckedAt(checkedAt: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(checkedAt)
  if (!match) {
    throw new Error('checkedAt must be a real ISO date in YYYY-MM-DD format')
  }
  const [, year, month, day] = match
  const canonical = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    .toISOString().slice(0, 10)
  if (canonical !== checkedAt) {
    throw new Error('checkedAt must be a real ISO date in YYYY-MM-DD format')
  }
}

function inspectSource(value: CatalogSourceInput | undefined):
  | { source: SafeCatalogSource }
  | { rejection: SourceRejection['reason'] } {
  if (!value) return { rejection: 'missing_source_record' }
  if (value.official !== true) return { rejection: 'not_official' }
  if (typeof value.id !== 'string' || typeof value.url !== 'string') {
    return { rejection: 'missing_source_record' }
  }
  let parsed: URL
  try {
    parsed = new URL(value.url)
  } catch {
    return { rejection: 'not_https' }
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) return { rejection: 'not_https' }
  if (typeof value.kind !== 'string'
    || !SUPPORTED_SOURCE_KINDS.has(value.kind as SafeCatalogSource['kind'])) {
    return { rejection: 'unsupported_source_kind' }
  }
  return {
    source: {
      id: value.id,
      url: value.url,
      host: parsed.hostname.toLowerCase(),
      title: typeof value.title === 'string' && value.title.trim()
        ? value.title.trim()
        : value.id,
      kind: value.kind as SafeCatalogSource['kind'],
    },
  }
}

function categoryForSource(
  source: SafeCatalogSource,
  universityScholarshipSourceIds: ReadonlySet<string>,
): SourceCategory {
  if (source.kind === 'program') return 'program_detail'
  if (source.kind === 'scholarship') {
    return universityScholarshipSourceIds.has(source.id)
      ? 'university_scholarship'
      : 'government_scholarship'
  }
  if (source.kind === 'admissions') return 'international_admissions_home'
  if (source.kind === 'government' || source.kind === 'city') return 'government_scholarship'
  return 'catalog_anchor'
}

function entityTypeForSource(source: SafeCatalogSource): SourceEntityType {
  if (source.kind === 'program') return 'program'
  if (source.kind === 'scholarship'
    || source.kind === 'government'
    || source.kind === 'city') return 'scholarship'
  return 'university'
}

function manifestSourceId(rawSourceId: string, institutionId: string): string {
  return `${rawSourceId}--${institutionId.replace(/^uni-/, '')}`
}

function buildFetchManifest(
  source: SafeCatalogSource,
  institutionId: string,
  category: SourceCategory,
): SourceManifestV1 {
  return {
    version: 1,
    id: manifestSourceId(source.id, institutionId),
    institutionId,
    entityType: entityTypeForSource(source),
    sourceCategory: category,
    officialUrl: source.url,
    allowedHosts: [source.host],
    enabled: false,
    schedule: { intervalHours: category.includes('scholarship') ? 168 : 720 },
    fetch: {},
    robots: { mode: 'blocked' },
    extraction: {
      mode: 'rules-only',
      schemaVersion: 'source-manifest-v2-candidate-v1',
      fields: [{ path: 'candidateEvidence', type: 'object' }],
    },
  }
}

function addReconciliationCandidate(
  candidates: Map<string, ReconciliationCandidate>,
  entityType: 'program' | 'scholarship',
  officialKey: string,
  officialName: string,
  sourceIds: string[],
): void {
  const mapKey = `${entityType}:${officialKey}`
  const existing = candidates.get(mapKey) ?? {
    officialKey,
    officialName,
    entityType,
    rawSourceIds: new Set<string>(),
  }
  for (const sourceId of sourceIds) existing.rawSourceIds.add(sourceId)
  candidates.set(mapKey, existing)
}

function exactReconciliationSourceUrl(
  category: ReconciledSourceCategory,
): { url: string; host: string } {
  const sourceUrl = category.status === 'verified_official'
    ? category.officialUrl
    : category.evidenceUrl
  if (!sourceUrl) {
    throw new Error(
      `${category.sourceCategory} verified reconciliation is missing officialUrl`,
    )
  }
  let parsed: URL
  try {
    parsed = new URL(sourceUrl)
  } catch {
    throw new Error(`${category.sourceCategory} reconciliation URL is invalid`)
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.port
    || !parsed.hostname
  ) {
    throw new Error(
      `${category.sourceCategory} reconciliation URL must be credential-free HTTPS`,
    )
  }
  return { url: sourceUrl, host: parsed.hostname.toLowerCase() }
}

function reconciliationFallbackSourceId(
  institutionId: string,
  sourceCategory: ReconciledSourceCategory['sourceCategory'],
): string {
  return manifestSourceId(
    `source-reconciliation-${sourceCategory.replaceAll('_', '-')}`,
    institutionId,
  )
}

function buildReconciliationFallbackManifest(
  institutionId: string,
  officialNameZh: string,
  checkedAt: string,
  reconciliation: ReconciledInstitution,
): SourceManifestV2 {
  const sources = reconciliation.categories.map((category): SourceManifestV1 => {
    const exact = exactReconciliationSourceUrl(category)
    return {
      version: 1,
      id: reconciliationFallbackSourceId(institutionId, category.sourceCategory),
      institutionId,
      entityType: 'program',
      sourceCategory: category.sourceCategory,
      officialUrl: exact.url,
      allowedHosts: [exact.host],
      enabled: false,
      schedule: {
        intervalHours: category.sourceCategory.includes('scholarship') ? 168 : 720,
      },
      fetch: {},
      robots: { mode: 'blocked' },
      extraction: {
        mode: 'rules-only',
        schemaVersion: 'source-manifest-v2-reconciliation-fallback-v1',
        fields: [{ path: 'candidateEvidence', type: 'object' }],
      },
    }
  })
  const sourceByCategory = new Map(
    sources.map((source) => [source.sourceCategory, source]),
  )
  const reconciliationByCategory = new Map<
    SourceCategory,
    ReconciledSourceCategory
  >(
    reconciliation.categories.map((category) => [category.sourceCategory, category]),
  )
  const coverage: SourceManifestV2['coverage'] = SOURCE_CATEGORIES.map((sourceCategory) => {
    const category = reconciliationByCategory.get(sourceCategory)
    const source = sourceByCategory.get(sourceCategory)
    if (!category || !source) {
      return {
        sourceCategory,
        status: 'discovery_pending' as const,
        note: 'This category is outside the validated three-category reconciliation fallback and still requires official-source discovery.',
      }
    }
    const status = category.status === 'verified_official'
      ? 'parser_pending' as const
      : category.status
    return {
      sourceCategory,
      status,
      sourceIds: [source.id],
      note: `Validated official reconciliation recorded ${category.status} on ${category.checkedAt}. The exact audit source remains disabled. ${category.note}`,
    }
  })
  const auditSource = sourceByCategory.get('catalog_anchor') ?? sources[0]
  if (!auditSource) {
    throw new Error(`No reconciliation fallback source for ${officialNameZh}`)
  }

  return sourceManifestV2Schema.parse({
    version: 2,
    institutionId,
    catalogStatus: 'existing',
    manifestStatus: 'in_progress',
    checkedAt,
    officialHosts: [...new Set(sources.flatMap((source) => source.allowedHosts))].sort(),
    sources,
    coverage,
    catalogReconciliation: {
      scope: 'limited_official_catalog',
      status: 'in_progress',
      entries: [{
        sourceId: auditSource.id,
        officialKey: `audit-only:${institutionId}:international-catalog`,
        officialName: `AUDIT ONLY - ${officialNameZh} institution-level international catalog`,
        entityType: 'program',
        status: 'pending',
        note: 'Synthetic institution-level catalog audit placeholder; this is not a publishable program and must never be materialized as one.',
      }],
      note: 'Fallback candidate generated only from the exact validated official reconciliation registry. It is limited, disabled, pending review, and does not assert that a publishable international program exists.',
    },
  })
}
function fileNameForTarget(target: InstitutionTarget, institutionId: string): string {
  return `${String(target.ordinal).padStart(3, '0')}-${institutionId.replace(/^uni-/, '')}.v2.candidate.json`
}

export function buildSourceManifestCohort(
  input: BuildSourceManifestCohortInput,
): SourceManifestCohortBuild {
  assertCheckedAt(input.checkedAt)
  const universityById = new Map(
    input.universities.flatMap((university) => (
      typeof university.id === 'string' ? [[university.id, university] as const] : []
    )),
  )
  const sourceById = new Map(
    input.sources.flatMap((source) => (
      typeof source.id === 'string' ? [[source.id, source] as const] : []
    )),
  )
  const programById = new Map(
    input.programs.flatMap((program) => (
      typeof program.id === 'string' ? [[program.id, program] as const] : []
    )),
  )
  const sourceOwnerInstitutionIds = new Map<string, Set<string>>()
  for (const university of input.universities) {
    if (typeof university.id !== 'string') continue
    addSourceInstitutionOwners(
      sourceOwnerInstitutionIds,
      stringArray(university.sourceIds),
      [university.id],
    )
  }
  for (const program of input.programs) {
    if (typeof program.universityId !== 'string') continue
    addSourceInstitutionOwners(
      sourceOwnerInstitutionIds,
      stringArray(program.sourceIds),
      [program.universityId],
    )
  }
  for (const cycle of input.admissionCycles) {
    if (typeof cycle.programId !== 'string') continue
    const program = programById.get(cycle.programId)
    if (typeof program?.universityId !== 'string') continue
    addSourceInstitutionOwners(
      sourceOwnerInstitutionIds,
      stringArray(cycle.sourceIds),
      [program.universityId],
    )
  }
  for (const scholarship of input.scholarships) {
    if (scholarship.providerType !== 'university') continue
    addSourceInstitutionOwners(
      sourceOwnerInstitutionIds,
      stringArray(scholarship.sourceIds),
      stringArray(scholarship.universityIds),
    )
  }
  const sourceReconciliationByName = new Map<string, ReconciledInstitution>()
  for (const reconciliation of input.sourceReconciliations) {
    if (sourceReconciliationByName.has(reconciliation.institutionNameZh)) {
      throw new Error(
        `Duplicate reconciled institution ${reconciliation.institutionNameZh}`,
      )
    }
    sourceReconciliationByName.set(
      reconciliation.institutionNameZh,
      reconciliation,
    )
  }
  let catalogLinkedManifests = 0
  let reconciliationFallbackManifests = 0
  const candidates: CandidateManifestFile[] = []
  const gaps: CohortGap[] = []
  const militaryExclusions: SourceManifestCohortGapReport['militaryExclusions'] = []
  const institutionCoverage: InstitutionCoverageGap[] = []

  for (const target of [...input.registry.targets].sort((left, right) => left.ordinal - right.ordinal)) {
    if (EXCLUDED_MILITARY_INSTITUTION_NAMES.has(target.officialNameZh)) {
      militaryExclusions.push({
        targetId: target.targetId,
        ordinal: target.ordinal,
        officialNameZh: target.officialNameZh,
      })
      continue
    }
    const institutionId = target.catalogInstitutionId
    if (!institutionId) {
      gaps.push({
        targetId: target.targetId,
        ordinal: target.ordinal,
        officialNameZh: target.officialNameZh,
        code: 'catalog_mapping_missing',
        note: 'No exact target-registry to catalog institution mapping is available; fuzzy name matching is intentionally disabled.',
      })
      continue
    }
    const university = universityById.get(institutionId)
    if (!university) {
      gaps.push({
        targetId: target.targetId,
        ordinal: target.ordinal,
        officialNameZh: target.officialNameZh,
        institutionId,
        code: 'catalog_university_missing',
        note: 'The target registry references an institution absent from the current university catalog.',
      })
      continue
    }

    const linkedSourceIds = new Set(stringArray(university.sourceIds))
    const universityScholarshipSourceIds = new Set<string>()
    const reconciliationCandidates = new Map<string, ReconciliationCandidate>()
    const institutionPrograms = input.programs.filter(
      (program) => program.universityId === institutionId && typeof program.id === 'string',
    )
    for (const program of institutionPrograms) {
      const sourceIds = stringArray(program.sourceIds)
      for (const sourceId of sourceIds) linkedSourceIds.add(sourceId)
      addReconciliationCandidate(
        reconciliationCandidates,
        'program',
        program.id as string,
        localizedName(program.name, program.id as string),
        sourceIds,
      )
    }
    const institutionProgramIds = new Set(
      institutionPrograms.map((program) => program.id).filter((id): id is string => typeof id === 'string'),
    )
    for (const cycle of input.admissionCycles) {
      if (typeof cycle.programId !== 'string' || !institutionProgramIds.has(cycle.programId)) continue
      const sourceIds = stringArray(cycle.sourceIds)
      for (const sourceId of sourceIds) linkedSourceIds.add(sourceId)
      const program = programById.get(cycle.programId)
      addReconciliationCandidate(
        reconciliationCandidates,
        'program',
        cycle.programId,
        localizedName(program?.name, cycle.programId),
        sourceIds,
      )
    }
    for (const scholarship of input.scholarships) {
      if (typeof scholarship.id !== 'string'
        || !stringArray(scholarship.universityIds).includes(institutionId)) continue
      const sourceIds = stringArray(scholarship.sourceIds)
      for (const sourceId of sourceIds) {
        linkedSourceIds.add(sourceId)
        if (scholarship.providerType === 'university') {
          universityScholarshipSourceIds.add(sourceId)
        }
      }
      addReconciliationCandidate(
        reconciliationCandidates,
        'scholarship',
        scholarship.id,
        localizedName(scholarship.name, scholarship.id),
        sourceIds,
      )
    }

    const rejectedSources: SourceRejection[] = []
    const safeSources = [...linkedSourceIds].sort().flatMap((sourceId) => {
      const inspected = inspectSource(sourceById.get(sourceId))
      if ('rejection' in inspected) {
        rejectedSources.push({ sourceId, reason: inspected.rejection })
        return []
      }
      if (!hasExactInstitutionOwnership(
        inspected.source,
        institutionId,
        sourceOwnerInstitutionIds,
      )) {
        rejectedSources.push({ sourceId, reason: 'institution_ownership_mismatch' })
        return []
      }
      return [inspected.source]
    })
    const safeRawSourceIds = new Set(safeSources.map((source) => source.id))
    const manifestSources = safeSources.map((source) => buildFetchManifest(
      source,
      institutionId,
      categoryForSource(source, universityScholarshipSourceIds),
    ))
    const manifestSourceIdByRawId = new Map(
      manifestSources.map((source, index) => [safeSources[index]!.id, source.id]),
    )
    const reconciliationEntries = [...reconciliationCandidates.values()]
      .sort((left, right) => (
        left.entityType.localeCompare(right.entityType)
        || left.officialKey.localeCompare(right.officialKey)
      ))
      .flatMap((entry) => {
        const rawSourceId = [...entry.rawSourceIds].filter((id) => safeRawSourceIds.has(id)).sort()[0]
        if (!rawSourceId) return []
        return [{
          sourceId: manifestSourceIdByRawId.get(rawSourceId)!,
          officialKey: entry.officialKey,
          officialName: entry.officialName,
          entityType: entry.entityType,
          status: 'pending' as const,
        }]
      })
    if (reconciliationEntries.length === 0) {
      const officialReconciliation = sourceReconciliationByName.get(
        target.officialNameZh,
      )
      if (officialReconciliation) {
        const manifest = buildReconciliationFallbackManifest(
          institutionId,
          target.officialNameZh,
          input.checkedAt,
          officialReconciliation,
        )
        const mappedCategories = manifest.sources.map(
          (source) => source.sourceCategory,
        )
        institutionCoverage.push({
          targetId: target.targetId,
          ordinal: target.ordinal,
          officialNameZh: target.officialNameZh,
          institutionId,
          mappedSourceCount: manifest.sources.length,
          reconciliationEntryCount: manifest.catalogReconciliation.entries.length,
          mappedCategories,
          discoveryPendingCategories: SOURCE_CATEGORIES.filter(
            (category) => !mappedCategories.includes(category),
          ),
          rejectedSources: rejectedSources.sort(
            (left, right) => left.sourceId.localeCompare(right.sourceId),
          ),
        })
        candidates.push({
          fileName: fileNameForTarget(target, institutionId),
          manifest,
        })
        reconciliationFallbackManifests += 1
        continue
      }
    }
    const sourcesByCategory = new Map<SourceCategory, string[]>()
    for (const source of manifestSources) {
      const ids = sourcesByCategory.get(source.sourceCategory) ?? []
      ids.push(source.id)
      sourcesByCategory.set(source.sourceCategory, ids)
    }
    const coverage: SourceManifestV2['coverage'] = SOURCE_CATEGORIES.map((sourceCategory) => {
      const sourceIds = sourcesByCategory.get(sourceCategory)?.sort()
      if (sourceIds?.length) {
        return {
          sourceCategory,
          status: 'parser_pending' as const,
          sourceIds,
          note: 'Exact official HTTPS source mapped from current catalog relationships; parser, robots, and evidence-locator review remain pending.',
        }
      }
      return {
        sourceCategory,
        status: 'discovery_pending' as const,
        note: 'No exact official HTTPS source with an auditable current catalog relationship is available for this category.',
      }
    })
    institutionCoverage.push({
      targetId: target.targetId,
      ordinal: target.ordinal,
      officialNameZh: target.officialNameZh,
      institutionId,
      mappedSourceCount: manifestSources.length,
      reconciliationEntryCount: reconciliationEntries.length,
      mappedCategories: SOURCE_CATEGORIES.filter((category) => sourcesByCategory.has(category)),
      discoveryPendingCategories: SOURCE_CATEGORIES.filter((category) => !sourcesByCategory.has(category)),
      rejectedSources: rejectedSources.sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    })
    if (manifestSources.length === 0 || reconciliationEntries.length === 0) {
      gaps.push({
        targetId: target.targetId,
        ordinal: target.ordinal,
        officialNameZh: target.officialNameZh,
        institutionId,
        code: 'no_safe_entity_source',
        note: 'No program or scholarship entity has an exact, official, HTTPS source relationship suitable for a V2 candidate.',
      })
      continue
    }
    const manifest = sourceManifestV2Schema.parse({
      version: 2,
      institutionId,
      catalogStatus: 'existing',
      manifestStatus: 'in_progress',
      checkedAt: input.checkedAt,
      officialHosts: [...new Set(safeSources.map((source) => source.host))].sort(),
      sources: manifestSources,
      coverage,
      catalogReconciliation: {
        scope: 'representative_international_programs',
        status: 'in_progress',
        entries: reconciliationEntries,
        note: 'Candidate reconciliation is generated only from exact current catalog relationships; every entry remains pending until source-level evidence is audited.',
      },
    })
    candidates.push({
      fileName: fileNameForTarget(target, institutionId),
      manifest,
    })
    catalogLinkedManifests += 1
  }

  const summary = {
    officialTargets: input.registry.targets.length,
    militaryExcluded: militaryExclusions.length,
    eligibleTargets: input.registry.targets.length - militaryExclusions.length,
    candidateManifests: candidates.length,
    catalogLinkedManifests,
    reconciliationFallbackManifests,
    exactOfficialHttpsSources: candidates.reduce(
      (total, candidate) => total + candidate.manifest.sources.length,
      0,
    ),
    targetsWithoutCandidate: gaps.length,
  }
  const gapReport: SourceManifestCohortGapReport = {
    format: 'studyinchina.source-manifest-v2-gap-report',
    formatVersion: 1,
    cohortId: input.registry.cohort.id,
    checkedAt: input.checkedAt,
    policy: {
      mapping: 'Exact current catalog relationships are preferred. Institution-scoped sources must have one exact catalog owner matching the candidate institution; explicitly government or city sources may be shared. Only when no safe program or scholarship source exists may an exact-name record from the validated official reconciliation registry create a disabled audit-only fallback; fuzzy matching remains forbidden.',
      missingCoverage: 'Unmapped categories are discovery_pending with an explicit note.',
      officialAbsence: 'officially_not_provided is never inferred; it requires separate explicit official evidence.',
    },
    summary,
    militaryExclusions,
    gaps,
    institutionCoverage,
  }
  return { candidates, gapReport, summary }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

function readFingerprintedJson<T>(
  repositoryRoot: string,
  name: SourceManifestCohortCatalogInputName,
): { value: T; fingerprint: SourceManifestCohortInputFingerprint } {
  const repositoryPath = CURRENT_SOURCE_MANIFEST_COHORT_INPUTS[name]
  const bytes = readFileSync(resolve(repositoryRoot, repositoryPath))
  return {
    value: JSON.parse(bytes.toString('utf8')) as T,
    fingerprint: {
      name,
      repositoryPath,
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
    },
  }
}
function readSourceReconciliationInputs(
  repositoryRoot: string,
): {
  value: ReconciledInstitution[]
  fingerprints: SourceManifestCohortInputFingerprint[]
} {
  const directory = resolve(
    repositoryRoot,
    SOURCE_MANIFEST_COHORT_RECONCILIATION_DIRECTORY,
  )
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith('.v1.json'))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
  if (entries.length === 0) {
    throw new Error('Validated official reconciliation registry is empty')
  }
  const unsupported = entries.find((entry) => !entry.isFile())
  if (unsupported) {
    throw new Error(
      `Reconciliation input must be a regular file: ${unsupported.name}`,
    )
  }
  const fingerprints = entries.map((entry): SourceManifestCohortInputFingerprint => {
    const repositoryPath = posix.join(
      SOURCE_MANIFEST_COHORT_RECONCILIATION_DIRECTORY,
      entry.name,
    )
    const bytes = readFileSync(resolve(repositoryRoot, repositoryPath))
    return {
      name: `sourceReconciliation:${entry.name}`,
      repositoryPath,
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
    }
  })
  return {
    value: loadSourceReconciliations(directory),
    fingerprints,
  }
}


export function buildCurrentSourceManifestCohort(
  checkedAt: string,
  repositoryRoot = resolve('.'),
): {
  build: SourceManifestCohortBuild
  inputFingerprints: SourceManifestCohortInputFingerprint[]
} {
  const registry = readFingerprintedJson<unknown>(repositoryRoot, 'registry')
  const universities = readFingerprintedJson<CatalogUniversityInput[]>(
    repositoryRoot,
    'universities',
  )
  const sources = readFingerprintedJson<CatalogSourceInput[]>(repositoryRoot, 'sources')
  const programs = readFingerprintedJson<CatalogProgramInput[]>(repositoryRoot, 'programs')
  const admissionCycles = readFingerprintedJson<CatalogAdmissionCycleInput[]>(
    repositoryRoot,
    'admissionCycles',
  )
  const scholarships = readFingerprintedJson<CatalogScholarshipInput[]>(
    repositoryRoot,
    'scholarships',
  )
  const sourceReconciliations = readSourceReconciliationInputs(
    repositoryRoot,
  )
  const build = buildSourceManifestCohort({
    registry: validateDoubleFirstClassRegistry(registry.value) as DoubleFirstClassRegistry,
    universities: universities.value,
    sources: sources.value,
    programs: programs.value,
    admissionCycles: admissionCycles.value,
    scholarships: scholarships.value,
    sourceReconciliations: sourceReconciliations.value,
    checkedAt,
  })
  return {
    build,
    inputFingerprints: [
      registry.fingerprint,
      universities.fingerprint,
      sources.fingerprint,
      programs.fingerprint,
      admissionCycles.fingerprint,
      scholarships.fingerprint,
      ...sourceReconciliations.fingerprints,
    ],
  }
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === ''
    || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path))
}

function resolveThroughExistingAncestor(path: string): string {
  let ancestor = resolve(path)
  const suffix: string[] = []
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) {
      throw new Error('Unable to resolve artifact output ancestor for ' + path)
    }
    suffix.unshift(relative(parent, ancestor))
    ancestor = parent
  }
  return resolve(realpathSync(ancestor), ...suffix)
}

function assertSafeEmptyArtifactOutput(
  outputDirectory: string,
  repositoryRoot: string,
): string {
  const output = resolve(outputDirectory)
  const formalManifestDirectory = resolve(repositoryRoot, 'content/source-manifests')
  const effectiveOutput = resolveThroughExistingAncestor(output)
  const effectiveFormalManifestDirectory = realpathSync(formalManifestDirectory)
  if (
    isInside(formalManifestDirectory, output)
    || isInside(effectiveFormalManifestDirectory, effectiveOutput)
  ) {
    throw new Error('Candidate artifact output must not be inside content/source-manifests')
  }
  if (!existsSync(output)) return output
  const stats = lstatSync(output)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('Candidate artifact output must be a real directory')
  }
  if (readdirSync(output).length > 0) {
    throw new Error('Candidate artifact output must be empty to prevent stale-file leakage')
  }
  return output
}

function sortedInputFingerprints(
  inputFingerprints: SourceManifestCohortInputFingerprint[],
): SourceManifestCohortInputFingerprint[] {
  const byName = new Map(inputFingerprints.map((input) => [input.name, input]))
  if (byName.size !== inputFingerprints.length) {
    throw new Error('Candidate artifact input fingerprints contain duplicate names')
  }
  const validFingerprint = (input: SourceManifestCohortInputFingerprint): boolean => (
    /^[a-f0-9]{64}$/u.test(input.sha256)
    && Number.isSafeInteger(input.byteLength)
    && input.byteLength > 0
  )
  const lockedInputs = SOURCE_MANIFEST_COHORT_INPUT_ORDER.map((name) => {
    const input = byName.get(name)
    if (
      !input
      || input.repositoryPath !== CURRENT_SOURCE_MANIFEST_COHORT_INPUTS[name]
      || !validFingerprint(input)
    ) {
      throw new Error('Invalid locked input fingerprint: ' + name)
    }
    return input
  })
  const lockedNames = new Set<string>(SOURCE_MANIFEST_COHORT_INPUT_ORDER)
  const unexpected = inputFingerprints.find((input) => (
    !lockedNames.has(input.name)
    && !input.name.startsWith('sourceReconciliation:')
  ))
  if (unexpected) {
    throw new Error('Unexpected candidate artifact input: ' + unexpected.name)
  }
  const reconciliationInputs = inputFingerprints
    .filter((input) => input.name.startsWith('sourceReconciliation:'))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
  if (reconciliationInputs.length === 0) {
    throw new Error('Candidate artifact requires reconciliation input fingerprints')
  }
  const repositoryPaths = new Set(lockedInputs.map((input) => input.repositoryPath))
  for (const input of reconciliationInputs) {
    const fileName = input.name.slice('sourceReconciliation:'.length)
    const expectedPath = posix.join(
      SOURCE_MANIFEST_COHORT_RECONCILIATION_DIRECTORY,
      fileName,
    )
    if (
      !/^[a-z0-9][a-z0-9.-]*\.v1\.json$/u.test(fileName)
      || input.repositoryPath !== expectedPath
      || !validFingerprint(input)
      || repositoryPaths.has(input.repositoryPath)
    ) {
      throw new Error('Invalid reconciliation input fingerprint: ' + input.name)
    }
    repositoryPaths.add(input.repositoryPath)
  }
  return [...lockedInputs, ...reconciliationInputs]
}

function assertSafeArtifactRelativePath(path: string): void {
  if (
    path.length === 0
    || path.includes('\\')
    || isAbsolute(path)
    || posix.normalize(path) !== path
    || path === '..'
    || path.startsWith('../')
  ) {
    throw new Error('Unsafe artifact-relative path: ' + path)
  }
}

function writeJsonArtifact(
  outputDirectory: string,
  path: string,
  value: unknown,
): SourceManifestCohortArtifactFile {
  assertSafeArtifactRelativePath(path)
  const body = serializeJson(value)
  const destination = join(outputDirectory, ...path.split('/'))
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, body, 'utf8')
  return {
    path,
    mediaType: 'application/json',
    sha256: sha256(body),
    byteLength: Buffer.byteLength(body),
  }
}

function walkArtifactFiles(directory: string, prefix = ''): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error('Artifact bundle contains a symbolic link: ' + entry.name)
    }
    const relativePath = prefix ? posix.join(prefix, entry.name) : entry.name
    const absolutePath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkArtifactFiles(absolutePath, relativePath))
    } else if (entry.isFile()) {
      files.push(relativePath)
    } else {
      throw new Error('Artifact bundle contains an unsupported file: ' + relativePath)
    }
  }
  return files.sort()
}

function readArtifactManifest(outputDirectory: string): SourceManifestCohortArtifactManifest {
  const raw = JSON.parse(
    readFileSync(join(outputDirectory, 'artifact-manifest.v1.json'), 'utf8'),
  ) as Partial<SourceManifestCohortArtifactManifest>
  if (
    raw.format !== 'studyinchina.source-manifest-v2-candidate-bundle'
    || raw.formatVersion !== 1
    || raw.disposition !== 'candidate_only'
    || typeof raw.cohortId !== 'string'
    || typeof raw.checkedAt !== 'string'
    || !raw.summary
    || !Array.isArray(raw.inputs)
    || !Array.isArray(raw.files)
  ) {
    throw new Error('Invalid source-manifest candidate artifact manifest')
  }
  sortedInputFingerprints(raw.inputs)
  return raw as SourceManifestCohortArtifactManifest
}

export function verifySourceManifestCohortArtifact(
  outputDirectory: string,
): SourceManifestCohortArtifactVerification {
  const output = resolve(outputDirectory)
  if (!existsSync(output) || lstatSync(output).isSymbolicLink()) {
    throw new Error('Candidate artifact directory is missing or is a symbolic link')
  }
  const artifactManifest = readArtifactManifest(output)
  const checksumBody = readFileSync(join(output, 'SHA256SUMS'), 'utf8')
  const checksumEntries = checksumBody.split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line)
    if (!match) throw new Error('Invalid SHA256SUMS line: ' + line)
    const path = match[2]!
    assertSafeArtifactRelativePath(path)
    return { sha256: match[1]!, path }
  })
  const checksumByPath = new Map(
    checksumEntries.map((entry) => [entry.path, entry.sha256]),
  )
  if (checksumByPath.size !== checksumEntries.length) {
    throw new Error('SHA256SUMS contains duplicate paths')
  }

  const describedPaths = artifactManifest.files.map((file) => file.path)
  const expectedChecksummedPaths = [
    'artifact-manifest.v1.json',
    ...describedPaths,
  ].sort()
  if (
    JSON.stringify([...checksumByPath.keys()].sort())
    !== JSON.stringify(expectedChecksummedPaths)
  ) {
    throw new Error('SHA256SUMS paths do not match the artifact manifest')
  }
  const expectedDiskPaths = [...expectedChecksummedPaths, 'SHA256SUMS'].sort()
  if (JSON.stringify(walkArtifactFiles(output)) !== JSON.stringify(expectedDiskPaths)) {
    throw new Error('Candidate artifact contains missing or unexpected files')
  }

  for (const entry of checksumEntries) {
    const bytes = readFileSync(join(output, ...entry.path.split('/')))
    if (sha256(bytes) !== entry.sha256) {
      throw new Error('Artifact checksum mismatch: ' + entry.path)
    }
  }
  for (const file of artifactManifest.files) {
    assertSafeArtifactRelativePath(file.path)
    const bytes = readFileSync(join(output, ...file.path.split('/')))
    if (
      file.mediaType !== 'application/json'
      || file.sha256 !== sha256(bytes)
      || file.byteLength !== bytes.byteLength
      || checksumByPath.get(file.path) !== file.sha256
    ) {
      throw new Error('Artifact manifest metadata mismatch: ' + file.path)
    }
  }

  const gapFile = artifactManifest.files.find((file) => file.path === 'gap-report.v1.json')
  if (!gapFile) throw new Error('Candidate artifact is missing gap-report.v1.json')
  const gapReport = JSON.parse(
    readFileSync(join(output, gapFile.path), 'utf8'),
  ) as Partial<SourceManifestCohortGapReport>
  if (
    gapReport.format !== 'studyinchina.source-manifest-v2-gap-report'
    || gapReport.cohortId !== artifactManifest.cohortId
    || gapReport.checkedAt !== artifactManifest.checkedAt
    || JSON.stringify(gapReport.summary) !== JSON.stringify(artifactManifest.summary)
  ) {
    throw new Error('Gap report does not match the artifact manifest')
  }

  const candidateFiles = artifactManifest.files.filter(
    (file) => file.path.startsWith('manifests/'),
  )
  if (candidateFiles.length !== artifactManifest.summary.candidateManifests) {
    throw new Error('Candidate manifest count does not match the artifact summary')
  }
  const institutions = new Set<string>()
  let exactOfficialHttpsSources = 0
  for (const file of candidateFiles) {
    if (!/^manifests\/\d{3}-[a-z0-9-]+\.v2\.candidate\.json$/u.test(file.path)) {
      throw new Error('Unexpected candidate manifest filename: ' + file.path)
    }
    const candidate = sourceManifestV2Schema.parse(JSON.parse(
      readFileSync(join(output, ...file.path.split('/')), 'utf8'),
    ))
    if (
      candidate.manifestStatus !== 'in_progress'
      || candidate.catalogReconciliation.status !== 'in_progress'
      || candidate.catalogReconciliation.entries.some((entry) => entry.status !== 'pending')
      || candidate.sources.some(
        (source) => source.enabled !== false || source.robots.mode !== 'blocked',
      )
    ) {
      throw new Error(
        'Candidate manifest is not safely disabled and pending: ' + file.path,
      )
    }
    if (institutions.has(candidate.institutionId)) {
      throw new Error('Duplicate candidate institution: ' + candidate.institutionId)
    }
    institutions.add(candidate.institutionId)
    exactOfficialHttpsSources += candidate.sources.length
  }
  if (exactOfficialHttpsSources !== artifactManifest.summary.exactOfficialHttpsSources) {
    throw new Error('Official HTTPS source count does not match the artifact summary')
  }

  return {
    outputDirectory: output,
    cohortId: artifactManifest.cohortId,
    checkedAt: artifactManifest.checkedAt,
    candidateManifests: candidateFiles.length,
    exactOfficialHttpsSources,
    verifiedFiles: checksumEntries.length,
  }
}

export function writeSourceManifestCohort(
  build: SourceManifestCohortBuild,
  outputDirectory: string,
  inputFingerprints: SourceManifestCohortInputFingerprint[],
  repositoryRoot = resolve('.'),
): SourceManifestCohortArtifactWrite {
  const output = assertSafeEmptyArtifactOutput(outputDirectory, repositoryRoot)
  const manifestDirectory = join(output, 'manifests')
  const files: SourceManifestCohortArtifactFile[] = []
  const candidateNames = new Set<string>()
  for (const candidate of [...build.candidates].sort(
    (left, right) => left.fileName.localeCompare(right.fileName),
  )) {
    if (
      candidateNames.has(candidate.fileName)
      || !/^\d{3}-[a-z0-9-]+\.v2\.candidate\.json$/u.test(candidate.fileName)
    ) {
      throw new Error('Unsafe or duplicate candidate filename: ' + candidate.fileName)
    }
    candidateNames.add(candidate.fileName)
    files.push(writeJsonArtifact(
      output,
      posix.join('manifests', candidate.fileName),
      candidate.manifest,
    ))
  }
  files.push(writeJsonArtifact(output, 'gap-report.v1.json', build.gapReport))
  files.sort((left, right) => left.path.localeCompare(right.path))

  const artifactManifest: SourceManifestCohortArtifactManifest = {
    format: 'studyinchina.source-manifest-v2-candidate-bundle',
    formatVersion: 1,
    cohortId: build.gapReport.cohortId,
    checkedAt: build.gapReport.checkedAt,
    disposition: 'candidate_only',
    summary: build.summary,
    policy: {
      sourceOfTruth:
        'Read-only current catalog JSON, the locked Ministry of Education target registry, and the validated official reconciliation registry.',
      publication:
        'This bundle is review-only and must never be copied directly into content/source-manifests.',
      network:
        'Generation performs no network requests and never invents or fuzzy-matches sources.',
    },
    inputs: sortedInputFingerprints(inputFingerprints),
    files,
  }
  const artifactManifestFile = writeJsonArtifact(
    output,
    'artifact-manifest.v1.json',
    artifactManifest,
  )
  const checksummedFiles = [...files, artifactManifestFile].sort(
    (left, right) => left.path.localeCompare(right.path),
  )
  const checksumBody = checksummedFiles.map(
    (file) => file.sha256 + '  ' + file.path,
  ).join('\n')
  const checksumPath = join(output, 'SHA256SUMS')
  writeFileSync(checksumPath, checksumBody + '\n', 'utf8')
  const verification = verifySourceManifestCohortArtifact(output)
  return {
    outputDirectory: output,
    manifestDirectory,
    gapReportPath: join(output, 'gap-report.v1.json'),
    artifactManifestPath: join(output, 'artifact-manifest.v1.json'),
    checksumPath,
    verifiedFiles: verification.verifiedFiles,
  }
}

export function dryRunSummary(build: SourceManifestCohortBuild): string {
  return JSON.stringify({ mode: 'dry-run', ...build.summary })
}

const CLI_USAGE = [
  'Usage:',
  '  --checked-at <YYYY-MM-DD> --dry-run',
  '  --checked-at <YYYY-MM-DD> --artifact-output <empty-directory>',
  '  --verify-artifact <artifact-directory>',
].join('\n')

export function parseSourceManifestCohortCli(argv: string[]): SourceManifestCohortCli {
  let checkedAt: string | undefined
  let artifactOutput: string | undefined
  let verifyArtifact: string | undefined
  let dryRun = false
  const seen = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (seen.has(argument)) {
      throw new Error('Duplicate CLI option: ' + argument + '\n' + CLI_USAGE)
    }
    seen.add(argument)
    if (argument === '--dry-run') {
      dryRun = true
      continue
    }
    if (
      argument !== '--checked-at'
      && argument !== '--artifact-output'
      && argument !== '--verify-artifact'
    ) {
      throw new Error('Unknown CLI option: ' + argument + '\n' + CLI_USAGE)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error('Missing value for ' + argument + '\n' + CLI_USAGE)
    }
    index += 1
    if (argument === '--checked-at') checkedAt = value
    if (argument === '--artifact-output') artifactOutput = value
    if (argument === '--verify-artifact') verifyArtifact = value
  }
  if (verifyArtifact) {
    if (checkedAt || artifactOutput || dryRun) {
      throw new Error('--verify-artifact is an exclusive mode\n' + CLI_USAGE)
    }
    return { mode: 'verify-artifact', artifactOutput: verifyArtifact }
  }
  if (!checkedAt || dryRun === Boolean(artifactOutput)) {
    throw new Error(CLI_USAGE)
  }
  return dryRun
    ? { mode: 'dry-run', checkedAt }
    : { mode: 'write-artifact', checkedAt, artifactOutput: artifactOutput! }
}

function runCli(): void {
  const cli = parseSourceManifestCohortCli(process.argv.slice(2))
  if (cli.mode === 'verify-artifact') {
    process.stdout.write(JSON.stringify({
      mode: 'verify-artifact',
      ...verifySourceManifestCohortArtifact(cli.artifactOutput),
    }) + '\n')
    return
  }
  const current = buildCurrentSourceManifestCohort(cli.checkedAt)
  if (cli.mode === 'dry-run') {
    process.stdout.write(dryRunSummary(current.build) + '\n')
    return
  }
  const written = writeSourceManifestCohort(
    current.build,
    cli.artifactOutput,
    current.inputFingerprints,
  )
  process.stdout.write(JSON.stringify({
    mode: 'write-artifact',
    ...current.build.summary,
    ...written,
  }) + '\n')
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    runCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
