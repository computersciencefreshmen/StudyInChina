import { describe, expect, it } from 'vitest'

import sitemap from '@/app/sitemap'

describe('localized sitemap', () => {
  it('indexes the three fully translated locales and excludes beta and preview locales', () => {
    const entries = sitemap()
    const paths = entries.map((entry) => new URL(entry.url).pathname)

    for (const locale of ['en', 'zh', 'ru']) {
      expect(paths).toContain(`/${locale}`)
    }
    expect(paths.some((path) => ['de', 'fr', 'es'].some((locale) => path === `/${locale}` || path.startsWith(`/${locale}/`)))).toBe(false)
    expect(paths.some((path) => path === '/pt' || path.startsWith('/pt/'))).toBe(false)
    expect(paths.some((path) => path === '/ar' || path.startsWith('/ar/'))).toBe(false)

    const englishPrograms = entries.find((entry) => new URL(entry.url).pathname === '/en/programs')
    expect(Object.keys(englishPrograms?.alternates?.languages || {}).sort()).toEqual(['en', 'ru', 'zh'])
  })
})
