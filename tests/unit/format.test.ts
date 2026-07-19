import { describe, expect, it } from 'vitest'
import { formatCny, formatDate, isCurrentlyOpen, localize } from '@/lib/data/format'

describe('localized fact formatting', () => {
  it('uses the requested translation and falls back to English', () => {
    const value = { en: 'Computer Science', zh: '计算机科学' }

    expect(localize(value, 'zh')).toBe('计算机科学')
    expect(localize(value, 'ru')).toBe('Computer Science')
  })

  it('formats dates without a timezone day shift', () => {
    expect(formatDate('2026-01-05', 'en', 'Unknown')).toContain('2026')
    expect(formatDate('2026-01-05', 'zh', '未知')).toContain('1月5日')
    expect(formatDate(null, 'ru', 'Не объявлено')).toBe('Не объявлено')
  })

  it('formats CNY once per locale and preserves the unknown fallback', () => {
    expect(formatCny(12000, 'en', 'Unknown')).toContain('12,000')
    expect(formatCny(12000, 'zh', '未知')).toContain('12,000')
    expect(formatCny(null, 'en', 'Not announced')).toBe('Not announced')
  })

  it('only reports a complete, inclusive application window as open', () => {
    const today = new Date('2026-04-30T12:00:00Z')

    expect(isCurrentlyOpen('2026-01-01', '2026-04-30', today)).toBe(true)
    expect(isCurrentlyOpen('2026-05-01', '2026-06-01', today)).toBe(false)
    expect(isCurrentlyOpen(null, '2026-06-01', today)).toBe(false)
  })
})
