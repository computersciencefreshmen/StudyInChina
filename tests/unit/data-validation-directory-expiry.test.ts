import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { validateContentData } from '../../scripts/validate-data'

describe('calendar expiry in directory releases', () => {
  it('keeps strict raw authoring validation as the default', async () => {
    await expect(validateContentData(process.cwd(), '2026-10-25')).rejects.toThrow('past their review date')
  })
  it('accepts expiry only with valid directory proof and preserves exact raw bytes', async () => {
    const path = join(process.cwd(), 'content/data/programs.json'), before = readFileSync(path)
    const result = await validateContentData(process.cwd(), '2026-10-25', { directorySafeExpiry: true })
    expect(result.overdueRawVerifiedIds.length).toBeGreaterThan(0)
    expect(result.directory?.integrityPassed).toBe(true)
    expect(result.directory?.directoryCounts.programs).toBe(783)
    expect(result.directory?.currentFactsCounts.programs).toBeLessThan(783)
    expect(readFileSync(path).equals(before)).toBe(true)
  })
  it('does not bypass missing directory integrity evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'data-expiry-proof-test-'))
    try {
      mkdirSync(join(root, 'content/data'), { recursive: true })
      for (const file of ['sources', 'cities', 'universities', 'programs', 'admission-cycles', 'scholarships'])
        copyFileSync(join(process.cwd(), 'content/data', `${file}.json`), join(root, 'content/data', `${file}.json`))
      await expect(validateContentData(root, '2026-10-25', { directorySafeExpiry: true })).rejects.toThrow()
    } finally {
      const absolute = resolve(root)
      if (dirname(absolute) !== resolve(tmpdir()) || !basename(absolute).startsWith('data-expiry-proof-test-')) throw new Error('Unexpected cleanup target')
      rmSync(absolute, { recursive: true, force: true })
    }
  })
})
