import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
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
  scholarships: CatalogScholarshipInput[]
  checkedAt: string
}

export type CandidateManifestFile = {
  fileName: string
  manifest: SourceManifestV2
}

export type SourceRejection = {
  sourceId: string
  reason: 'missing_source_record' | 'not_official' | 'not_https' | 'unsupported_source_kind'
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
  }

  const summary = {
    officialTargets: input.registry.targets.length,
    militaryExcluded: militaryExclusions.length,
    eligibleTargets: input.registry.targets.length - militaryExclusions.length,
    candidateManifests: candidates.length,
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
      mapping: 'Only exact sourceIds already related by current university, program, admission-cycle, or scholarship records are eligible; publisher and institution names are never fuzzy-matched.',
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

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !path.startsWith(`..\\`) && !path.startsWith('../'))
}

export function writeSourceManifestCohort(
  build: SourceManifestCohortBuild,
  outputDirectory: string,
): { outputDirectory: string; manifestDirectory: string; gapReportPath: string } {
  const output = resolve(outputDirectory)
  const formalManifestDirectory = resolve('content/source-manifests')
  if (isInside(formalManifestDirectory, output)) {
    throw new Error('Candidate output must not be inside content/source-manifests')
  }
  const manifestDirectory = join(output, 'manifests')
  mkdirSync(manifestDirectory, { recursive: true })
  for (const candidate of build.candidates) {
    writeFileSync(
      join(manifestDirectory, candidate.fileName),
      `${JSON.stringify(candidate.manifest, null, 2)}\n`,
      'utf8',
    )
  }
  const gapReportPath = join(output, 'gap-report.v1.json')
  writeFileSync(gapReportPath, `${JSON.stringify(build.gapReport, null, 2)}\n`, 'utf8')
  return { outputDirectory: output, manifestDirectory, gapReportPath }
}

export function dryRunSummary(build: SourceManifestCohortBuild): string {
  return JSON.stringify({ mode: 'dry-run', ...build.summary })
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T
}

function runCli(): void {
  const checkedAt = option('--checked-at')
  if (!checkedAt) {
    throw new Error('Usage requires --checked-at <YYYY-MM-DD> and either --dry-run or --output <directory>')
  }
  const dryRun = process.argv.includes('--dry-run')
  const output = option('--output')
  if (!dryRun && !output) {
    throw new Error('Refusing to write without an explicit --output directory; use --dry-run for a no-write summary')
  }
  const registry = validateDoubleFirstClassRegistry(readJson(
    option('--registry') ?? 'content/source-manifests/double-first-class/targets.v1.json',
  ))
  const build = buildSourceManifestCohort({
    registry: registry as DoubleFirstClassRegistry,
    universities: readJson(option('--universities') ?? 'content/data/universities.json'),
    sources: readJson(option('--sources') ?? 'content/data/sources.json'),
    programs: readJson(option('--programs') ?? 'content/data/programs.json'),
    admissionCycles: readJson(option('--cycles') ?? 'content/data/admission-cycles.json'),
    scholarships: readJson(option('--scholarships') ?? 'content/data/scholarships.json'),
    checkedAt,
  })
  if (dryRun) {
    process.stdout.write(`${dryRunSummary(build)}\n`)
    return
  }
  const written = writeSourceManifestCohort(build, output!)
  process.stdout.write(`${JSON.stringify({ mode: 'write', ...build.summary, ...written })}\n`)
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    runCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
