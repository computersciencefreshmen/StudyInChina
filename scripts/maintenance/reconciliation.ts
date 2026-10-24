import { z } from 'zod'
import { officialUrlSchema, sha256Schema } from './contracts'

export const RECONCILIATION_STATUSES = [
  'published', 'individual_application_unavailable', 'discontinued', 'not_announced', 'source_unavailable', 'pending',
] as const
export const PROGRAM_CATEGORIES = ['undergraduate_catalog', 'masters_catalog', 'doctoral_catalog', 'non_degree_catalog'] as const

export const schoolReconciliationSchema = z.object({
  universityId: z.string().min(1),
  scope: z.enum(['full_official_catalog', 'limited_official_catalog', 'representative_international_programs']),
  limitationNote: z.string().min(1).optional(),
  categories: z.array(z.object({
    category: z.enum(PROGRAM_CATEGORIES),
    status: z.enum(['captured', 'officially_not_provided', 'source_unavailable', 'discovery_pending']),
    evidenceUrl: officialUrlSchema.optional(), note: z.string().min(1).optional(),
  }).strict()),
  catalogs: z.array(z.object({
    sourceId: z.string().min(1), category: z.enum(PROGRAM_CATEGORIES), url: officialUrlSchema,
    snapshotSha256: sha256Schema, expectedRows: z.number().int().nonnegative().nullable(),
    expectedPages: z.number().int().positive(), capturedPages: z.array(z.number().int().positive()),
    expectedAttachments: z.array(z.string().min(1)), capturedAttachments: z.array(z.string().min(1)),
  }).strict()),
  entries: z.array(z.object({
    sourceId: z.string().min(1), officialKey: z.string().min(1),
    status: z.enum(RECONCILIATION_STATUSES), recordId: z.string().min(1).optional(), note: z.string().min(1).optional(),
  }).strict()),
}).strict()

export type SchoolReconciliation = z.infer<typeof schoolReconciliationSchema>

/** Count parity covers every official row, including exclusions; publication is a separate decision. */
export function evaluateSchoolReconciliation(input: unknown) {
  const value = schoolReconciliationSchema.parse(input)
  const blockers: string[] = []
  const categoryIds = value.categories.map(category => category.category)
  if (new Set(categoryIds).size !== categoryIds.length) blockers.push('duplicate_source_category')
  for (const category of PROGRAM_CATEGORIES) {
    const entry = value.categories.find(entry => entry.category === category)
    if (!entry) blockers.push(`${category}:coverage_missing`)
    else if (entry.status === 'discovery_pending') blockers.push(`${category}:discovery_pending`)
    else if (entry.status === 'source_unavailable') blockers.push(`${category}:source_unavailable`)
    else if (entry.status === 'officially_not_provided' && (!entry.evidenceUrl || !entry.note)) blockers.push(`${category}:absence_unproven`)
    else if (entry.status === 'captured' && !value.catalogs.some(catalog => catalog.category === category)) blockers.push(`${category}:catalog_missing`)
  }
  if (value.scope === 'representative_international_programs') blockers.push('representative_scope_is_not_complete')
  if (value.scope === 'limited_official_catalog' && !value.limitationNote) blockers.push('limited_scope_requires_note')
  if (value.catalogs.length === 0) blockers.push('no_captured_catalog')
  const sourceIds = value.catalogs.map(catalog => catalog.sourceId)
  if (new Set(sourceIds).size !== sourceIds.length) blockers.push('duplicate_catalog_source')
  const keys = new Set<string>()
  for (const entry of value.entries) {
    const key = `${entry.sourceId}\u0000${entry.officialKey}`
    if (keys.has(key)) blockers.push(`duplicate_official_row:${entry.officialKey}`)
    keys.add(key)
    if (!sourceIds.includes(entry.sourceId)) blockers.push(`unknown_source:${entry.sourceId}`)
    if (entry.status === 'pending') blockers.push(`pending_row:${entry.officialKey}`)
    if (entry.status === 'published' && !entry.recordId) blockers.push(`published_without_record:${entry.officialKey}`)
    if (entry.status !== 'published' && entry.status !== 'pending' && !entry.note) blockers.push(`unexplained_exclusion:${entry.officialKey}`)
  }
  for (const catalog of value.catalogs) {
    const rows = value.entries.filter(entry => entry.sourceId === catalog.sourceId)
    if (catalog.expectedRows === null) blockers.push(`${catalog.sourceId}:official_row_count_unknown`)
    else if (rows.length !== catalog.expectedRows) blockers.push(`${catalog.sourceId}:row_count_mismatch`)
    const pages = [...new Set(catalog.capturedPages)].sort((left, right) => left - right)
    if (pages.length !== catalog.capturedPages.length || pages.length !== catalog.expectedPages
      || pages.some((page, index) => page !== index + 1)) blockers.push(`${catalog.sourceId}:pages_incomplete`)
    const expected = [...new Set(catalog.expectedAttachments)].sort()
    const captured = [...new Set(catalog.capturedAttachments)].sort()
    if (expected.length !== catalog.expectedAttachments.length || captured.length !== catalog.capturedAttachments.length
      || JSON.stringify(expected) !== JSON.stringify(captured)) blockers.push(`${catalog.sourceId}:attachments_incomplete`)
  }
  return {
    universityId: value.universityId, scope: value.scope,
    status: blockers.length === 0 ? 'complete' as const : 'in_progress' as const,
    published: value.entries.filter(entry => entry.status === 'published').length,
    accountedRows: value.entries.length,
    officialRows: value.catalogs.every(catalog => catalog.expectedRows !== null)
      ? value.catalogs.reduce((count, catalog) => count + (catalog.expectedRows ?? 0), 0) : null,
    blockers: [...new Set(blockers)].sort(),
  }
}
