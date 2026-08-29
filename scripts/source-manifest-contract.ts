import { createHash } from 'node:crypto'
import { z } from 'zod'

import {
  SOURCE_CATEGORIES,
  sourceManifestSchema,
} from '../workers/ingestion/src/manifest-schema'
import type { SourceManifestV1 } from '../workers/ingestion/src/types'

export const SOURCE_PURPOSES = [
  'discovery',
  'entity_index',
  'entity_detail',
  'fact_sheet',
  'application_endpoint',
] as const

export type SourcePurpose = (typeof SOURCE_PURPOSES)[number]

export type SourceBinding = {
  sourceId: string
  purpose: SourcePurpose
  resourceKey: string
}

export function normalizeSourceResourceUrl(value: string): string {
  const url = new URL(value)
  url.hash = ''
  url.protocol = url.protocol.toLowerCase()
  url.hostname = url.hostname.toLowerCase()
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString()
}

export function sourceResourceKey(officialUrl: string): string {
  const digest = createHash('sha256')
    .update(normalizeSourceResourceUrl(officialUrl), 'utf8')
    .digest('hex')
  return `resource:${digest}`
}

export function sourcePurposeFor(source: SourceManifestV1): SourcePurpose {
  switch (source.sourceCategory) {
    case 'international_admissions_home':
    case 'catalog_anchor':
      return 'discovery'
    case 'application_portal':
      return 'application_endpoint'
    case 'undergraduate_catalog':
    case 'masters_catalog':
    case 'doctoral_catalog':
    case 'non_degree_catalog':
      return 'entity_index'
    case 'university_scholarship':
    case 'faculty_scholarship':
    case 'government_scholarship':
      return source.entityType === 'scholarship-cycle' ? 'entity_detail' : 'entity_index'
    case 'program_detail':
      return 'entity_detail'
    default:
      return 'fact_sheet'
  }
}

export function sourceBindingsForSources(sources: SourceManifestV1[]): SourceBinding[] {
  return sources.map((source) => ({
    sourceId: source.id,
    purpose: sourcePurposeFor(source),
    resourceKey: sourceResourceKey(source.officialUrl),
  }))
}

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

export const pilotSourceManifestSchema = z.object({
  version: z.literal(1),
  institutionId: z.string().min(1),
  catalogStatus: z.enum(['existing', 'planned_addition']),
  checkedAt: checkedAtSchema,
  sources: z.array(sourceManifestSchema).min(1),
  coverage: z.array(coverageSchema).length(SOURCE_CATEGORIES.length),
}).strict()

export type PilotSourceManifest = z.infer<typeof pilotSourceManifestSchema>

const reconciliationEntrySchema = z.object({
  sourceId: z.string().min(1),
  officialKey: z.string().min(1),
  officialName: z.string().min(1),
  entityType: z.enum(['program', 'scholarship']),
  status: z.enum(CATALOG_RECONCILIATION_STATUSES),
  recordId: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
}).strict()

const catalogReconciliationSchema = z.object({
  scope: z.enum([
    'full_official_catalog',
    'representative_international_programs',
    'limited_official_catalog',
  ]),
  status: z.enum(['complete', 'in_progress']),
  entries: z.array(reconciliationEntrySchema).min(1),
  note: z.string().min(1).optional(),
}).strict().superRefine((reconciliation, context) => {
  if (reconciliation.scope === 'representative_international_programs'
    && reconciliation.status === 'complete') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scope'],
      message:
        'representative_international_programs cannot claim complete catalog reconciliation',
    })
  }
})

const sourceBindingSchema = z.object({
  sourceId: z.string().min(1),
  purpose: z.enum(SOURCE_PURPOSES),
  resourceKey: z.string().regex(/^resource:[0-9a-f]{64}$/),
}).strict()

export const sourceManifestV2Schema = z.object({
  version: z.literal(2),
  institutionId: z.string().min(1),
  catalogStatus: z.enum(['existing', 'planned_addition']),
  manifestStatus: z.enum(['complete', 'in_progress']),
  checkedAt: checkedAtSchema,
  officialHosts: z.array(z.string().min(1)).min(1),
  // Fetch workers still consume the strict V1 source contract. V2 is the
  // institution-level trust envelope around those source manifests.
  sources: z.array(sourceManifestSchema).min(1),
  sourceBindings: z.array(sourceBindingSchema).min(1),
  coverage: z.array(coverageSchema).length(SOURCE_CATEGORIES.length),
  catalogReconciliation: catalogReconciliationSchema,
}).strict().superRefine((manifest, context) => {
  const sources = new Map(manifest.sources.map((source) => [source.id, source]))
  const seen = new Set<string>()

  for (const [index, binding] of manifest.sourceBindings.entries()) {
    if (seen.has(binding.sourceId)) {
      context.addIssue({
        code: 'custom',
        path: ['sourceBindings', index, 'sourceId'],
        message: `duplicate source binding: ${binding.sourceId}`,
      })
      continue
    }
    seen.add(binding.sourceId)
    const source = sources.get(binding.sourceId)
    if (!source) {
      context.addIssue({
        code: 'custom',
        path: ['sourceBindings', index, 'sourceId'],
        message: `source binding references unknown source: ${binding.sourceId}`,
      })
      continue
    }
    const expectedPurpose = sourcePurposeFor(source)
    if (binding.purpose !== expectedPurpose) {
      context.addIssue({
        code: 'custom',
        path: ['sourceBindings', index, 'purpose'],
        message: `source binding purpose must be ${expectedPurpose} for ${binding.sourceId}`,
      })
    }
    const expectedResourceKey = sourceResourceKey(source.officialUrl)
    if (binding.resourceKey !== expectedResourceKey) {
      context.addIssue({
        code: 'custom',
        path: ['sourceBindings', index, 'resourceKey'],
        message: `source binding resourceKey does not match officialUrl for ${binding.sourceId}`,
      })
    }
  }

  for (const source of manifest.sources) {
    if (!seen.has(source.id)) {
      context.addIssue({
        code: 'custom',
        path: ['sourceBindings'],
        message: `source binding is missing for ${source.id}`,
      })
    }
  }
})

export type SourceManifestV2 = z.infer<typeof sourceManifestV2Schema>
export type SourceManifestRecord = PilotSourceManifest | SourceManifestV2
