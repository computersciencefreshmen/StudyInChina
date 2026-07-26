import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildPublicDoubleFirstClassCoverage,
} from '../../scripts/ingestion/build-public-double-first-class-coverage'

type JsonRecord = Record<string, unknown>

describe('public Double First-Class coverage table', () => {
  it('reconciles all 147 official targets with three evidence-backed source categories', () => {
    const output = buildPublicDoubleFirstClassCoverage()
    const totals = output.totals as JsonRecord
    const institutions = output.institutions as JsonRecord[]
    const expectedCategories = [
      'catalog_anchor',
      'international_admissions_home',
      'university_scholarship',
    ]
    const verifiedOfficialSources = institutions.reduce((total, institution) => (
      total + (institution.sources as JsonRecord[]).length
    ), 0)

    expect(institutions).toHaveLength(147)
    expect(totals.institutionTargets).toBe(147)
    expect(totals.reconciledInstitutionTargets).toBe(147)
    expect(totals.collecting).toBe(0)
    expect(
      Number(totals.sourceManifestComplete)
      + Number(totals.reconciledLimited),
    ).toBe(147)
    expect(totals.verifiedOfficialSources).toBe(verifiedOfficialSources)
    expect(institutions.filter(
      (institution) => institution.status === 'source_manifest_complete',
    )).toHaveLength(Number(totals.sourceManifestComplete))
    expect(institutions.filter(
      (institution) => institution.status === 'reconciled_limited',
    )).toHaveLength(Number(totals.reconciledLimited))
    expect(institutions.every(
      (institution) => institution.status !== 'collecting',
    )).toBe(true)
    expect(institutions.reduce(
      (total, institution) => total + Number(institution.reconciliationCount),
      0,
    )).toBe(147 * 3)
    expect(institutions.map((item) => item.ordinal)).toEqual(
      Array.from({ length: 147 }, (_, index) => index + 1),
    )

    for (const institution of institutions) {
      const categories = institution.categories as JsonRecord[]

      expect(categories).toHaveLength(3)
      expect(categories.map((category) => category.category).sort()).toEqual(
        expectedCategories,
      )
      expect(institution.reconciliationCount).toBe(3)

      for (const category of categories) {
        expect(category.evidenceUrl).toEqual(expect.stringMatching(/^https:\/\//))

        if (category.status === 'verified_official') {
          expect(category.officialUrl).toEqual(expect.stringMatching(/^https:\/\//))
        } else {
          expect([
            'officially_not_provided',
            'source_unavailable',
          ]).toContain(category.status)
          expect(category.officialUrl).toBeNull()
        }
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
