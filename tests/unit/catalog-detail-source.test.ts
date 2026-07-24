import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('identity-only catalog detail source', () => {
  it('does not contain encoding-replacement question marks in user-visible separators', () => {
    const source = readFileSync(join(
      process.cwd(),
      'src',
      'app',
      '[locale]',
      'programs',
      '[slug]',
      'page.tsx',
    ), 'utf8')

    for (const placeholder of [
      ']} ? ${',
      '<span> ? {',
      'officialSource} ?',
      '{source.title} ?',
      '{source.publisher} ? {',
      ", locale, '?')",
    ]) {
      expect(source).not.toContain(placeholder)
    }
  })
})
