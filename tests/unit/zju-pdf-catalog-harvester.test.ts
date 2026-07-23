import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  parseZjuPdfCatalogTsv,
  type ParseZjuPdfCatalogOptions,
} from '../../scripts/ingestion/zju-pdf-catalog-harvester'

const fixtureDirectory = join(process.cwd(), 'tests', 'fixtures', 'zju-pdf-catalog')
const masterTsv = readFileSync(join(fixtureDirectory, 'master-catalog.tsv'), 'utf8')
const doctorateTsv = readFileSync(join(fixtureDirectory, 'doctorate-catalog.tsv'), 'utf8')
const baseOptions: ParseZjuPdfCatalogOptions = {
  officialUrl:
    'https://iczu.zju.edu.cn/_upload/article/files/official/2026-master-catalog.pdf',
  institutionId: 'uni-zhejiang-university',
  checkedAt: '2026-07-23T10:00:00.000Z',
  degreeLevel: 'master',
  instructionLanguage: 'English',
}

describe('ZJU official PDF catalog harvester', () => {
  it('reconstructs one verified program per official table row from TSV geometry', () => {
    const result = parseZjuPdfCatalogTsv(masterTsv, baseOptions)

    expect(result.entities).toHaveLength(2)
    expect(result.entities[0]).toMatchObject({
      entityType: 'program',
      institutionId: 'uni-zhejiang-university',
      programType: 'degree',
      degreeLevel: 'master',
      instructionLanguage: 'English',
      name: 'Economics',
      department: 'School of Economics',
      durationYears: 2,
      tuition: {
        amount: 22_800,
        currency: 'CNY',
        period: 'year',
      },
      officialUrl: baseOptions.officialUrl,
      sourceCheckedAt: baseOptions.checkedAt,
      verificationStatus: 'verified',
      confidence: 0.99,
    })
    expect(result.entities[0]!.entityKey).toBe(
      'zju:master:english:school-of-economics:economics',
    )
    expect(result.entities[0]!.evidence).toMatchObject({
      page: 1,
      officialUrl: baseOptions.officialUrl,
      checkedAt: baseOptions.checkedAt,
    })
    expect(result.entities[0]!.evidence.lineStart).toBeGreaterThan(0)
    expect(result.entities[0]!.evidence.lineEnd).toBeGreaterThanOrEqual(
      result.entities[0]!.evidence.lineStart,
    )
    expect(result.entities[0]!.evidence.bbox.width).toBeGreaterThan(0)
    expect(result.entities[0]!.evidence.departmentBbox.width).toBeGreaterThan(0)
    expect(result.entities[0]!.evidence.locator).toContain('pdf:page=1')
    expect(result.entities[0]!.evidence.quote).toContain('School of Economics')
  })

  it('joins wrapped names across a headerless continuation page and parses whole-program tuition', () => {
    const result = parseZjuPdfCatalogTsv(masterTsv, baseOptions)
    const program = result.entities.find((entity) => entity.department === 'School of Management')

    expect(program).toMatchObject({
      name: 'Innovation, Entrepreneurship and Global Leadership',
      durationYears: 2,
      tuition: {
        amount: 108_000,
        currency: 'CNY',
        period: 'whole_program',
      },
      evidence: {
        page: 2,
      },
    })
    expect(result.reconciliation.tableHeaderPages).toBe(1)
    expect(result.reconciliation.pages).toBe(3)
  })

  it('quarantines unprovable rows and never turns headers or requirements into programs', () => {
    const result = parseZjuPdfCatalogTsv(masterTsv, baseOptions)

    expect(result.entities.map((entity) => entity.name)).not.toContain('Scholarship Program requirements')
    expect(result.quarantined).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidateName: 'Mystery Studies',
        reasons: expect.arrayContaining(['missing_department']),
      }),
      expect.objectContaining({
        candidateName: null,
        reasons: ['missing_program_name'],
      }),
    ]))
    expect(result.entities.every((entity) => entity.verificationStatus === 'verified')).toBe(true)
    expect(result.reconciliation).toMatchObject({
      programCandidateRows: 4,
      durationObservations: 4,
      verifiedRows: 2,
      quarantinedRows: 2,
      duplicateRows: 0,
      orphanDurationRows: 1,
      verificationRate: 50,
    })
    expect(
      result.reconciliation.verifiedRows +
      result.reconciliation.quarantinedRows +
      result.reconciliation.duplicateRows,
    ).toBe(result.reconciliation.programCandidateRows)
  })

  it('accepts a pure numeric duration when the official doctoral column declares years', () => {
    const result = parseZjuPdfCatalogTsv(doctorateTsv, {
      ...baseOptions,
      officialUrl:
        'https://iczu.zju.edu.cn/_upload/article/files/official/2026-doctorate-catalog.pdf',
      degreeLevel: 'doctorate',
    })

    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]).toMatchObject({
      name: 'Chemistry',
      department: 'Department of Chemistry',
      degreeLevel: 'doctorate',
      durationYears: 3.5,
      tuition: {
        amount: 42_800,
        period: 'year',
      },
    })
    expect(result.quarantined).toEqual([])
  })

  it('is deterministic and fixture-only, with no network call in the parser path', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network must not be used by TSV parsing')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const first = parseZjuPdfCatalogTsv(masterTsv, baseOptions)
    const second = parseZjuPdfCatalogTsv(masterTsv, baseOptions)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(second).toEqual(first)
    vi.unstubAllGlobals()
  })

  it('rejects non-official sources and invalid catalog dimensions', () => {
    expect(() => parseZjuPdfCatalogTsv(masterTsv, {
      ...baseOptions,
      officialUrl: 'https://example.com/catalog.pdf',
    })).toThrow('officialUrl must be an HTTPS Zhejiang University URL')
    expect(() => parseZjuPdfCatalogTsv(masterTsv, {
      ...baseOptions,
      checkedAt: 'not-a-date',
    })).toThrow('checkedAt must be an ISO timestamp')
    expect(() => parseZjuPdfCatalogTsv(masterTsv, {
      ...baseOptions,
      institutionId: '../zju',
    })).toThrow('institutionId must be a stable lowercase identifier')
  })
})
