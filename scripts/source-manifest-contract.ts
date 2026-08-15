import { z } from 'zod'

import {
  SOURCE_CATEGORIES,
  sourceManifestSchema,
} from '../workers/ingestion/src/manifest-schema'

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
  coverage: z.array(coverageSchema).length(SOURCE_CATEGORIES.length),
  catalogReconciliation: catalogReconciliationSchema,
}).strict()

export type SourceManifestV2 = z.infer<typeof sourceManifestV2Schema>
export type SourceManifestRecord = PilotSourceManifest | SourceManifestV2
