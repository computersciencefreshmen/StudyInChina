import { afterEach, expect, it, vi } from 'vitest'

const readiness = vi.hoisted(() => ({ bundle: vi.fn(), snapshot: vi.fn() }))
vi.mock('@/lib/catalog/json', () => ({ JsonCatalogRepository: class { getBundle = readiness.bundle } }))
vi.mock('@/lib/catalog/public-snapshot', () => ({ getPublicCatalogSnapshot: readiness.snapshot }))

import { GET } from '@/app/api/health/route'

afterEach(() => { vi.resetAllMocks() })

it('returns readiness only after strict projection succeeds, without exposing private catalogue/evidence details', async () => {
  readiness.bundle.mockResolvedValue({ privateReceipt: '/private/review.json' })
  readiness.snapshot.mockReturnValue({ privateCounts: 999 })
  const ready = await GET()
  expect(ready.status).toBe(200)
  expect(ready.headers.get('cache-control')).toBe('no-store')
  expect(await ready.json()).toEqual({ status: 'ok' })
  readiness.snapshot.mockImplementation(() => { throw Error('private-path-or-hash') })
  const failed = await GET()
  expect(failed.status).toBe(503)
  expect(failed.headers.get('cache-control')).toBe('no-store')
  expect(await failed.json()).toEqual({ status: 'unavailable' })
  readiness.snapshot.mockReturnValue({})
  expect((await GET()).status).toBe(200)
})
