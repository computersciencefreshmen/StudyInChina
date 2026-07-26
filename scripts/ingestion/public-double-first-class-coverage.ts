import {
  readFileSync,
  readdirSync,
} from 'node:fs'
import { join } from 'node:path'

import {
  RECONCILIATION_CATEGORIES,
  loadSourceReconciliations,
  type ReconciledSourceCategory,
} from './source-reconciliation'

type JsonRecord = Record<string, unknown>

type Target = {
  targetId: string
  ordinal: number
  officialNameZh: string
  catalogInstitutionId?: string
}

type CohortSource = {
  targetId: string
  institutionId: string
  institutionNameEn: string
  institutionNameZh: string
  region: string
  province: string
  sourceCategory: (typeof RECONCILIATION_CATEGORIES)[number]
  officialUrl: string
  evidenceUrl: string
  verificationMethod: string
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function readJson(path: string): JsonRecord {
  return record(JSON.parse(readFileSync(path, 'utf8')) as unknown, path)
}

export function buildPublicDoubleFirstClassCoverageV2(input: {
  targetPath: string
  cohortDirectory: string
  reconciliationDirectory: string
}): JsonRecord {
  const registry = readJson(input.targetPath)
  const targets = registry.targets as Target[]
  if (!Array.isArray(targets) || targets.length !== 147) {
    throw new Error('Double First-Class target registry must contain exactly 147 institutions')
  }
  const officialSource = record(registry.officialSource, 'registry.officialSource')
  const sourcesByName = new Map<string, {
    checkedAt: string
    sources: CohortSource[]
  }>()
  const sourceIds = new Set<string>()
  for (const fileName of readdirSync(input.cohortDirectory)
    .filter((name) => name.endsWith('.official-sources.v1.json'))
    .sort((left, right) => left.localeCompare(right, 'en'))) {
    const cohort = readJson(join(input.cohortDirectory, fileName))
    const checkedAt = string(cohort.checkedAt, `${fileName}.checkedAt`)
    if (!Array.isArray(cohort.sources)) throw new Error(`${fileName}.sources must be an array`)
    for (const [index, rawSource] of cohort.sources.entries()) {
      const label = `${fileName}.sources[${index}]`
      const source = record(rawSource, label) as CohortSource
      const sourceId = string(source.targetId, `${label}.targetId`)
      if (sourceIds.has(sourceId)) throw new Error(`Duplicate source target ID ${sourceId}`)
      sourceIds.add(sourceId)
      const nameZh = string(source.institutionNameZh, `${label}.institutionNameZh`)
      const current = sourcesByName.get(nameZh) ?? { checkedAt, sources: [] }
      if (current.checkedAt !== checkedAt) {
        throw new Error(`${nameZh} has conflicting source check dates`)
      }
      current.sources.push(source)
      sourcesByName.set(nameZh, current)
    }
  }
  const reconciliations = new Map(loadSourceReconciliations(
    input.reconciliationDirectory,
  ).map((institution) => [institution.institutionNameZh, institution]))
  const targetNames = new Set(targets.map((target) => target.officialNameZh))
  for (const name of [...sourcesByName.keys(), ...reconciliations.keys()]) {
    if (!targetNames.has(name)) throw new Error(`${name} is not in the official 147-school registry`)
  }
  for (const name of reconciliations.keys()) {
    if (sourcesByName.has(name)) {
      throw new Error(`${name} appears in both a complete source cohort and reconciliation`)
    }
  }

  const institutions = [...targets]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((target) => {
      const coverage = sourcesByName.get(target.officialNameZh)
      const reconciliation = reconciliations.get(target.officialNameZh)
      const cohortSources = [...(coverage?.sources ?? [])].sort((left, right) => (
        RECONCILIATION_CATEGORIES.indexOf(left.sourceCategory)
        - RECONCILIATION_CATEGORIES.indexOf(right.sourceCategory)
      ))
      if (
        cohortSources.length !== 0
        && (
          cohortSources.length !== RECONCILIATION_CATEGORIES.length
          || new Set(cohortSources.map((source) => source.sourceCategory)).size !== 3
        )
      ) {
        throw new Error(`${target.officialNameZh} does not have exactly three cohort sources`)
      }
      const identity = cohortSources[0]
      if (cohortSources.some((source) => (
        source.institutionId !== identity?.institutionId
        || source.institutionNameEn !== identity?.institutionNameEn
        || source.region !== identity?.region
        || source.province !== identity?.province
      ))) {
        throw new Error(`${target.officialNameZh} has conflicting source identity metadata`)
      }
      const categories: Array<
        ReconciledSourceCategory
        | {
          sourceCategory: (typeof RECONCILIATION_CATEGORIES)[number]
          status: 'collecting'
          officialUrl: null
          evidenceUrl: null
          note: null
          checkedAt: null
        }
      > = coverage
        ? cohortSources.map((source) => ({
            sourceCategory: source.sourceCategory,
            status: 'verified_official',
            officialUrl: source.officialUrl,
            evidenceUrl: source.evidenceUrl,
            note: source.verificationMethod,
            checkedAt: coverage.checkedAt,
          }))
        : reconciliation
          ? reconciliation.categories
          : RECONCILIATION_CATEGORIES.map((sourceCategory) => ({
              sourceCategory,
              status: 'collecting',
              officialUrl: null,
              evidenceUrl: null,
              note: null,
              checkedAt: null,
            }))
      const verifiedSources = categories.filter(
        (category): category is ReconciledSourceCategory & { officialUrl: string } => (
          category.status === 'verified_official' && category.officialUrl !== null
        ),
      )
      const status = coverage || verifiedSources.length === 3
        ? 'source_manifest_complete'
        : reconciliation
          ? 'reconciled_limited'
          : 'collecting'
      return {
        ordinal: target.ordinal,
        targetId: target.targetId,
        institutionId: identity?.institutionId ?? target.catalogInstitutionId ?? null,
        nameZh: target.officialNameZh,
        nameEn: identity?.institutionNameEn ?? null,
        region: identity?.region ?? null,
        province: identity?.province ?? null,
        status,
        checkedAt: coverage?.checkedAt ?? reconciliation?.checkedAt ?? null,
        sourceCount: verifiedSources.length,
        reconciliationCount: status === 'collecting' ? 0 : 3,
        sources: verifiedSources.map((category) => ({
          category: category.sourceCategory,
          officialUrl: category.officialUrl,
          verificationMethod: category.note,
        })),
        categories: categories.map((category) => ({
          category: category.sourceCategory,
          status: category.status,
          officialUrl: category.officialUrl,
          evidenceUrl: category.evidenceUrl,
          note: category.note,
        })),
      }
    })
  const completeCount = institutions.filter(
    (institution) => institution.status === 'source_manifest_complete',
  ).length
  const limitedCount = institutions.filter(
    (institution) => institution.status === 'reconciled_limited',
  ).length
  const collectingCount = institutions.filter(
    (institution) => institution.status === 'collecting',
  ).length
  const checkedDates = institutions
    .map((institution) => institution.checkedAt)
    .filter((value): value is string => value !== null)
    .sort()
  return {
    format: 'studyinchina.public-double-first-class-coverage',
    formatVersion: 2,
    generatedAt: `${checkedDates.at(-1) ?? officialSource.checkedAt}T00:00:00.000Z`,
    officialRegistry: {
      titleZh: officialSource.titleZh,
      pageUrl: officialSource.pageUrl,
      attachmentUrl: officialSource.attachmentUrl,
      publishedAt: officialSource.publishedAt,
      checkedAt: officialSource.checkedAt,
    },
    totals: {
      institutionTargets: institutions.length,
      reconciledInstitutionTargets: completeCount + limitedCount,
      sourceManifestComplete: completeCount,
      reconciledLimited: limitedCount,
      collecting: collectingCount,
      verifiedOfficialSources: institutions.reduce(
        (total, institution) => total + institution.sourceCount,
        0,
      ),
    },
    institutions,
  }
}
