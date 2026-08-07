import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  SOURCE_CATEGORIES,
  sourceManifestSchema,
} from '../workers/ingestion/src/manifest-schema'
import {
  normalizeAllowedHost,
  validateManifest,
} from '../workers/ingestion/src/security'
import type { SourceCategory, SourceManifestV1 } from '../workers/ingestion/src/types'
import {
  INSTITUTION_HOST_ALLOWLISTS,
  pilotSourceManifestSchema,
  type PilotSourceManifest,
} from './validate-source-manifests'

export const CATALOG_RECONCILIATION_STATUSES = [
  'published',
  'individual_application_unavailable',
  'discontinued',
  'not_announced',
  'source_unavailable',
  'pending',
] as const

export type CatalogReconciliationStatus =
  (typeof CATALOG_RECONCILIATION_STATUSES)[number]

const coverageStatusSchema = z.enum([
  'registered',
  'parser_pending',
  'source_unavailable',
  'discovery_pending',
  'officially_not_provided',
])

const coverageSchema = z.object({
  sourceCategory: z.enum(SOURCE_CATEGORIES),
  status: coverageStatusSchema,
  sourceIds: z.array(z.string().min(1)).optional(),
  note: z.string().min(1).optional(),
}).strict()

const checkedAtSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
  { message: 'checkedAt must be a real ISO calendar date' },
)

const reconciliationEntrySchema = z.object({
  sourceId: z.string().min(1),
  officialKey: z.string().min(1),
  officialName: z.string().min(1),
  entityType: z.enum(['program', 'scholarship']),
  status: z.enum(CATALOG_RECONCILIATION_STATUSES),
  recordId: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
}).strict()

export const sourceManifestV2Schema = z.object({
  version: z.literal(2),
  institutionId: z.string().min(1),
  catalogStatus: z.enum(['existing', 'planned_addition']),
  manifestStatus: z.enum(['complete', 'in_progress']),
  checkedAt: checkedAtSchema,
  officialHosts: z.array(z.string().min(1)).min(1),
  // Individual fetch manifests remain V1 because this is the format consumed
  // by the ingestion Worker. V2 describes the institution-level contract.
  sources: z.array(sourceManifestSchema).min(1),
  coverage: z.array(coverageSchema).length(SOURCE_CATEGORIES.length),
  catalogReconciliation: z.object({
    scope: z.enum([
      'full_official_catalog',
      'representative_international_programs',
      'limited_official_catalog',
    ]),
    status: z.enum(['complete', 'in_progress']),
    entries: z.array(reconciliationEntrySchema).min(1),
    note: z.string().min(1).optional(),
  }).strict(),
}).strict()

export type SourceManifestV2 = z.infer<typeof sourceManifestV2Schema>
export type SourceManifestRecord = PilotSourceManifest | SourceManifestV2

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
  return record.manifestStatus === 'complete'
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
