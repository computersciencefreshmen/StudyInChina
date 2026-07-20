import { describe, expect, it } from 'vitest'

import { publicLocales } from '@/i18n/config'
import { dictionaries, getMessages } from '@/i18n/messages'

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [shape(value[0])] : []
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, shape(nested)]))
  }
  return typeof value
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

describe('public message dictionaries', () => {
  it('has an exact, non-empty UI and legal-copy contract for every public locale', () => {
    const englishShape = shape(dictionaries.en)

    expect(Object.keys(dictionaries)).toEqual(publicLocales)
    for (const locale of publicLocales) {
      const messages = getMessages(locale)
      expect(shape(messages)).toEqual(englishShape)
      expect(strings(messages).every((value) => value.trim().length > 0)).toBe(true)
      expect(messages.legal.privacy.sections.length).toBeGreaterThan(0)
      expect(messages.legal.disclaimer.sections.length).toBeGreaterThan(0)
      expect(messages.legal.dataPolicy.sections.length).toBeGreaterThan(0)
    }
  })

  it('keeps the coordinate index disclaimer accurate in every public language', () => {
    for (const locale of publicLocales) {
      expect(getMessages(locale).cities.mapNote.toLowerCase()).not.toContain('approved standard-map base')
    }
  })
})
