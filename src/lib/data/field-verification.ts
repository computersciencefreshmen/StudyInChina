import { createHash } from 'node:crypto'
import { z } from 'zod'
import { admissionCycleSchema, programSchema, programSupplementaryDetailsSchema, scholarshipSchema } from './schema'
import { canonicalIdentityJson } from './identity-acceptance'
import { getTodayDate } from './freshness'
import type { AdmissionCycle, DataBundle, Program, Scholarship } from './types'

const hash = z.string().regex(/^[a-f0-9]{64}$/u)
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value
})
export const fieldVerificationSchema = z.object({
  entityType: z.enum(['program', 'admissionCycle', 'scholarship']), recordId: z.string().min(1),
  recordScopeSha256: hash, fieldPath: z.string().min(1), value: z.unknown(), valueSha256: hash,
  factStatus: z.enum(['known', 'officially_not_announced', 'not_applicable']).default('known'),
  sourceId: z.string().min(1), sourceUrl: z.url(), snapshotSha256: hash, objectKey: z.string().min(1),
  locator: z.string().min(1), quote: z.string().min(1), verifiedAt: z.iso.datetime(), reviewAfter: calendarDate,
  review: z.object({ method: z.enum(['rules', 'dual-model', 'independent']), reviewerId: z.string().min(1), promptSha256: hash.optional() }).strict(),
  receiptPath: z.string().min(1), receiptSha256: hash,
}).strict()
export const fieldVerificationLedgerSchema = z.object({ schemaVersion: z.literal(1), entries: z.array(fieldVerificationSchema) }).strict()
export type FieldVerification = z.infer<typeof fieldVerificationSchema>

export const fieldValueSha256 = (value: unknown) => createHash('sha256').update(canonicalIdentityJson(value)).digest('hex')

/** Bind the complete accepted leaf proof without creating a receipt-hash cycle. */
export function fieldVerificationContentSha256(entry: FieldVerification): string {
  const content: Record<string, unknown> = { ...entry }
  delete content.receiptPath
  delete content.receiptSha256
  return fieldValueSha256(content)
}

/** An annual or scope change invalidates old evidence even if the scalar value is unchanged. */
export function fieldRecordScopeSha256(entityType: FieldVerification['entityType'], record: Program | AdmissionCycle | Scholarship): string {
  if (entityType === 'admissionCycle') {
    const cycle = record as AdmissionCycle
    return fieldValueSha256({ entityType, id: cycle.id, programId: cycle.programId, academicYear: cycle.academicYear, intake: cycle.intake })
  }
  if (entityType === 'program') {
    const program = record as Program
    return fieldValueSha256({ entityType, id: program.id, universityId: program.universityId, name: program.name, degreeLevel: program.degreeLevel, programUrl: program.programUrl })
  }
  const scholarship = record as Scholarship
  return fieldValueSha256({ entityType, id: scholarship.id, name: scholarship.name, providerType: scholarship.providerType,
    universityIds: [...scholarship.universityIds].sort(), programIds: [...scholarship.programIds].sort() })
}

function fieldSchema(entityType: FieldVerification['entityType'], path: string): z.ZodType | undefined {
  if (entityType === 'program') {
    const fields: Record<string, z.ZodType> = { teachingLanguages: programSchema.shape.teachingLanguages,
      durationMonths: programSchema.shape.durationMonths, durationMonthsMax: programSchema.shape.durationMonthsMax,
      durationText: programSchema.shape.durationText, applyUrl: programSchema.shape.applyUrl, languageRequirements: programSchema.shape.languageRequirements }
    if (fields[path]) return fields[path]
    const nested = /^(?:details|supplementaryDetails)\.([a-zA-Z]+)$/u.exec(path)?.[1]
    if (nested && Object.hasOwn(programSupplementaryDetailsSchema.shape, nested))
      return programSupplementaryDetailsSchema.shape[nested as keyof typeof programSupplementaryDetailsSchema.shape]
  }
  if (entityType === 'admissionCycle') {
    const fields: Record<string, z.ZodType> = { opensOn: admissionCycleSchema.shape.opensOn, closesOn: admissionCycleSchema.shape.closesOn,
      dateStatus: admissionCycleSchema.shape.dateStatus, tuitionCny: admissionCycleSchema.shape.tuitionCny,
      tuitionPeriod: admissionCycleSchema.shape.tuitionPeriod, tuitionStatus: admissionCycleSchema.shape.tuitionStatus,
      tuitionSchedule: admissionCycleSchema.shape.tuitionSchedule, applicationFeeCny: admissionCycleSchema.shape.applicationFeeCny }
    return fields[path]
  }
  if (entityType === 'scholarship') {
    const fields: Record<string, z.ZodType> = { deadline: scholarshipSchema.shape.deadline, applicationUrl: scholarshipSchema.shape.applicationUrl,
      eligibility: scholarshipSchema.shape.eligibility }
    if (fields[path]) return fields[path]
    const nested = /^coverage\.([a-zA-Z]+)$/u.exec(path)?.[1]
    if (nested && Object.hasOwn(scholarshipSchema.shape.coverage.shape, nested))
      return scholarshipSchema.shape.coverage.shape[nested as keyof typeof scholarshipSchema.shape.coverage.shape]
  }
}

function getField(record: unknown, path: string): unknown {
  let value = record
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return value
}

export function validateFieldVerification(bundle: DataBundle, input: unknown, today = getTodayDate()): FieldVerification | undefined {
  const parsed = fieldVerificationSchema.safeParse(input)
  if (!parsed.success) return undefined
  const entry = parsed.data, verifiedDay = getTodayDate(new Date(entry.verifiedAt))
  if (verifiedDay > today || entry.reviewAfter < today || entry.reviewAfter < verifiedDay
    || Date.parse(`${entry.reviewAfter}T00:00:00Z`) - Date.parse(`${verifiedDay}T00:00:00Z`) > 31 * 86_400_000) return undefined
  const records = entry.entityType === 'program' ? bundle.programs : entry.entityType === 'admissionCycle' ? bundle.admissionCycles : bundle.scholarships
  const record = records.find(row => row.id === entry.recordId)
  if (!record || record.status === 'draft' || record.status === 'archived' || !record.sourceIds.includes(entry.sourceId)) return undefined
  const source = bundle.sources.find(row => row.id === entry.sourceId && row.official && row.url === entry.sourceUrl)
  if (!source) return undefined
  const url = new URL(entry.sourceUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined
  const schema = fieldSchema(entry.entityType, entry.fieldPath)
  if (!schema || !schema.safeParse(entry.value).success || entry.value === undefined || entry.valueSha256 !== fieldValueSha256(entry.value)
    || entry.valueSha256 !== fieldValueSha256(getField(record, entry.fieldPath))
    || entry.recordScopeSha256 !== fieldRecordScopeSha256(entry.entityType, record)) return undefined
  if (entry.factStatus === 'known' && entry.value === null) return undefined
  return entry
}

type PublicFieldEvidence = { status: FieldVerification['factStatus']; officialUrl: string; sourceTitle: string; checkedAt: string }
type FieldDiscovery = { currentFacts?: boolean; currentFieldPaths?: string[]; fieldStates?: Record<string, FieldVerification['factStatus']>;
  fieldMeta?: Record<string, PublicFieldEvidence> }
function setField(record: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let target = record
  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) target[part] = {}
    target = target[part] as Record<string, unknown>
  }
  target[parts.at(-1)!] = structuredClone(value)
}

/** Pure allowlisted overlay. It does not renew a record, change its status, or expose raw siblings. */
export function applyFreshFieldVerifications(raw: DataBundle, projected: DataBundle, today: string, entries: FieldVerification[]): DataBundle {
  const result = structuredClone(projected)
  const valid = entries.flatMap(entry => { const accepted = validateFieldVerification(raw, entry, today); return accepted ? [accepted] : [] })
    .sort((a, b) => a.verifiedAt.localeCompare(b.verifiedAt) || a.receiptSha256.localeCompare(b.receiptSha256))
  for (const entry of valid) {
    const records = entry.entityType === 'program' ? result.programs : entry.entityType === 'admissionCycle' ? result.admissionCycles : result.scholarships
    // A field receipt cannot grant a previously rejected identity or resurrect a hidden cycle.
    const record = records.find(row => row.id === entry.recordId) as (Program | AdmissionCycle | Scholarship) & { discovery?: FieldDiscovery } | undefined
    if (!record) continue
    const path = entry.entityType === 'program' && entry.fieldPath.startsWith('details.') && !(record as Program).details
      ? entry.fieldPath.replace(/^details\./u, 'supplementaryDetails.') : entry.fieldPath
    setField(record as unknown as Record<string, unknown>, path, entry.value)
    if (record.discovery) record.discovery = { ...record.discovery,
      currentFieldPaths: [...new Set([...(record.discovery.currentFieldPaths ?? []), entry.fieldPath])],
      fieldStates: { ...record.discovery.fieldStates, [entry.fieldPath]: entry.factStatus },
      fieldMeta: { ...record.discovery.fieldMeta, [entry.fieldPath]: { status: entry.factStatus, officialUrl: entry.sourceUrl,
        sourceTitle: raw.sources.find(source => source.id === entry.sourceId)!.title, checkedAt: entry.verifiedAt } } }
  }
  return result
}
