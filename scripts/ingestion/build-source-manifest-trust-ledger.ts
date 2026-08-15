import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle } from '../../src/lib/data/types'
import {
  isCatalogReconciliationComplete,
  loadSourceManifestFiles,
  validateSourceManifests,
  type SourceManifestRecord,
  type SourceManifestV2,
} from '../source-manifest-registry'
import {
  buildCurrentSourceManifestCohort,
  type CandidateManifestFile,
  type SourceManifestCohortBuild,
} from './build-source-manifest-cohort'

export const SOURCE_MANIFEST_TRUST_LEDGER_STATUSES = [
  'complete',
  'in_progress',
  'limited_official_catalog',
] as const

export type SourceManifestTrustLedgerStatus =
  (typeof SOURCE_MANIFEST_TRUST_LEDGER_STATUSES)[number]

export const SOURCE_MANIFEST_UPGRADE_STAGES = [
  'reconciled_complete',
  'formal_v2_reconciliation_required',
  'legacy_v1_upgrade_required',
  'candidate_review_required',
  'limited_catalog_review_required',
  'official_source_discovery_required',
] as const

export type SourceManifestUpgradeStage =
  (typeof SOURCE_MANIFEST_UPGRADE_STAGES)[number]

export type SourceManifestLedgerUniversity = {
  id: string
  slug: string
  name: {
    en: string | null
    zh: string | null
  }
}

export type SourceManifestTrustLedgerEntry = {
  institutionId: string
  slug: string
  name: SourceManifestLedgerUniversity['name']
  status: SourceManifestTrustLedgerStatus
  upgradeStage: SourceManifestUpgradeStage
  formalManifest: {
    registered: boolean
    version: 1 | 2 | null
    state: 'not_registered' | 'legacy_v1' | 'in_progress' | 'complete'
    checkedAt: string | null
  }
  candidate: {
    available: boolean
    classification:
      | 'none'
      | 'catalog_linked_candidate'
      | 'limited_official_catalog_candidate'
    cohortId: string | null
    fileName: string | null
    scope: SourceManifestV2['catalogReconciliation']['scope'] | null
    sourceCount: number
    reconciliationEntryCount: number
    safelyDisabled: boolean
  }
  reconciliation: {
    state:
      | 'complete'
      | 'in_progress'
      | 'legacy_v1_not_reconciled'
      | 'candidate_is_not_reconciliation'
      | 'not_started'
    basis: 'formal_v2' | 'legacy_v1' | 'candidate_only' | 'none'
  }
  gates: {
    publicationEligible: boolean
    candidateEvidenceOnly: boolean
    requiresHumanReview: boolean
  }
}

export type SourceManifestTrustLedgerReport = {
  format: 'studyinchina.source-manifest-trust-ledger'
  formatVersion: 1
  checkedAt: string
  scope: 'public_catalog'
  disposition: 'audit_only'
  policy: {
    publicScope: string
    candidateBoundary: string
    legacyBoundary: string
    formalImportGate: string
  }
  summary: {
    publicUniversities: number
    ledgerEntries: number
    statusCounts: Record<SourceManifestTrustLedgerStatus, number>
    formalManifestRecords: number
    formalRecordsOutsidePublicCatalog: number
    legacyV1UpgradePaths: number
    formalV2InProgress: number
    completeFormalReconciliations: number
    candidateCoverage: number
    candidateRecordsOutsidePublicCatalog: number
    candidateOnlyRecords: number
    formalCandidateOverlap: number
    officialSourceDiscoveryRequired: number
    candidateCohort: {
      cohortId: string
      officialTargets: number
      militaryExcluded: number
      eligibleTargets: number
      candidateManifests: number
      catalogLinkedCandidates: number
      limitedOfficialCatalogCandidates: number
      exactOfficialHttpsSources: number
    }
  }
  entries: SourceManifestTrustLedgerEntry[]
}

export type BuildSourceManifestTrustLedgerInput = {
  checkedAt: string
  publicUniversities: SourceManifestLedgerUniversity[]
  formalManifests: SourceManifestRecord[]
  candidateBuild: SourceManifestCohortBuild
}

type SourceManifestTrustLedgerCli = {
  checkedAt: string
  outputPath?: string
}

const CLI_USAGE = [
  'Usage:',
  '  --checked-at <YYYY-MM-DD>',
  '  --checked-at <YYYY-MM-DD> --output <path-outside-repository>',
].join('\n')

function assertUniqueMap<T>(
  values: T[],
  keyOf: (value: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>()
  for (const value of values) {
    const key = keyOf(value)
    if (!key) throw new Error(`${label} contains an empty identity`)
    if (result.has(key)) throw new Error(`${label} repeats ${key}`)
    result.set(key, value)
  }
  return result
}

function candidateIsSafelyDisabled(candidate: CandidateManifestFile): boolean {
  return candidate.manifest.manifestStatus === 'in_progress'
    && candidate.manifest.catalogReconciliation.status === 'in_progress'
    && candidate.manifest.catalogReconciliation.entries.every(
      (entry) => entry.status === 'pending',
    )
    && candidate.manifest.sources.every(
      (source) => source.enabled === false && source.robots.mode === 'blocked',
    )
}

function statusFor(
  formal: SourceManifestRecord | undefined,
  candidate: CandidateManifestFile | undefined,
): SourceManifestTrustLedgerStatus {
  if (formal && isCatalogReconciliationComplete(formal)) return 'complete'
  const formalIsLimited = formal?.version === 2
    && formal.catalogReconciliation.scope === 'limited_official_catalog'
  const candidateIsLimited = candidate?.manifest.catalogReconciliation.scope
    === 'limited_official_catalog'
  return formalIsLimited || candidateIsLimited
    ? 'limited_official_catalog'
    : 'in_progress'
}

function upgradeStageFor(
  formal: SourceManifestRecord | undefined,
  candidate: CandidateManifestFile | undefined,
  status: SourceManifestTrustLedgerStatus,
): SourceManifestUpgradeStage {
  if (status === 'complete') return 'reconciled_complete'
  if (formal?.version === 2) return 'formal_v2_reconciliation_required'
  if (formal?.version === 1) return 'legacy_v1_upgrade_required'
  if (status === 'limited_official_catalog') {
    return 'limited_catalog_review_required'
  }
  if (candidate) return 'candidate_review_required'
  return 'official_source_discovery_required'
}

function reconciliationFor(
  formal: SourceManifestRecord | undefined,
  candidate: CandidateManifestFile | undefined,
): SourceManifestTrustLedgerEntry['reconciliation'] {
  if (formal?.version === 2) {
    return {
      state: isCatalogReconciliationComplete(formal) ? 'complete' : 'in_progress',
      basis: 'formal_v2',
    }
  }
  if (formal?.version === 1) {
    return { state: 'legacy_v1_not_reconciled', basis: 'legacy_v1' }
  }
  if (candidate) {
    return { state: 'candidate_is_not_reconciliation', basis: 'candidate_only' }
  }
  return { state: 'not_started', basis: 'none' }
}

function formalManifestFor(
  formal: SourceManifestRecord | undefined,
): SourceManifestTrustLedgerEntry['formalManifest'] {
  if (!formal) {
    return {
      registered: false,
      version: null,
      state: 'not_registered',
      checkedAt: null,
    }
  }
  if (formal.version === 1) {
    return {
      registered: true,
      version: 1,
      state: 'legacy_v1',
      checkedAt: formal.checkedAt,
    }
  }
  return {
    registered: true,
    version: 2,
    state: isCatalogReconciliationComplete(formal) ? 'complete' : 'in_progress',
    checkedAt: formal.checkedAt,
  }
}

export function buildSourceManifestTrustLedger(
  input: BuildSourceManifestTrustLedgerInput,
): SourceManifestTrustLedgerReport {
  const publicUniversityById = assertUniqueMap(
    input.publicUniversities,
    (university) => university.id,
    'Public university catalog',
  )
  const formalByInstitution = assertUniqueMap(
    input.formalManifests,
    (manifest) => manifest.institutionId,
    'Formal source manifests',
  )
  const candidateByInstitution = assertUniqueMap(
    input.candidateBuild.candidates,
    (candidate) => candidate.manifest.institutionId,
    'Source-manifest candidate cohort',
  )

  for (const candidate of candidateByInstitution.values()) {
    if (!candidateIsSafelyDisabled(candidate)) {
      throw new Error(
        `Candidate ${candidate.manifest.institutionId} is not safely disabled and pending`,
      )
    }
  }

  const entries = [...publicUniversityById.values()]
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
    .map((university): SourceManifestTrustLedgerEntry => {
      const formal = formalByInstitution.get(university.id)
      const candidate = candidateByInstitution.get(university.id)
      const status = statusFor(formal, candidate)
      const upgradeStage = upgradeStageFor(formal, candidate, status)
      const complete = status === 'complete'
      const candidateScope = candidate?.manifest.catalogReconciliation.scope ?? null
      const safelyDisabled = candidate ? candidateIsSafelyDisabled(candidate) : false
      return {
        institutionId: university.id,
        slug: university.slug,
        name: university.name,
        status,
        upgradeStage,
        formalManifest: formalManifestFor(formal),
        candidate: {
          available: Boolean(candidate),
          classification: !candidate
            ? 'none'
            : candidateScope === 'limited_official_catalog'
              ? 'limited_official_catalog_candidate'
              : 'catalog_linked_candidate',
          cohortId: candidate ? input.candidateBuild.gapReport.cohortId : null,
          fileName: candidate?.fileName ?? null,
          scope: candidateScope,
          sourceCount: candidate?.manifest.sources.length ?? 0,
          reconciliationEntryCount:
            candidate?.manifest.catalogReconciliation.entries.length ?? 0,
          safelyDisabled,
        },
        reconciliation: reconciliationFor(formal, candidate),
        gates: {
          publicationEligible: complete,
          candidateEvidenceOnly: Boolean(candidate) && !complete,
          requiresHumanReview: !complete,
        },
      }
    })

  const statusCounts = Object.fromEntries(
    SOURCE_MANIFEST_TRUST_LEDGER_STATUSES.map((status) => [
      status,
      entries.filter((entry) => entry.status === status).length,
    ]),
  ) as Record<SourceManifestTrustLedgerStatus, number>
  const publicIds = new Set(publicUniversityById.keys())
  const publicFormalRecords = input.formalManifests.filter(
    (manifest) => publicIds.has(manifest.institutionId),
  )
  const publicCandidates = input.candidateBuild.candidates.filter(
    (candidate) => publicIds.has(candidate.manifest.institutionId),
  )
  const formalCandidateOverlap = publicCandidates.filter(
    (candidate) => formalByInstitution.has(candidate.manifest.institutionId),
  ).length

  return {
    format: 'studyinchina.source-manifest-trust-ledger',
    formatVersion: 1,
    checkedAt: input.checkedAt,
    scope: 'public_catalog',
    disposition: 'audit_only',
    policy: {
      publicScope:
        'Every university visible under the production publication rules for checkedAt has exactly one ledger entry.',
      candidateBoundary:
        'A disabled V2 candidate is discovery evidence only; it never counts as catalog reconciliation or publication approval.',
      legacyBoundary:
        'A legacy V1 pilot manifest is an explicit V2 upgrade path and never counts as a complete reconciliation.',
      formalImportGate:
        'Only a separately reviewed formal V2 manifest with complete coverage, complete reconciliation, no pending entries, and no audit-only markers may pass the existing promotion gate.',
    },
    summary: {
      publicUniversities: entries.length,
      ledgerEntries: entries.length,
      statusCounts,
      formalManifestRecords: publicFormalRecords.length,
      formalRecordsOutsidePublicCatalog:
        input.formalManifests.length - publicFormalRecords.length,
      legacyV1UpgradePaths: entries.filter(
        (entry) => entry.formalManifest.state === 'legacy_v1',
      ).length,
      formalV2InProgress: entries.filter(
        (entry) => entry.formalManifest.version === 2
          && entry.formalManifest.state === 'in_progress',
      ).length,
      completeFormalReconciliations: statusCounts.complete,
      candidateCoverage: publicCandidates.length,
      candidateRecordsOutsidePublicCatalog:
        input.candidateBuild.candidates.length - publicCandidates.length,
      candidateOnlyRecords: publicCandidates.length - formalCandidateOverlap,
      formalCandidateOverlap,
      officialSourceDiscoveryRequired: entries.filter(
        (entry) => entry.upgradeStage === 'official_source_discovery_required',
      ).length,
      candidateCohort: {
        cohortId: input.candidateBuild.gapReport.cohortId,
        officialTargets: input.candidateBuild.summary.officialTargets,
        militaryExcluded: input.candidateBuild.summary.militaryExcluded,
        eligibleTargets: input.candidateBuild.summary.eligibleTargets,
        candidateManifests: input.candidateBuild.summary.candidateManifests,
        catalogLinkedCandidates:
          input.candidateBuild.summary.catalogLinkedManifests,
        limitedOfficialCatalogCandidates:
          input.candidateBuild.summary.reconciliationFallbackManifests,
        exactOfficialHttpsSources:
          input.candidateBuild.summary.exactOfficialHttpsSources,
      },
    },
    entries,
  }
}

function loadCatalog(repositoryRoot: string): DataBundle {
  const read = (name: string): unknown => JSON.parse(readFileSync(
    resolve(repositoryRoot, 'content', 'data', `${name}.json`),
    'utf8',
  )) as unknown
  return bundleSchema.parse({
    sources: read('sources'),
    cities: read('cities'),
    universities: read('universities'),
    programs: read('programs'),
    admissionCycles: read('admission-cycles'),
    scholarships: read('scholarships'),
  })
}

export function buildCurrentSourceManifestTrustLedger(
  checkedAt: string,
  repositoryRoot = resolve('.'),
): SourceManifestTrustLedgerReport {
  const root = resolve(repositoryRoot)
  const publicCatalog = selectPublishedData(loadCatalog(root), checkedAt)
  const formalManifestDirectory = resolve(root, 'content', 'source-manifests')
  const formalManifests = validateSourceManifests(
    loadSourceManifestFiles(formalManifestDirectory),
    resolve(root, 'content', 'data', 'universities.json'),
  )
  const { build } = buildCurrentSourceManifestCohort(checkedAt, root)
  return buildSourceManifestTrustLedger({
    checkedAt,
    publicUniversities: publicCatalog.universities.map((university) => ({
      id: university.id,
      slug: university.slug,
      name: {
        en: university.name.en ?? null,
        zh: university.name.zh ?? null,
      },
    })),
    formalManifests,
    candidateBuild: build,
  })
}

export function parseSourceManifestTrustLedgerCli(
  argv: string[],
): SourceManifestTrustLedgerCli {
  let checkedAt: string | undefined
  let outputPath: string | undefined
  const seen = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (seen.has(argument)) {
      throw new Error(`Duplicate CLI option: ${argument}\n${CLI_USAGE}`)
    }
    seen.add(argument)
    if (argument !== '--checked-at' && argument !== '--output') {
      throw new Error(`Unknown CLI option: ${argument}\n${CLI_USAGE}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}\n${CLI_USAGE}`)
    }
    index += 1
    if (argument === '--checked-at') checkedAt = value
    else outputPath = value
  }
  if (!checkedAt || Number.isNaN(Date.parse(`${checkedAt}T00:00:00Z`))) {
    throw new Error(`--checked-at requires a real YYYY-MM-DD date\n${CLI_USAGE}`)
  }
  if (new Date(`${checkedAt}T00:00:00Z`).toISOString().slice(0, 10) !== checkedAt) {
    throw new Error(`--checked-at requires a real YYYY-MM-DD date\n${CLI_USAGE}`)
  }
  return { checkedAt, ...(outputPath ? { outputPath } : {}) }
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === ''
    || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

export function writeSourceManifestTrustLedger(
  report: SourceManifestTrustLedgerReport,
  outputPath: string,
  repositoryRoot = resolve('.'),
): string {
  const output = resolve(outputPath)
  if (isInside(resolve(repositoryRoot), output)) {
    throw new Error('Trust-ledger output must remain outside the repository')
  }
  if (existsSync(output)) {
    throw new Error('Trust-ledger output must not overwrite an existing file')
  }
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })
  return output
}

function runCli(): void {
  const options = parseSourceManifestTrustLedgerCli(process.argv.slice(2))
  const repositoryRoot = resolve('.')
  const report = buildCurrentSourceManifestTrustLedger(
    options.checkedAt,
    repositoryRoot,
  )
  if (options.outputPath) {
    const output = writeSourceManifestTrustLedger(
      report,
      options.outputPath,
      repositoryRoot,
    )
    process.stdout.write(`${JSON.stringify({
      output,
      checkedAt: report.checkedAt,
      summary: report.summary,
    })}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    runCli()
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
