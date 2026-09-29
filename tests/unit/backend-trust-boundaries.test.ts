import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { D1CatalogRepository } from '@/lib/catalog/d1'
import { catalogCacheControl } from '@/lib/catalog-api/cache-policy'
import { getApplicationState } from '@/lib/data/admission'
import { isContentPreviewEnabled } from '@/lib/data/preview'
import type { AdmissionCycle } from '@/lib/data/types'
import { applicationState, chinaCalendarDate } from '../../workers/catalog-api/src/sql-data'

function directive(policy: string, name: string) {
  return Number(policy.split(', ').find((part) => part.startsWith(`${name}=`))?.split('=')[1])
}

describe('admissions calendar cache boundary', () => {
  it.each([
    ['2026-09-16T15:50:00.000Z', 600],
    ['2026-09-16T15:55:00.000Z', 300],
    ['2026-09-16T15:59:50.000Z', 10],
    ['2026-09-16T15:59:59.000Z', 1],
  ])('expires the browser and shared-cache stale windows before midnight at %s', (instant, remaining) => {
    const policy = catalogCacheControl(new Date(instant))
    expect(directive(policy, 'max-age') + directive(policy, 'stale-while-revalidate')).toBeLessThanOrEqual(remaining)
    expect(directive(policy, 's-maxage') + directive(policy, 'stale-while-revalidate')).toBeLessThanOrEqual(remaining)
    expect(policy).toContain('must-revalidate')
  })

  it('disables caching in the final partial second and restores it in the new day', () => {
    expect(catalogCacheControl(new Date('2026-09-16T15:59:59.500Z'))).toBe('no-store')
    expect(catalogCacheControl(new Date('2026-09-16T16:00:00.000Z'))).toContain('s-maxage=300')
  })
})

describe('content preview deployment boundary', () => {
  it.each([
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', VERCEL_ENV: 'production' },
    { NODE_ENV: 'development', VERCEL_ENV: 'production' },
    {},
  ])('withholds drafts outside an explicit preview runtime: %o', (environment) => {
    expect(isContentPreviewEnabled({ ...environment, CONTENT_PREVIEW: 'true' })).toBe(false)
  })

  it.each([
    { NODE_ENV: 'production', VERCEL_ENV: 'preview' },
    { NODE_ENV: 'development' },
    { NODE_ENV: 'test' },
  ])('permits the opt-in in development and Vercel Preview: %o', (environment) => {
    expect(isContentPreviewEnabled({ ...environment, CONTENT_PREVIEW: 'true' })).toBe(true)
    expect(isContentPreviewEnabled(environment)).toBe(false)
  })
})

describe('application state parity across JSON, Worker and migrated D1', () => {
  const today = chinaCalendarDate()
  const dateOffset = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
  const cases = [
    { opensOn: null, closesOn: dateOffset(-1), rolling: true, expected: 'closed' },
    { opensOn: dateOffset(1), closesOn: dateOffset(20), rolling: true, expected: 'upcoming' },
    { opensOn: null, closesOn: null, rolling: true, expected: 'rolling' },
    { opensOn: null, closesOn: today, rolling: false, expected: 'dates-published' },
    { opensOn: dateOffset(-1), closesOn: today, rolling: false, expected: 'open' },
    { opensOn: null, closesOn: null, rolling: false, expected: 'not-announced' },
  ]

  it.each(cases)('preserves $expected semantics for $opensOn / $closesOn / rolling=$rolling', (scenario) => {
    const cycle = {
      opensOn: scenario.opensOn,
      closesOn: scenario.closesOn,
      dateStatus: scenario.rolling ? 'rolling' : scenario.opensOn || scenario.closesOn ? 'published' : 'not-announced',
    } as AdmissionCycle
    expect(getApplicationState(cycle, today)).toBe(scenario.expected)
    expect(applicationState(scenario.opensOn, scenario.closesOn, scenario.rolling, today)).toBe(scenario.expected)

    const db = new DatabaseSync(':memory:')
    try {
      db.exec(`
        CREATE TABLE current_record_fields (release_id TEXT, record_id TEXT, field_path TEXT);
        CREATE TABLE current_catalog_records (release_id TEXT, record_id TEXT);
        CREATE TABLE current_application_routes (release_id TEXT, application_route_id TEXT);
        CREATE TABLE application_windows (release_id TEXT, application_window_id TEXT, application_route_id TEXT, round_label TEXT, opens_on TEXT, closes_on TEXT, rolling INTEGER);
        INSERT INTO current_catalog_records VALUES ('release', 'window');
        INSERT INTO current_application_routes VALUES ('release', 'route');
        INSERT INTO current_record_fields VALUES ('release', 'window', 'opens_on'), ('release', 'window', 'closes_on'), ('release', 'window', 'rolling');
      `)
      db.prepare('INSERT INTO application_windows VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        'release', 'window', 'route', null, scenario.opensOn, scenario.closesOn, Number(scenario.rolling),
      )
      db.exec(readFileSync('infra/d1/catalog/migrations/0011_application_state_calendar.sql', 'utf8'))
      const result = db.prepare('SELECT application_state FROM current_application_windows').get()!
      expect(String(result.application_state).replace('not_announced', 'not-announced')).toBe(scenario.expected)
    } finally {
      db.close()
    }
  })
})


describe('D1 runtime evaluation date cache', () => {
  it('refreshes release metadata across midnight even within its 60-second cache TTL', async () => {
    let now = Date.parse('2026-09-16T15:59:50.000Z')
    const counts = { sources: 0, cities: 0, universities: 0, programs: 0, admissionCycles: 0, scholarships: 0 }
    const fetcher = vi.fn(async () => Response.json({ data: {
      id: 'test-release', dataDate: '2026-09-01', generatedAt: '2026-09-01T00:00:00Z',
      recordCounts: counts, publicCounts: counts, rawCounts: counts,
      evaluatedForDate: chinaCalendarDate(new Date(now)),
    } }))
    const repository = new D1CatalogRepository({ apiUrl: 'https://catalog.test', now: () => now, fetch: fetcher })
    expect((await repository.getOperationalRelease()).evaluatedForDate).toBe('2026-09-16')
    await repository.getOperationalRelease()
    expect(fetcher).toHaveBeenCalledTimes(1)
    now += 20_000
    expect((await repository.getOperationalRelease()).evaluatedForDate).toBe('2026-09-17')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ cache: 'no-store' }))
  })
})
