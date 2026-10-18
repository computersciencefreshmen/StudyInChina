import type { DataBundle } from '../data/types'
import { selectPublishedData } from '../data/publication'
import { getTodayDate } from '../data/freshness'
import { minimaxRecordFingerprint } from './record-fingerprint'
import { minimaxPublicSnapshotSchema, type MiniMaxPublicSnapshot } from './minimax-contract'

export function selectPublicMiniMaxLabels(snapshot: MiniMaxPublicSnapshot, data: DataBundle, today = getTodayDate()): MiniMaxPublicSnapshot {
  const visible = selectPublishedData(data, today)
  const collections = { sources: data.sources, cities: data.cities, universities: data.universities, programs: data.programs, 'admission-cycles': data.admissionCycles, scholarships: data.scholarships }
  const visibleCollections = { ...visible, 'admission-cycles': visible.admissionCycles }
  const allowed = new Map<string, string>()
  for (const [collection, records] of Object.entries(collections)) {
    const ids = new Set(visibleCollections[collection as keyof typeof visibleCollections].map(record => record.id))
    for (const record of records) if (ids.has(record.id)) allowed.set(`${collection}:${record.id}`, minimaxRecordFingerprint(record as unknown as Record<string, unknown>, data.sources as unknown as Record<string, unknown>[]))
  }
  const records = Object.fromEntries(Object.entries(snapshot.records).filter(([id, record]) => allowed.get(id) === record.recordSha256))
  const summary = { attemptedRecords: 0, checkedRecords: 0, partialRecords: 0, differenceRecords: 0, unconfirmedRecords: 0, supportedFields: 0, totalFields: 0 }
  const statusKey = { checked: 'checkedRecords', partial: 'partialRecords', differences: 'differenceRecords', unconfirmed: 'unconfirmedRecords' } as const
  for (const record of Object.values(records)) {
    summary.attemptedRecords++
    summary[statusKey[record.status]]++
    summary.supportedFields += record.supportedFields
    summary.totalFields += record.totalFields
  }
  return minimaxPublicSnapshotSchema.parse({ ...snapshot, records, summary })
}
