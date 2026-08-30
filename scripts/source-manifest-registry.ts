import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SOURCE_CATEGORIES,
} from '../workers/ingestion/src/manifest-schema'
import {
  normalizeAllowedHost,
  validateManifest,
} from '../workers/ingestion/src/security'
import type { SourceCategory, SourceManifestV1 } from '../workers/ingestion/src/types'
import {
  INSTITUTION_HOST_ALLOWLISTS,
} from './validate-source-manifests'
import {
  CATALOG_RECONCILIATION_STATUSES,
  pilotSourceManifestSchema,
  sourceBindingsForSources,
  sourceManifestV2Schema,
  sourcePurposeFor,
  sourceResourceKey,
  SOURCE_PURPOSES,
  type CatalogReconciliationStatus,
  type SourceBinding,
  type SourceManifestRecord,
  type SourceManifestV2,
  type SourcePurpose,
} from './source-manifest-contract'

export {
  CATALOG_RECONCILIATION_STATUSES,
  SOURCE_PURPOSES,
  sourceBindingsForSources,
  sourceManifestV2Schema,
  sourcePurposeFor,
  sourceResourceKey,
}
export type {
  CatalogReconciliationStatus,
  SourceBinding,
  SourceManifestRecord,
  SourceManifestV2,
  SourcePurpose,
}

export type LoadedSourceManifest = {
  filePath: string
  value: unknown
}

function manifestFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return manifestFiles(path)
      if (!entry.isFile() || !entry.name.endsWith('.json')) return []
      // Target registries describe cohorts, not fetchable institution manifests.
      if (/^targets(?:\.|-).*\.json$/i.test(entry.name)) return []
      return [path]
    })
    .sort((left, right) => left.localeCompare(right))
}

export function loadSourceManifestFiles(
  directory = join(process.cwd(), 'content', 'source-manifests'),
): LoadedSourceManifest[] {
  return manifestFiles(directory).map((filePath) => ({
    filePath,
    value: JSON.parse(readFileSync(filePath, 'utf8')) as unknown,
  }))
}

function errorMessage(filePath: string, message: string): string {
  return `${basename(filePath)}: ${message}`
}

function approvedHosts(record: SourceManifestRecord): Set<string> {
  if (record.version === 2) {
    return new Set(record.officialHosts.map(normalizeAllowedHost))
  }
  const legacy = INSTITUTION_HOST_ALLOWLISTS[
    record.institutionId as keyof typeof INSTITUTION_HOST_ALLOWLISTS
  ]
  if (legacy) return new Set(legacy.map(normalizeAllowedHost))
  return new Set(
    record.sources.flatMap((source) => [
      ...source.allowedHosts,
      ...(source.allowedRedirectHosts ?? []),
    ]).map(normalizeAllowedHost),
  )
}

function validateCoverage(
  record: SourceManifestRecord,
  filePath: string,
  errors: string[],
): void {
  const sourcesById = new Map(record.sources.map((source) => [source.id, source]))
  const coverageByCategory = new Map<SourceCategory, (typeof record.coverage)[number]>()

  for (const coverage of record.coverage) {
    if (coverageByCategory.has(coverage.sourceCategory)) {
      errors.push(errorMessage(filePath, `duplicate coverage category ${coverage.sourceCategory}`))
    }
    coverageByCategory.set(coverage.sourceCategory, coverage)
    const hasKnownSource = [
      'registered',
      'parser_pending',
      'source_unavailable',
    ].includes(coverage.status)

    if (hasKnownSource) {
      if (!coverage.sourceIds?.length) {
        errors.push(errorMessage(
          filePath,
          `${coverage.sourceCategory} ${coverage.status} coverage requires sourceIds`,
        ))
        continue
      }
      if (coverage.status === 'registered' && coverage.note !== undefined) {
        errors.push(errorMessage(
          filePath,
          `${coverage.sourceCategory} registered coverage must not include a note`,
        ))
      }
      if (coverage.status !== 'registered' && !coverage.note) {
        errors.push(errorMessage(
          filePath,
          `${coverage.sourceCategory} ${coverage.status} coverage requires a note`,
        ))
      }
      const seen = new Set<string>()
      for (const sourceId of coverage.sourceIds) {
        if (seen.has(sourceId)) {
          errors.push(errorMessage(filePath, `${coverage.sourceCategory} repeats ${sourceId}`))
        }
        seen.add(sourceId)
        const source = sourcesById.get(sourceId)
        if (!source) {
          errors.push(errorMessage(
            filePath,
            `${coverage.sourceCategory} references unknown source ${sourceId}`,
          ))
        } else if (source.sourceCategory !== coverage.sourceCategory) {
          errors.push(errorMessage(
            filePath,
            `${sourceId} is ${source.sourceCategory}, not ${coverage.sourceCategory}`,
          ))
        } else if (coverage.status === 'registered' && !source.enabled) {
          errors.push(errorMessage(
            filePath,
            `${sourceId} is disabled and cannot claim registered coverage`,
          ))
        } else if (coverage.status !== 'registered' && source.enabled) {
          errors.push(errorMessage(
            filePath,
            `${sourceId} must be disabled while coverage is ${coverage.status}`,
          ))
        }
      }
    } else {
      if (coverage.sourceIds !== undefined) {
        errors.push(errorMessage(
          filePath,
          `${coverage.sourceCategory} missing coverage must omit sourceIds`,
        ))
      }
      if (!coverage.note) {
        errors.push(errorMessage(
          filePath,
          `${coverage.sourceCategory} missing coverage requires a note`,
        ))
      }
    }
  }

  for (const category of SOURCE_CATEGORIES) {
    const coverage = coverageByCategory.get(category)
    if (!coverage) {
      errors.push(errorMessage(filePath, `missing coverage category ${category}`))
      continue
    }
    const actual = record.sources
      .filter((source) => source.sourceCategory === category)
      .map((source) => source.id)
      .sort()
    const declared = [...(coverage.sourceIds ?? [])].sort()
    if (actual.join('|') !== declared.join('|')) {
      errors.push(errorMessage(
        filePath,
        `${category} coverage must reference every and only source in that category`,
      ))
    }
  }
}

export function isCatalogReconciliationComplete(
  record: SourceManifestRecord,
): boolean {
  if (record.version !== 2) return false
  const terminalScope = record.catalogReconciliation.scope === 'full_official_catalog'
    || record.catalogReconciliation.scope === 'limited_official_catalog'
  return terminalScope
    && record.manifestStatus === 'complete'
    && record.catalogReconciliation.status === 'complete'
    && !record.catalogReconciliation.entries.some((entry) => entry.status === 'pending')
}

function validateReconciliation(
  record: SourceManifestV2,
  filePath: string,
  errors: string[],
): void {
  const sources = new Set(record.sources.map((source) => source.id))
  const officialKeys = new Set<string>()
  for (const entry of record.catalogReconciliation.entries) {
    if (officialKeys.has(entry.officialKey)) {
      errors.push(errorMessage(
        filePath,
        `catalog reconciliation repeats officialKey ${entry.officialKey}`,
      ))
    }
    officialKeys.add(entry.officialKey)
    if (!sources.has(entry.sourceId)) {
      errors.push(errorMessage(
        filePath,
        `catalog reconciliation references unknown source ${entry.sourceId}`,
      ))
    }
    if (entry.status === 'published' && !entry.recordId) {
      errors.push(errorMessage(
        filePath,
        `${entry.officialKey} published reconciliation requires recordId`,
      ))
    }
    if (entry.status !== 'published' && entry.status !== 'pending' && !entry.note) {
      errors.push(errorMessage(
        filePath,
        `${entry.officialKey} ${entry.status} reconciliation requires a note`,
      ))
    }
  }
  if (record.catalogReconciliation.status === 'complete'
    && record.catalogReconciliation.entries.some((entry) => entry.status === 'pending')) {
    errors.push(errorMessage(
      filePath,
      'complete catalog reconciliation cannot contain pending entries',
    ))
  }
  if (record.manifestStatus === 'complete') {
    if (record.coverage.some((coverage) => coverage.status === 'discovery_pending')) {
      errors.push(errorMessage(
        filePath,
        'complete manifest cannot contain discovery_pending coverage',
      ))
    }
    if (record.catalogReconciliation.status !== 'complete') {
      errors.push(errorMessage(
        filePath,
        'complete manifest requires complete catalog reconciliation',
      ))
    }
  }
}

export function validateSourceManifests(
  inputs: LoadedSourceManifest[],
  catalogPath = join(process.cwd(), 'content', 'data', 'universities.json'),
): SourceManifestRecord[] {
  const errors: string[] = []
  const parsedRecords: Array<{
    filePath: string
    record: SourceManifestRecord
  }> = []

  for (const input of inputs) {
    const version = typeof input.value === 'object'
      && input.value !== null
      && 'version' in input.value
      ? input.value.version
      : undefined
    const parsed = version === 2
      ? sourceManifestV2Schema.safeParse(input.value)
      : pilotSourceManifestSchema.safeParse(input.value)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(errorMessage(
          input.filePath,
          `${issue.path.join('.') || '<root>'}: ${issue.message}`,
        ))
      }
      continue
    }
    parsedRecords.push({
      filePath: input.filePath,
      record: parsed.data as SourceManifestRecord,
    })
  }

  const records = parsedRecords.map(({ record }) => record)
  if (records.length === 0) errors.push('No institution source manifests were found')
  const institutionIds = new Map<string, string>()
  const sourceIds = new Map<string, string>()
  for (const { filePath, record } of parsedRecords) {
    const previousInstitution = institutionIds.get(record.institutionId)
    if (previousInstitution) {
      errors.push(errorMessage(
        filePath,
        `duplicate institutionId ${record.institutionId}; first seen in ${previousInstitution}`,
      ))
    } else {
      institutionIds.set(record.institutionId, basename(filePath))
    }

    let hosts: Set<string>
    try {
      hosts = approvedHosts(record)
    } catch (error) {
      errors.push(errorMessage(
        filePath,
        error instanceof Error ? error.message : String(error),
      ))
      hosts = new Set()
    }

    for (const source of record.sources) {
      if (source.institutionId !== record.institutionId) {
        errors.push(errorMessage(filePath, `${source.id} has a mismatched institutionId`))
      }
      const previousSource = sourceIds.get(source.id)
      if (previousSource) {
        errors.push(errorMessage(
          filePath,
          `duplicate source id ${source.id}; first seen in ${previousSource}`,
        ))
      } else {
        sourceIds.set(source.id, basename(filePath))
      }
      try {
        validateManifest(source as SourceManifestV1)
      } catch (error) {
        errors.push(errorMessage(
          filePath,
          `${source.id}: ${error instanceof Error ? error.message : String(error)}`,
        ))
      }
      try {
        const sourceHost = normalizeAllowedHost(new URL(source.officialUrl).hostname)
        if (!hosts.has(sourceHost)) {
          errors.push(errorMessage(filePath, `${source.id} uses undeclared official host ${sourceHost}`))
        }
        for (const host of [...source.allowedHosts, ...(source.allowedRedirectHosts ?? [])]) {
          const normalized = normalizeAllowedHost(host)
          if (!hosts.has(normalized)) {
            errors.push(errorMessage(filePath, `${source.id} allowlists undeclared host ${normalized}`))
          }
        }
      } catch (error) {
        errors.push(errorMessage(
          filePath,
          `${source.id}: ${error instanceof Error ? error.message : String(error)}`,
        ))
      }
    }
    validateCoverage(record, filePath, errors)
    if (record.version === 2) validateReconciliation(record, filePath, errors)
  }

  const universities = JSON.parse(readFileSync(catalogPath, 'utf8')) as Array<{ id?: unknown }>
  const catalogIds = new Set(
    universities.map((university) => university.id)
      .filter((id): id is string => typeof id === 'string'),
  )
  for (const record of records) {
    if (record.catalogStatus === 'existing' && !catalogIds.has(record.institutionId)) {
      errors.push(`${record.institutionId}: existing institution is absent from universities.json`)
    }
    if (record.catalogStatus === 'planned_addition' && catalogIds.has(record.institutionId)) {
      errors.push(`${record.institutionId}: planned institution already exists in universities.json`)
    }
  }

  if (errors.length > 0) {
    throw new Error(`Source manifest validation failed:\n${errors.join('\n')}`)
  }
  return records
}

export function validateSourceManifestDirectory(
  directory?: string,
): SourceManifestRecord[] {
  return validateSourceManifests(loadSourceManifestFiles(directory))
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const records = validateSourceManifestDirectory()
    const sources = records.reduce((total, record) => total + record.sources.length, 0)
    const completed = records.filter(isCatalogReconciliationComplete).length
    console.log(
      `Validated ${records.length} institution manifests, ${sources} official sources, and ${completed} complete catalog reconciliations.`,
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
