import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET as programs } from '@/app/api/v1/directory/programs/route'
import { GET as scholarships } from '@/app/api/v1/directory/scholarships/route'
import { GET as institutions } from '@/app/api/v1/directory/institutions/route'
import { GET as compare } from '@/app/api/v1/programs/compare/route'
import * as runtime from '@/lib/catalog-api/runtime'
import { CatalogApiService, releaseFromBundle } from '@/lib/catalog-api/service'
import type { DataBundle } from '@/lib/data/types'

afterEach(() => vi.restoreAllMocks())
const empty: DataBundle = { sources: [], cities: [], universities: [], programs: [], scholarships: [], admissionCycles: [] }
function directory() {
  const service = new CatalogApiService(empty, releaseFromBundle(empty, '2026-10-24'), '2026-10-24')
  const spy = vi.spyOn(runtime, 'getCatalogDirectoryService').mockResolvedValue(service)
  return { service, spy }
}

describe('explicit public directory routes', () => {
  it.each([['programs', programs, 'listPrograms'], ['scholarships', scholarships, 'listScholarships'], ['institutions', institutions, 'listInstitutions']] as const)(
    'binds %s cursors to the directory view and evaluation date', async (path, handler, method) => {
      const { service } = directory(), list = vi.spyOn(service, method)
      const response = await handler(new Request(`https://example.test/api/v1/directory/${path}?limit=2&q=medicine`))
      expect(response.status).toBe(200)
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ view: 'directory', evaluatedForDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u), limit: 2, q: 'medicine' }))
      expect((await response.json()).data).toEqual([])
    })

  it('retains the current comparison default and supports an explicit safe directory view', async () => {
    const { service, spy } = directory()
    const current = vi.spyOn(runtime, 'compareCatalogPrograms').mockResolvedValue(service.comparePrograms(['p']))
    expect((await compare(new Request('https://example.test/api/v1/programs/compare?ids=p'))).status).toBe(200)
    expect(current).toHaveBeenCalledTimes(1)
    expect(spy).not.toHaveBeenCalled()
    expect((await compare(new Request('https://example.test/api/v1/programs/compare?view=directory&ids=p'))).status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(current).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized pages and invalid compare views without exposing internal data', async () => {
    directory()
    expect((await programs(new Request('https://example.test/api/v1/directory/programs?limit=101'))).status).toBe(400)
    expect((await compare(new Request('https://example.test/api/v1/programs/compare?view=raw&ids=p'))).status).toBe(400)
  })
})
