import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildPublicDoubleFirstClassCoverage,
} from '../../scripts/ingestion/build-public-double-first-class-coverage'

type JsonRecord = Record<string, unknown>

describe('public Double First-Class coverage table', () => {
  it('keeps the 147-school registry audit while publishing 144 non-military targets', () => {
    const output = buildPublicDoubleFirstClassCoverage()
    const officialRegistry = output.officialRegistry as JsonRecord
    const totals = output.totals as JsonRecord
    const institutions = output.institutions as JsonRecord[]
    const excludedNames = [
      '国防科技大学',
      '海军军医大学',
      '空军军医大学',
    ]
    const expectedCategories = [
      'catalog_anchor',
      'international_admissions_home',
      'university_scholarship',
    ]
    const verifiedOfficialSources = institutions.reduce((total, institution) => (
      total + (institution.sources as JsonRecord[]).length
    ), 0)

    expect(officialRegistry.institutionTargets).toBe(147)
    expect(totals.officialRegistryTargets).toBe(147)
    expect(totals.militaryExcluded).toBe(3)
    expect(institutions).toHaveLength(144)
    expect(totals.institutionTargets).toBe(144)
    expect(totals.reconciledInstitutionTargets).toBe(144)
    expect(totals.collecting).toBe(0)
    expect(
      Number(totals.sourceManifestComplete)
      + Number(totals.reconciledLimited),
    ).toBe(144)
    expect(totals.verifiedOfficialSources).toBe(verifiedOfficialSources)
    expect(institutions.some(
      (institution) => excludedNames.includes(String(institution.nameZh)),
    )).toBe(false)
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
    )).toBe(144 * 3)
    const ordinals = institutions.map((item) => Number(item.ordinal))
    expect(ordinals).toEqual([...ordinals].sort((left, right) => left - right))
    expect(new Set(ordinals)).toHaveLength(144)

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
