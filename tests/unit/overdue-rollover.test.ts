import { describe, expect, it } from 'vitest'
import {
  parseRolloverArgs,
  rolloverOverdueRecords,
} from '../../scripts/quality/rollover-overdue-data'

describe('overdue data rollover', () => {
  it('marks only verified records past the review date as stale without mutating input', () => {
    const records = [
      { id: 'overdue', status: 'verified' as const, reviewAfter: '2026-08-24', value: 'keep' },
      { id: 'inclusive', status: 'verified' as const, reviewAfter: '2026-08-25', value: 'keep' },
      { id: 'already-stale', status: 'stale' as const, reviewAfter: '2026-01-01', value: 'keep' },
      { id: 'draft', status: 'draft' as const, reviewAfter: '2026-01-01', value: 'keep' },
    ]

    const result = rolloverOverdueRecords(records, '2026-08-25')

    expect(result.changedIds).toEqual(['overdue'])
    expect(result.records.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'overdue', status: 'stale' },
      { id: 'inclusive', status: 'verified' },
      { id: 'already-stale', status: 'stale' },
      { id: 'draft', status: 'draft' },
    ])
    expect(records[0].status).toBe('verified')
    expect(result.records.every((record) => record.value === 'keep')).toBe(true)
  })

  it('parses an explicit date and rejects invalid maintenance arguments', () => {
    expect(parseRolloverArgs(['--apply', '--today', '2026-08-25']))
      .toEqual({ apply: true, today: '2026-08-25' })
    expect(() => parseRolloverArgs(['--today', '2026-02-30'])).toThrow(/valid calendar date/)
    expect(() => parseRolloverArgs(['--unknown'])).toThrow(/Unknown argument/)
  })
})
