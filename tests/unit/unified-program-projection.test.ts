import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataBundle } from '@/lib/data/types'
import type { ThirdPartyProgram } from '@/lib/third-party-programs'
import { freezeSnapshot } from '@/lib/data/file-snapshot'
import { getCatalogData } from '@/lib/data/load'
import { getProgramFeedIndex, getProgramFeedRecord } from '@/lib/program-feed'
import { combineProgramRecords, queryUnifiedPrograms, resolveUnifiedProgram } from '@/lib/unified-programs'
import { parseProgramCatalogFilters } from '@/lib/program-catalog'

vi.mock('@/lib/data/load', () => ({ getCatalogData: vi.fn() }))
vi.mock('@/lib/program-feed', () => ({ getProgramFeedIndex: vi.fn(), getProgramFeedRecord: vi.fn() }))

const today = '2026-11-23'
function directory(): DataBundle {
  return { programs: [], universities: [], cities: [], sources: [], scholarships: [], admissionCycles: [] }
}
function record(id = 'source-a'): ThirdPartyProgram {
  return { id, sourceId: id, schoolId: 'source-school', schoolName: 'Source University', provider: 'CUCAS',
    name: 'History', sourceUrl: `https://example.cucas.cn/${id}`, fetchedAt: '2026-11-23T00:00:00Z',
    status: 'extracted', official: false, admissionYear: null,
    fields: { degree: 'Bachelor', language: 'English', duration: '4 Years', tuition: 'CNY 20000', startDate: '2027-09-01', deadline: '2027-07-01' } }
}
beforeEach(() => vi.resetAllMocks())

describe('bounded unified programme projection', () => {
  it('reuses only the same immutable directory, feed array, revision and day', () => {
    const data = freezeSnapshot(directory()), rows = [record()]
    const first = combineProgramRecords(data, rows, today, 'revision-a')
    expect(combineProgramRecords(data, rows, today, 'revision-a')).toBe(first)
    expect(Object.isFrozen(first.items)).toBe(true)
    expect(combineProgramRecords(data, rows, '2026-11-24', 'revision-a')).not.toBe(first)
    const changedRevision = combineProgramRecords(data, rows, today, 'revision-b')
    expect(changedRevision).not.toBe(first)
    const replacedFeed = combineProgramRecords(data, [record('source-new')], today, 'revision-b')
    expect([...replacedFeed.aliases.keys()]).toEqual(['source-new'])
    expect(combineProgramRecords(freezeSnapshot(directory()), rows, today, 'revision-a')).not.toBe(first)
    expect(() => combineProgramRecords(null as unknown as DataBundle, rows, today, 'revision-a')).toThrow()
  })

  it('never caches mutable injected data or shares one directory object with another', () => {
    const data = directory(), rows = [record()]
    const first = combineProgramRecords(data, rows, today, 'same-revision')
    rows[0].name = 'Updated source title'
    const second = combineProgramRecords(data, rows, today, 'same-revision')
    expect(second).not.toBe(first)
    expect('collected' in second.items[0] && second.items[0].collected.name).toBe('Updated source title')
    const other = freezeSnapshot(directory())
    expect(combineProgramRecords(other, [], today, 'same-revision').items).toEqual([])
    expect(combineProgramRecords(data, rows, today, 'same-revision').items).toHaveLength(1)
  })

  it('keeps the original first-match slug lookup when identities collide', () => {
    const result = combineProgramRecords(freezeSnapshot(directory()), [record(), { ...record(), name: 'Another offering' }], today, 'collision')
    expect(result.items).toHaveLength(2)
    expect(result.bySlug.get('source-a')).toBe(result.items[0])
  })

  it('keeps alias detail resolution while rejecting unavailable new inputs instead of using cached results', async () => {
    const data = freezeSnapshot(directory()), rows = [record(), record('source-b')]
    vi.mocked(getCatalogData).mockResolvedValue(data)
    vi.mocked(getProgramFeedIndex).mockResolvedValue({ programs: rows, revision: 'feed-a', generatedAt: '2026-11-23T00:00:00Z',
      summary: { capturedCount: 2, schoolCount: 1, sourceCount: 1 } })
    vi.mocked(getProgramFeedRecord).mockResolvedValue(rows[0])
    const list = await queryUnifiedPrograms(parseProgramCatalogFilters({}), today)
    expect(list.total).toBe(1)
    const detail = await resolveUnifiedProgram('source-b', today)
    expect(detail?.canonical).toBe('source-a')
    expect(detail?.revision).toBe(list.revision)
    expect(getProgramFeedRecord).toHaveBeenCalledWith('source-a')
    vi.mocked(getProgramFeedIndex).mockRejectedValue(new Error('feed unavailable'))
    await expect(queryUnifiedPrograms(parseProgramCatalogFilters({}), today)).rejects.toThrow('feed unavailable')
    await expect(resolveUnifiedProgram('source-b', today)).rejects.toThrow('feed unavailable')
    vi.mocked(getCatalogData).mockRejectedValue(new Error('directory unavailable'))
    await expect(queryUnifiedPrograms(parseProgramCatalogFilters({}), today)).rejects.toThrow()
  })
})
