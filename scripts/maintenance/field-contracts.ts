import { z } from 'zod'
import { sha256Schema } from './contracts'

export const MAINTAINED_PROGRAM_FIELDS = ['teachingLanguages', 'durationMonths', 'durationMonthsMax', 'durationText', 'applyUrl', 'languageRequirements',
  'supplementaryDetails.faculty', 'supplementaryDetails.qualification', 'supplementaryDetails.languagePolicy',
  'supplementaryDetails.curriculumHighlights', 'supplementaryDetails.eligibility', 'supplementaryDetails.applicationMaterials', 'supplementaryDetails.campus'] as const
export const MAINTAINED_CYCLE_FIELDS = ['opensOn', 'closesOn', 'dateStatus', 'tuitionCny', 'tuitionPeriod', 'tuitionStatus', 'tuitionSchedule', 'applicationFeeCny'] as const
export const MAINTAINED_SCHOLARSHIP_FIELDS = ['deadline', 'applicationUrl', 'eligibility', 'coverage.tuition', 'coverage.accommodation', 'coverage.insurance', 'coverage.stipendCnyPerMonth'] as const
export const maintainedFieldPathSchema = z.enum([...MAINTAINED_PROGRAM_FIELDS, ...MAINTAINED_CYCLE_FIELDS, ...MAINTAINED_SCHOLARSHIP_FIELDS])
export const fieldPatchFieldsSchema = z.object({
  recordScopeSha256: sha256Schema,
  patches: z.array(z.object({ fieldPath: maintainedFieldPathSchema, value: z.unknown(),
    factStatus: z.enum(['known', 'officially_not_announced', 'not_applicable']).default('known') }).strict()).min(1).max(30),
}).strict().superRefine((fields, context) => {
  const paths = fields.patches.map(patch => patch.fieldPath)
  if (new Set(paths).size !== paths.length) context.addIssue({ code: 'custom', message: 'A patch cannot verify the same field twice' })
})
export const maintenanceRecordTargetSchema = z.object({
  recordId: z.string().min(1), entityType: z.enum(['program', 'admission-cycle', 'scholarship']),
  universityId: z.string().min(1), sourceIds: z.array(sha256Schema).min(1), recordScopeSha256: sha256Schema,
  identity: z.record(z.string(), z.unknown()), year: z.string().nullable(), intake: z.string().nullable(),
  fields: z.partialRecord(maintainedFieldPathSchema, z.unknown()), reviewAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
}).strict()
export type MaintenanceRecordTarget = z.infer<typeof maintenanceRecordTargetSchema>
export type FieldPatchFields = z.infer<typeof fieldPatchFieldsSchema>

export function maintainedFieldPaths(entityType: MaintenanceRecordTarget['entityType']): readonly string[] {
  return entityType === 'program' ? MAINTAINED_PROGRAM_FIELDS : entityType === 'admission-cycle' ? MAINTAINED_CYCLE_FIELDS : MAINTAINED_SCHOLARSHIP_FIELDS
}
