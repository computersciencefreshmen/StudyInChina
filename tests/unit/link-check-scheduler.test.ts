import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error Maintenance entry point is intentionally plain JavaScript.
import { mapWithConcurrency, requestOnce } from '../../scripts/check-links.mjs'

describe('official source link scheduler', () => {
  it('spreads work across schools without overlapping one host', async () => {
    const items = [
      { url: 'https://a.edu.cn/one' }, { url: 'https://a.edu.cn/two' },
      { url: 'https://a.edu.cn/three' }, { url: 'https://b.edu.cn/one' },
      { url: 'https://c.edu.cn/one' },
    ]
    const active = new Set<string>()
    const started: string[] = []
    let peak = 0
    const result = await mapWithConcurrency(items, 2, async (item: { url: string }, index: number) => {
      const host = new URL(item.url).hostname
      expect(active.has(host)).toBe(false)
      active.add(host)
      peak = Math.max(peak, active.size)
      started.push(host)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active.delete(host)
      return index
    })
    expect(result).toEqual([0, 1, 2, 3, 4])
    expect(started.slice(0, 3)).toEqual(['a.edu.cn', 'b.edu.cn', 'c.edu.cn'])
    expect(peak).toBe(2)
  })

  it('handles empty input, invalid concurrency, and failed checks', async () => {
    expect(await mapWithConcurrency([], 3, () => null)).toEqual([])
    await expect(mapWithConcurrency([], 0, () => null)).rejects.toThrow('positive')
    await expect(mapWithConcurrency([{ url: 'https://a.edu.cn/' }], 1, () => {
      throw new Error('check failed')
    })).rejects.toThrow('check failed')
  })
})

describe('HTTP link classification', () => {
  it('preserves confirmed HTTP failures when response body cancellation fails', async () => {
    const body = new ReadableStream({
      pull: () => new Promise(() => undefined),
      cancel: () => Promise.reject(new Error('body cleanup failed')),
    })
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 404 }))
    try {
      const result = await requestOnce('https://a.edu.cn/missing', 'GET', 30)
      expect(result).toMatchObject({ kind: 'response', status: 404 })
    } finally {
      fetcher.mockRestore()
    }
  })
})
