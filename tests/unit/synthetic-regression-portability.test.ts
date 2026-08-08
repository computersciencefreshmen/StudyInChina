import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  canonicalSyntheticFixtureBytes,
  loadSyntheticFixtureRegistry,
  runSyntheticRegression,
} from '../../scripts/quality/synthetic-regression'

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('synthetic regression fixture portability', () => {
  it('uses the same integrity digest for LF and CRLF text checkouts', () => {
    const lf = canonicalSyntheticFixtureBytes(Buffer.from('line one\nline two\n'))
    const crlf = canonicalSyntheticFixtureBytes(Buffer.from('line one\r\nline two\r\n'))

    expect(crlf).toEqual(lf)
    expect(sha256(crlf)).toBe(sha256(lf))
  })

  it('runs every registered isolated fixture on the current platform', () => {
    const registry = loadSyntheticFixtureRegistry()
    const results = runSyntheticRegression(registry)

    expect(results).toHaveLength(7)
    expect(results.map((item) => item.fixtureId)).toHaveLength(new Set(
      results.map((item) => item.fixtureId),
    ).size)
  })
})
