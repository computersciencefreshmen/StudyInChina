import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { City, Program, Scholarship, Source, University } from './types'
import { HTML_PROGRAM_ALIAS_RULE, reviewedHtmlAliasProfile } from './reviewed-html-program-alias'

export const identityEntityTypeSchema = z.enum(['city', 'university', 'program', 'scholarship'])
export type IdentityEntityType = z.infer<typeof identityEntityTypeSchema>
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u)
export const verifiedProgramNameSchema = z.object({ en: z.string().trim().min(1).optional(), zh: z.string().trim().min(1).optional() })
  .strict().refine(name => Boolean(name.en || name.zh), 'At least one verified official name is required')
export type VerifiedProgramName = z.infer<typeof verifiedProgramNameSchema>
export const reviewedProgramAliasAuditSchema = z.object({
  ruleVersion: z.enum(['suep-explicit-metadata-suffix-v1', HTML_PROGRAM_ALIAS_RULE]),
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
  verifiedSourceUrl: z.url().refine(value => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
  }, 'Verified programme sources require credential-free HTTPS').optional(),
}).strict().superRefine((entry, context) => {
  if (entry.verifiedName && entry.entityType !== 'program') context.addIssue({ code: 'custom', message: 'Scoped official names apply only to programs' })
  if (entry.verifiedNameAlias && (entry.entityType !== 'program' || !entry.verifiedName)) context.addIssue({ code: 'custom', message: 'Reviewed program alias requires scoped official names' })
  if (entry.verifiedSourceUrl && (entry.entityType !== 'program' || !entry.verifiedName)) context.addIssue({ code: 'custom', message: 'Verified programme source requires scoped official program names' })
})
export const identityAcceptanceLedgerSchema = z.object({
  schemaVersion: z.literal(1), entries: z.array(identityAcceptanceSchema),
}).strict()
export type IdentityAcceptance = z.infer<typeof identityAcceptanceSchema>
export type IdentityAcceptanceLedger = z.infer<typeof identityAcceptanceLedgerSchema>

/** These exact records contain independently reviewed metadata aliases. Their
 * raw sibling locales never acquire legacy display authority when scope is lost.
 * Other legacy records keep their existing unscoped semantics. */
export function reviewedProgramNameScopeRequirement(recordId: string): 'name-and-alias' | 'name-only' | undefined {
  // The UPC scan review validates this Chinese identity only. Dropping its
  // reviewed name and receipt must never restore unreviewed sibling locales.
  if (recordId === 'prog-gap-prog-mew-ne-upc-chemical-engineering-master-en') return 'name-only'
  return recordId === 'prog-gap-wave8-2-suep-international-economy-trade-bachelor'
    || reviewedHtmlAliasProfile(recordId) !== undefined ? 'name-and-alias' : undefined
}
export function requiresReviewedProgramNameScope(recordId: string): boolean {
  return reviewedProgramNameScopeRequirement(recordId) !== undefined
}
export function hasRequiredProgramNameScope(entry: IdentityAcceptance): boolean {
  if (entry.entityType !== 'program') return true
  const requirement = reviewedProgramNameScopeRequirement(entry.recordId)
  return requirement === undefined || Boolean(entry.verifiedName && (requirement !== 'name-and-alias' || entry.verifiedNameAlias))
}

/** One independently reviewed literal metadata decomposition. Never strip names
 * generally: real directions and every other programme remain exact matches. */
export function verifiedNameMatchesRecord(entry: IdentityAcceptance, record: Program): boolean {
  if (!entry.verifiedName) return false
  const alias = entry.verifiedNameAlias
  if (!alias) return verifiedNameMatchesRaw(entry.verifiedName, record.name)
  if (alias.ruleVersion === HTML_PROGRAM_ALIAS_RULE) {
    const profile = reviewedHtmlAliasProfile(record.id)
    const codes = record as Program & { officialProgramCode?: string; departmentCode?: string }
    return Boolean(profile && entry.recordId === record.id && entry.entityType === 'program'
      && record.universityId === profile.universityId && record.degreeLevel === profile.degreeLevel
      && !codes.officialProgramCode && !codes.departmentCode
      && Object.entries(profile.oldNames).every(([locale, value]) => record.name[locale as 'en' | 'zh'] === value)
      && Object.entries(entry.verifiedName).every(([locale, value]) => (profile.allowedNames as Record<string, string>)[locale] === value)
      && Object.keys(entry.verifiedName).length > 0
      && alias.existingIdentitySha256 === profile.identitySha256 && entry.identitySha256 === profile.identitySha256
      && identityFingerprint('program', record) === profile.identitySha256
      && record.programUrl === profile.sourceUrl && alias.source.url === profile.sourceUrl
      && alias.source.sourceId === profile.sourceId && alias.source.snapshotSha256 === profile.rawSha256
      && alias.source.canonicalTextSha256 === profile.textSha256)
  }
  return alias.ruleVersion === 'suep-explicit-metadata-suffix-v1'
    && record.id === 'prog-gap-wave8-2-suep-international-economy-trade-bachelor'
    && record.universityId === 'uni-shanghai-university-of-electric-power' && record.degreeLevel === 'bachelor'
    && record.name.en === "International Economy and Trade (English-taught Bachelor's Program)"
    && canonicalIdentityJson(entry.verifiedName) === canonicalIdentityJson({ en: 'International Economy and Trade' })
    && alias.existingIdentitySha256 === entry.identitySha256 && alias.existingIdentitySha256 === identityFingerprint('program', record)
    && alias.source.url === record.programUrl
}

/** The reviewed document must be the same official source linked by both the
 * acceptance and raw record. It never changes the raw identity fingerprint. */
export function verifiedSourceUrlMatchesRecord(entry: IdentityAcceptance, record: Program, sources: Source[]): boolean {
  return entry.verifiedSourceUrl === undefined || sources.some(source => source.official && source.url === entry.verifiedSourceUrl
    && entry.sourceIds.includes(source.id) && record.sourceIds.includes(source.id))
}

/** Scoped display authority must be present in the immutable import receipt,
 * not inferred from an unchanged raw identity hash or a mutable locale list. */
export function scopedNameReceiptMatches(entry: IdentityAcceptance, input: unknown): boolean {
  if (!hasRequiredProgramNameScope(entry)) return false
  if (input === undefined && !entry.verifiedName && entry.verifiedSourceUrl === undefined) return true
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const { sha256: receiptSha, ...receipt } = input as Record<string, unknown>
  // Generic receipt integrity is checked by the strict store/validator. A
  // legacy scope check must not hash a shared bootstrap receipt per record.
  if (!entry.verifiedName) return entry.verifiedSourceUrl === undefined && (!Array.isArray(receipt.accepted)
    || !receipt.accepted.some(value => value && typeof value === 'object' && !Array.isArray(value) && value.recordId === entry.recordId
      && ['verifiedName', 'verifiedNameAlias', 'verifiedSourceUrl'].some(key => Object.hasOwn(value, key))))
  if (receiptSha !== entry.receiptSha256 || createHash('sha256').update(canonicalIdentityJson(receipt)).digest('hex') !== receiptSha) return false
  if (receipt.format !== 'studyinchina.identity-import-receipt' || receipt.formatVersion !== 1 || !Array.isArray(receipt.accepted)) return false
  return receipt.accepted.some(value => value && typeof value === 'object' && !Array.isArray(value)
    && value.recordId === entry.recordId && canonicalIdentityJson(value.verifiedName) === canonicalIdentityJson(entry.verifiedName)
    && canonicalIdentityJson(value.verifiedNameAlias) === canonicalIdentityJson(entry.verifiedNameAlias)
    && value.verifiedSourceUrl === entry.verifiedSourceUrl)
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
