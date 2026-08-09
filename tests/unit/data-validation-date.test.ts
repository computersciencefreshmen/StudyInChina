import { describe, expect, it } from 'vitest'

import { resolveDataValidationDate } from '../../src/lib/data/freshness'

describe('data validation calendar date', () => {
  it('rolls over at midnight in Asia/Shanghai rather than midnight UTC', () => {
    expect(resolveDataValidationDate(undefined, new Date('2026-08-08T15:59:59.999Z')))
      .toBe('2026-08-08')
    expect(resolveDataValidationDate(undefined, new Date('2026-08-08T16:00:00.000Z')))
      .toBe('2026-08-09')
  })

  it('keeps an explicit validation date deterministic for CI and audits', () => {
    expect(resolveDataValidationDate(
      '2026-07-31',
      new Date('2026-08-08T16:00:00.000Z'),
    )).toBe('2026-07-31')
  })
})
