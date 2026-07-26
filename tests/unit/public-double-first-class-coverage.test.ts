import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildPublicDoubleFirstClassCoverage,
} from '../../scripts/ingestion/build-public-double-first-class-coverage'

type JsonRecord = Record<string, unknown>

describe('public Double First-Class coverage table', () => {
  it('lists all 147 official targets and only exposes complete three-source manifests', () => {
    const output = buildPublicDoubleFirstClassCoverage()
    const totals = output.totals as JsonRecord
    const institutions = output.institutions as JsonRecord[]

    expect(institutions).toHaveLength(147)
    expect(totals.institutionTargets).toBe(147)
    expect(totals.sourceManifestComplete).toBeGreaterThanOrEqual(100)
    expect(totals.verifiedOfficialSources).toBe(
      Number(totals.sourceManifestComplete) * 3,
    )
    expect(institutions.map((item) => item.ordinal)).toEqual(
      Array.from({ length: 147 }, (_, index) => index + 1),
    )

    for (const institution of institutions) {
      const sources = institution.sources as JsonRecord[]
      if (institution.status === 'source_manifest_complete') {
        expect(sources.map((source) => source.category).sort()).toEqual([
          'catalog_anchor',
          'international_admissions_home',
          'university_scholarship',
        ])
        expect(sources.every((source) => (
          typeof source.officialUrl === 'string'
          && source.officialUrl.startsWith('https://')
        ))).toBe(true)
      } else {
        expect(institution.status).toBe('collecting')
        expect(sources).toEqual([])
      }
    }
  })

  it('keeps the committed website snapshot equal to the deterministic builder output', () => {
    const snapshot = JSON.parse(readFileSync(join(
      process.cwd(),
      'src',
      'data',
      'generated',
      'double-first-class-coverage.json',
    ), 'utf8')) as unknown
    expect(snapshot).toEqual(buildPublicDoubleFirstClassCoverage())
  })
})
