import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/v1/programs/compare/route'
import { getData } from '@/lib/data/load'

describe('program comparison API', () => {
  it('returns at most four lightweight records in requested order', async () => {
    const ids = getData().programs.slice(0, 4).map((program) => program.id)
    const response = await GET(new Request(
      `https://example.test/api/v1/programs/compare?ids=${encodeURIComponent(ids.join(','))}`,
    ))
    const payload = await response.json() as {
      data: {
        items: Array<{
          program: { id: string; university: { id: string }; fieldMeta: Record<string, unknown> }
          currentCycle: unknown
          linkedScholarshipCount: number
        }>
        missingIds: string[]
      }
    }

    expect(response.status).toBe(200)
    expect(payload.data.items.map((item) => item.program.id)).toEqual(ids)
    expect(payload.data.missingIds).toEqual([])
    expect(payload.data.items.every((item) => (
      item.program.university.id.length > 0
      && typeof item.linkedScholarshipCount === 'number'
      && Object.keys(item.program.fieldMeta).length > 0
    ))).toBe(true)
    expect(JSON.stringify(payload).length).toBeLessThan(150_000)
  })

  it('deduplicates ids and reports records that are no longer public', async () => {
    const id = getData().programs[0]!.id
    const response = await GET(new Request(
      `https://example.test/api/v1/programs/compare?ids=${id},${id},prog-missing-record`,
    ))
    const payload = await response.json() as {
      data: { items: Array<{ program: { id: string } }>; missingIds: string[] }
    }

    expect(response.status).toBe(200)
    expect(payload.data.items.map((item) => item.program.id)).toEqual([id])
    expect(payload.data.missingIds).toEqual(['prog-missing-record'])
  })

  it('rejects empty, malformed, or oversized comparisons without caching', async () => {
    for (const query of [
      '',
      '?ids=bad%20id',
      '?ids=prog-1,prog-2,prog-3,prog-4,prog-5',
    ]) {
      const response = await GET(new Request(
        `https://example.test/api/v1/programs/compare${query}`,
      ))
      expect(response.status).toBe(400)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })
})
