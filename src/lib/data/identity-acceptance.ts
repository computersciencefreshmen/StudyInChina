import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { City, Program, Scholarship, University } from './types'

export const identityEntityTypeSchema = z.enum(['city', 'university', 'program', 'scholarship'])
export type IdentityEntityType = z.infer<typeof identityEntityTypeSchema>
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u)
export const verifiedProgramNameSchema = z.object({ en: z.string().trim().min(1).optional(), zh: z.string().trim().min(1).optional() })
  .strict().refine(name => Boolean(name.en || name.zh), 'At least one verified official name is required')
export type VerifiedProgramName = z.infer<typeof verifiedProgramNameSchema>
export const reviewedProgramAliasAuditSchema = z.object({
  ruleVersion: z.literal('suep-explicit-metadata-suffix-v1'),
  proofArtifactKey: z.string().min(1), proofSha256: sha256,
  existingIdentitySha256: sha256, proposalId: z.string().min(1), proposalContentSha256: sha256,
  source: z.object({ sourceId: z.string().min(1), url: z.url(), snapshotSha256: sha256,
    objectKey: z.string().min(1), canonicalTextSha256: sha256, textArtifactKey: z.string().min(1) }).strict(),
}).strict()
export type ReviewedProgramAliasAudit = z.infer<typeof reviewedProgramAliasAuditSchema>
export function verifiedNameMatchesRaw(name: VerifiedProgramName, raw: Program['name']): boolean {
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase()
  return Object.entries(name).every(([locale, value]) => typeof raw[locale as keyof typeof raw] === 'string'
    && normalize(raw[locale as keyof typeof raw]!) === normalize(value))
}
export const identityAcceptanceSchema = z.object({
  entityType: identityEntityTypeSchema,
  recordId: z.string().min(1),
  identitySha256: sha256,
  sourceIds: z.array(z.string().min(1)).min(1),
  acceptedAt: z.iso.datetime(),
  reviewer: z.string().min(1),
  receiptPath: z.string().min(1),
  receiptSha256: sha256,
  verifiedName: verifiedProgramNameSchema.optional(),
  verifiedNameAlias: reviewedProgramAliasAuditSchema.optional(),
}).strict().superRefine((entry, context) => {
  if (entry.verifiedName && entry.entityType !== 'program') context.addIssue({ code: 'custom', message: 'Scoped official names apply only to programs' })
  if (entry.verifiedNameAlias && (entry.entityType !== 'program' || !entry.verifiedName)) context.addIssue({ code: 'custom', message: 'Reviewed program alias requires scoped official names' })
})
export const identityAcceptanceLedgerSchema = z.object({
  schemaVersion: z.literal(1), entries: z.array(identityAcceptanceSchema),
}).strict()
export type IdentityAcceptance = z.infer<typeof identityAcceptanceSchema>
export type IdentityAcceptanceLedger = z.infer<typeof identityAcceptanceLedgerSchema>

/** One independently reviewed literal metadata decomposition. Never strip names
 * generally: real directions and every other programme remain exact matches. */
export function verifiedNameMatchesRecord(entry: IdentityAcceptance, record: Program): boolean {
  if (!entry.verifiedName) return false
  const alias = entry.verifiedNameAlias
  if (!alias) return verifiedNameMatchesRaw(entry.verifiedName, record.name)
  return alias.ruleVersion === 'suep-explicit-metadata-suffix-v1'
    && record.id === 'prog-gap-wave8-2-suep-international-economy-trade-bachelor'
    && record.universityId === 'uni-shanghai-university-of-electric-power' && record.degreeLevel === 'bachelor'
    && record.name.en === "International Economy and Trade (English-taught Bachelor's Program)"
    && canonicalIdentityJson(entry.verifiedName) === canonicalIdentityJson({ en: 'International Economy and Trade' })
    && alias.existingIdentitySha256 === entry.identitySha256 && alias.existingIdentitySha256 === identityFingerprint('program', record)
    && alias.source.url === record.programUrl
}

/** Scoped display authority must be present in the immutable import receipt,
 * not inferred from an unchanged raw identity hash or a mutable locale list. */
export function scopedNameReceiptMatches(entry: IdentityAcceptance, input: unknown): boolean {
  if (!entry.verifiedName) return true
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const { sha256: receiptSha, ...receipt } = input as Record<string, unknown>
  if (receiptSha !== entry.receiptSha256 || createHash('sha256').update(canonicalIdentityJson(receipt)).digest('hex') !== receiptSha
    || receipt.format !== 'studyinchina.identity-import-receipt' || receipt.formatVersion !== 1 || !Array.isArray(receipt.accepted)) return false
  return receipt.accepted.some(value => value && typeof value === 'object' && !Array.isArray(value)
    && value.recordId === entry.recordId && canonicalIdentityJson(value.verifiedName) === canonicalIdentityJson(entry.verifiedName)
    && canonicalIdentityJson(value.verifiedNameAlias) === canonicalIdentityJson(entry.verifiedNameAlias))
}

export function canonicalIdentityJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalIdentityJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalIdentityJson(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

/** Hash only explicitly accepted identity, never prices, deadlines or conditions. */
export function identityFingerprint(entityType: IdentityEntityType, record: City | University | Program | Scholarship): string {
  const identity: Record<string, unknown> = { entityType, id: record.id, slug: record.slug, name: record.name }
  if (entityType === 'city') {
    const city = record as City
    Object.assign(identity, { province: city.province, region: city.region })
  } else if (entityType === 'university') {
    const university = record as University
    Object.assign(identity, { cityId: university.cityId, officialUrl: university.officialUrl, region: university.region })
  } else if (entityType === 'program') {
    const program = record as Program
    Object.assign(identity, { universityId: program.universityId, degreeLevel: program.degreeLevel, programUrl: program.programUrl })
  } else {
    const scholarship = record as Scholarship
    Object.assign(identity, { providerType: scholarship.providerType, universityIds: [...scholarship.universityIds].sort() })
  }
  return createHash('sha256').update(canonicalIdentityJson(identity)).digest('hex')
}
