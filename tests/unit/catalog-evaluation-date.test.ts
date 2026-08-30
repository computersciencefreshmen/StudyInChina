import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET as listPrograms } from '@/app/api/v1/programs/route'
import { GET as comparePrograms } from '@/app/api/v1/programs/compare/route'
import { GET as getCurrentRelease } from '@/app/api/v1/releases/current/route'
import { createJsonCatalogRepository } from '@/lib/catalog'

const evaluationDate = '2040-01-15'

afterEach(() => {
  vi.useRealTimers()
})

describe('JSON runtime release evaluation dates', () => {
  it('reports the same query clock in list, comparison, and current-release responses without changing the snapshot date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${evaluationDate}T04:00:00Z`))

    const repository = createJsonCatalogRepository()
    const snapshotRelease = await repository.getRelease()
    const list = await (await listPrograms(new Request('https://example.test/api/v1/programs?limit=1'))).json()
    const comparison = await (await comparePrograms(new Request(
      `https://example.test/api/v1/programs/compare?ids=${encodeURIComponent(list.data[0].id)}`,
    ))).json()
    const current = await (await getCurrentRelease()).json()

    expect(snapshotRelease.dataDate).not.toBe(evaluationDate)
    for (const envelope of [list, comparison, current]) {
      expect(envelope.meta.release.evaluatedForDate).toBe(evaluationDate)
      expect(envelope.meta.release.dataDate).toBe(snapshotRelease.dataDate)
      expect(envelope.meta.release.dataCheckedThrough).toBe(snapshotRelease.dataCheckedThrough)
      expect(envelope.meta.release.id).toBe(snapshotRelease.id)
    }
    expect(current.data.evaluatedForDate).toBe(evaluationDate)
    // Future evaluation still masks stale facts; changing metadata must not refresh them.
    expect(list.data[0].status).toBe('stale')
    expect(list.data[0].durationMonths).toBeNull()
    await expect(repository.getRelease()).resolves.toEqual(snapshotRelease)
  })

  it.each(['listInstitutions', 'listPrograms', 'listScholarships'] as const)(
    '%s uses the explicit query date, not the clock or source-check date',
    async (method) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2039-12-01T04:00:00Z'))
      const repository = createJsonCatalogRepository()
      const snapshotRelease = await repository.getRelease()
      const before = JSON.stringify(await repository.getBundle())

      const result = await repository[method]({ today: evaluationDate, limit: 1 })

      expect(result.release.evaluatedForDate).toBe(evaluationDate)
      expect(result.release.dataDate).not.toBe(evaluationDate)
      expect(result.release.dataCheckedThrough).not.toBe(evaluationDate)
      expect(result.release.dataCheckedThrough).toBe(result.release.dataDate)
      await expect(repository.getRelease()).resolves.toEqual(snapshotRelease)
      expect(JSON.stringify(await repository.getBundle())).toBe(before)
    },
  )
})
