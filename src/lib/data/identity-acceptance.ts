import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { City, Program, Scholarship, University } from './types'

export const identityEntityTypeSchema = z.enum(['city', 'university', 'program', 'scholarship'])
export type IdentityEntityType = z.infer<typeof identityEntityTypeSchema>
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u)
export const identityAcceptanceSchema = z.object({
  entityType: identityEntityTypeSchema,
  recordId: z.string().min(1),
  identitySha256: sha256,
  sourceIds: z.array(z.string().min(1)).min(1),
  acceptedAt: z.iso.datetime(),
  reviewer: z.string().min(1),
  receiptPath: z.string().min(1),
  receiptSha256: sha256,
}).strict()
export const identityAcceptanceLedgerSchema = z.object({
  schemaVersion: z.literal(1), entries: z.array(identityAcceptanceSchema),
}).strict()
export type IdentityAcceptance = z.infer<typeof identityAcceptanceSchema>
export type IdentityAcceptanceLedger = z.infer<typeof identityAcceptanceLedgerSchema>

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
