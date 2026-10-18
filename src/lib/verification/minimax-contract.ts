import { z } from 'zod'

export const MINIMAX_PUBLIC_MAX_BYTES = 4 * 1024 * 1024
const count = z.number().int().nonnegative().max(1_000_000)
const identifier = z.string().min(1).max(200).regex(/^[a-zA-Z0-9:_'-]+$/)
export const minimaxPublicRecordSchema = z.object({
  taskId: identifier,
  collection: z.enum(['sources', 'cities', 'universities', 'programs', 'admission-cycles', 'scholarships']),
  recordId: identifier,
  recordSha256: z.string().regex(/^[a-f0-9]{64}$/),
  runId: z.string().min(16).max(160).regex(/^[a-zA-Z0-9-]+$/),
  checkedAt: z.iso.datetime(),
  model: z.string().min(1).max(80).regex(/^MiniMax-[a-zA-Z0-9.-]+$/),
  status: z.enum(['checked', 'partial', 'differences', 'unconfirmed']),
  totalFields: count,
  supportedFields: count,
  contradictedFields: count,
  unconfirmedFields: count,
  sourceIds: z.array(identifier).max(100),
  identityMatched: z.boolean(),
}).strict().superRefine((record, ctx) => {
  if (record.totalFields !== record.supportedFields + record.contradictedFields + record.unconfirmedFields) ctx.addIssue({ code: 'custom', message: 'Field totals must match.' })
  const expected = record.contradictedFields > 0 ? 'differences'
    : record.supportedFields === 0 ? 'unconfirmed'
      : record.supportedFields === record.totalFields && record.identityMatched ? 'checked' : 'partial'
  if (record.status !== expected) ctx.addIssue({ code: 'custom', message: 'Status must describe the actual field results.' })
})
export const minimaxPublicSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  methodology: z.literal('machine-comparison'),
  summary: z.object({ attemptedRecords: count, checkedRecords: count, partialRecords: count, differenceRecords: count, unconfirmedRecords: count, supportedFields: count, totalFields: count }).strict(),
  records: z.record(identifier, minimaxPublicRecordSchema),
}).strict().superRefine((snapshot, ctx) => {
  const records = Object.entries(snapshot.records)
  const expected = { attemptedRecords: records.length, checkedRecords: 0, partialRecords: 0, differenceRecords: 0, unconfirmedRecords: 0, supportedFields: 0, totalFields: 0 }
  for (const [key, record] of records) {
    if (key !== record.taskId || key !== `${record.collection}:${record.recordId}`) ctx.addIssue({ code: 'custom', message: 'Record identity mismatch.' })
    const field = { checked: 'checkedRecords', partial: 'partialRecords', differences: 'differenceRecords', unconfirmed: 'unconfirmedRecords' } as const
    expected[field[record.status]]++
    expected.supportedFields += record.supportedFields
    expected.totalFields += record.totalFields
    if (Date.parse(record.checkedAt) > Date.parse(snapshot.generatedAt) + 30_000) ctx.addIssue({ code: 'custom', message: 'Future record observation.' })
  }
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) if (snapshot.summary[key] !== expected[key]) ctx.addIssue({ code: 'custom', message: 'Summary totals must match the records.' })
})
export type MiniMaxPublicSnapshot = z.infer<typeof minimaxPublicSnapshotSchema>
export type MiniMaxPublicRecord = z.infer<typeof minimaxPublicRecordSchema>
