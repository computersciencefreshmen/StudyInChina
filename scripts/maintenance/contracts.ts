import { z } from 'zod'

/** Shared by the cloud producer and the offline writer. No filesystem or Node imports. */
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
export const timestampSchema = z.string().datetime({ offset: true })
export const officialUrlSchema = z.url().refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password && !url.port
    && !url.hostname.includes(':') && !/^[\d.]+$/u.test(url.hostname)
}, 'Expected a credential-free public HTTPS URL')

export const SOURCE_CATEGORIES = [
  'international_admissions_home', 'undergraduate_catalog', 'masters_catalog',
  'doctoral_catalog', 'non_degree_catalog', 'current_guide', 'dates_deadlines',
  'fees', 'eligibility_language', 'application_portal', 'university_scholarship',
  'faculty_scholarship', 'government_scholarship', 'program_detail', 'contacts', 'catalog_anchor',
] as const

export const sourceSeedSchema = z.object({
  id: z.string().min(1), universityId: z.string().min(1), url: officialUrlSchema,
  allowedHosts: z.array(z.string().min(1)).min(1), sourceCategory: z.enum(SOURCE_CATEGORIES),
  entityType: z.enum(['university', 'program', 'program-cycle', 'scholarship', 'scholarship-cycle']),
  enabled: z.boolean(), registration: z.enum(['catalogue_official', 'candidate']),
}).strict().superRefine((seed, context) => {
  if (seed.registration === 'candidate' && seed.enabled) {
    context.addIssue({ code: 'custom', message: 'Unreviewed source discoveries cannot be enabled' })
  }
})

export const scopeSchoolSchema = z.object({
  universityId: z.string().min(1), name: z.record(z.string(), z.string().min(1)),
  originalStatus: z.enum(['draft', 'verified', 'stale', 'archived']),
  officialHosts: z.array(z.string().min(1)).min(1), sourceSeeds: z.array(sourceSeedSchema),
}).strict()

export const maintenanceScopeSchema = z.object({
  format: z.literal('studyinchina.maintenance-scope'), formatVersion: z.literal(1),
  scopeId: z.string().min(1), createdAt: timestampSchema, expectedSchoolCount: z.literal(272),
  inputCatalogSha256: sha256Schema, schools: z.array(scopeSchoolSchema).length(272),
  sha256: sha256Schema,
}).strict().superRefine((scope, context) => {
  const ids = scope.schools.map(school => school.universityId)
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Scope has duplicate schools' })
  for (const school of scope.schools) {
    if (school.sourceSeeds.some(seed => seed.universityId !== school.universityId)) {
      context.addIssue({ code: 'custom', message: 'Source seed belongs to another school' })
    }
  }
})

export const evidenceSchema = z.object({
  sourceId: z.string().min(1), url: officialUrlSchema, snapshotSha256: sha256Schema,
  objectKey: z.string().min(1), locator: z.string().min(1), quote: z.string().trim().min(1).max(8000),
}).strict()
export const fieldEvidenceSchema = evidenceSchema.extend({ fieldPath: z.string().min(1) })
export const candidateSourceSchema = evidenceSchema.omit({ sourceId: true }).extend({
  id: z.string().min(1), checkedAt: timestampSchema, contentType: z.string().min(1),
  /** For PDFs/browser captures, a checksum-bound extraction must be supplied separately. */
  textArtifact: z.object({
    objectKey: z.string().min(1), sha256: sha256Schema, rawSnapshotSha256: sha256Schema,
    parser: z.enum(['poppler', 'tesseract', 'browser-dom', 'windows-ocr-reviewed-v1', 'openxml-literal-workbook-v1']),
  }).strict().optional(),
})

export const programIdentityFieldsSchema = z.object({
  name: z.object({ en: z.string().trim().min(1).optional(), zh: z.string().trim().min(1).optional() })
    .strict().refine(name => Boolean(name.en || name.zh), 'Official program name is required'),
  degreeLevel: z.enum(['bachelor', 'master', 'doctorate', 'language', 'foundation', 'other']),
  programType: z.enum(['degree', 'language', 'foundation', 'exchange', 'visiting', 'short_term', 'other']),
  officialProgramCode: z.string().trim().min(1).optional(),
  departmentCode: z.string().trim().min(1).optional(),
  programUrl: officialUrlSchema,
  internationalAdmissionsEvidence: evidenceSchema,
}).strict()

export const independentReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']), reviewerId: z.string().min(1),
  method: z.enum(['human', 'independent_model', 'deterministic']), reviewedAt: timestampSchema,
  candidateSha256: sha256Schema, snapshotSha256: sha256Schema,
  checks: z.object({ internationalScope: z.boolean(), concreteProgram: z.boolean(), evidenceLocated: z.boolean() }).strict(),
  reviewAttemptId: z.string().min(1).optional(), artifactKey: z.string().min(1).optional(),
  reviewArtifactSha256: sha256Schema.optional(),
}).strict()

export const maintenanceProposalSchema = z.object({
  id: z.string().min(1), universityId: z.string().min(1),
  entityType: z.enum(['program', 'admission-cycle', 'scholarship']), recordId: z.string().min(1).nullable(),
  operation: z.enum(['create', 'patch']), fields: z.record(z.string(), z.unknown()),
  source: candidateSourceSchema, fieldEvidence: z.array(fieldEvidenceSchema).min(1),
  scope: z.object({ year: z.string().nullable(), intake: z.string().nullable() }).strict(),
  extractionAttemptId: z.string().min(1).nullable().optional(),
  status: z.enum(['ready', 'held']), warnings: z.array(z.string()), review: independentReviewSchema.optional(),
}).strict()

export const maintenanceCandidateExportSchema = z.object({
  format: z.literal('studyinchina.maintenance-candidate-export'), formatVersion: z.literal(1),
  batchId: z.string().min(1), inputCatalogSha256: sha256Schema, scopeRegistrySha256: sha256Schema,
  createdAt: timestampSchema, proposals: z.array(maintenanceProposalSchema), sha256: sha256Schema,
}).strict().superRefine((batch, context) => {
  const ids = batch.proposals.map(proposal => proposal.id)
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Duplicate proposal IDs' })
})

export type MaintenanceScope = z.infer<typeof maintenanceScopeSchema>
export type ScopeSchool = z.infer<typeof scopeSchoolSchema>
export type SourceSeed = z.infer<typeof sourceSeedSchema>
export type MaintenanceProposal = z.infer<typeof maintenanceProposalSchema>
export type CandidateExport = z.infer<typeof maintenanceCandidateExportSchema>
export type ProgramIdentityFields = z.infer<typeof programIdentityFieldsSchema>
export type SourceEvidence = z.infer<typeof evidenceSchema>

/** Stable JSON rejects values whose serialization could conceal a producer/writer disagreement. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  throw new Error('Only finite JSON values can be fingerprinted')
}

export async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function proposalContent(proposal: MaintenanceProposal): Record<string, unknown> {
  return {
    id: proposal.id, universityId: proposal.universityId, entityType: proposal.entityType,
    recordId: proposal.recordId, operation: proposal.operation, fields: proposal.fields,
    source: proposal.source, fieldEvidence: proposal.fieldEvidence, scope: proposal.scope,
    extractionAttemptId: proposal.extractionAttemptId ?? null,
  }
}

export function proposalContentSha256(proposal: MaintenanceProposal): Promise<string> {
  return sha256Text(canonicalJson(proposalContent(proposal)))
}

export function exportContentSha256(batch: Omit<CandidateExport, 'sha256'> | CandidateExport): Promise<string> {
  const content: Record<string, unknown> = { ...batch }
  delete content.sha256
  return sha256Text(canonicalJson(content))
}

export function scopeContentSha256(scope: Omit<MaintenanceScope, 'sha256'> | MaintenanceScope): Promise<string> {
  const content: Record<string, unknown> = { ...scope }
  delete content.sha256
  return sha256Text(canonicalJson(content))
}
