import { afterEach, describe, expect, it, vi } from 'vitest'
import { catalogCacheControl } from '@/lib/catalog-api/cache-policy'
import { handleCatalogRequest, ok } from '@/lib/catalog-api/http'
import { releaseFromBundle } from '@/lib/catalog-api/service'
import type { ApiEnvelope } from '@/lib/catalog-api/types'

function envelope(evaluatedForDate: string): ApiEnvelope<null> {
  return {
    data: null,
    meta: {
      release: releaseFromBundle({
        sources: [], cities: [], universities: [], programs: [],
        admissionCycles: [], scholarships: [],
      }, evaluatedForDate, { evaluatedForDate }),
      notice: 'test',
    },
  }
}

afterEach(() => vi.useRealTimers())

describe('catalog response evaluation date cache boundary', () => {
  it('does not give yesterday-evaluated data a new TTL when a request spans China midnight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-03T15:59:59.000Z'))
    const payload = envelope('2026-11-03')
    const response = await handleCatalogRequest(async () => {
      await Promise.resolve()
      vi.setSystemTime(new Date('2026-11-03T16:00:00.000Z'))
      return ok(payload)
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect((await response.json()).meta.release.evaluatedForDate).toBe('2026-11-03')
  })

  it('permits caching again for a newly evaluated response on the new China day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-03T16:00:00.000Z'))
    expect(ok(envelope('2026-11-04')).headers.get('Cache-Control')).toContain('s-maxage=300')
  })

  it.each(['2026-11-02', '2026-11-04', 'invalid-date'])('does not cache a mismatched evaluation date %s', (evaluatedForDate) => {
    expect(catalogCacheControl(new Date('2026-11-03T04:00:00.000Z'), evaluatedForDate)).toBe('no-store')
  })

  it('keeps current-day shared and stale windows within China midnight', () => {
    expect(catalogCacheControl(new Date('2026-11-03T15:59:59.000Z'), '2026-11-03'))
      .toBe('public, max-age=1, s-maxage=1, stale-while-revalidate=0, must-revalidate')
  })

  it.each([null, {}, { meta: null }, { meta: { release: {} } }, { meta: { release: { evaluatedForDate: 20261103 } } }])
    ('does not cache a response without a valid evaluation date: %j', (payload) => {
      expect(ok(payload).headers.get('Cache-Control')).toBe('no-store')
    })
})
