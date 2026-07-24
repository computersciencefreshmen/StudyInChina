import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  parsePkuCatalogIndexHtml,
  parsePkuPdfCatalogText,
  type ParsePkuPdfCatalogOptions,
} from '../../scripts/ingestion/pku-pdf-catalog-harvester'

const fixtureDirectory = join(process.cwd(), 'tests', 'fixtures', 'pku-pdf-catalog')
const indexHtml = readFileSync(join(fixtureDirectory, 'index.html'), 'utf8')
const mathLayout = readFileSync(join(fixtureDirectory, 'math-layout.txt'), 'utf8')
const languagesLayout = readFileSync(join(fixtureDirectory, 'languages-layout.txt'), 'utf8')
  .replace('[[FORM_FEED]]', '\f')
const indexUrl =
  'https://admission.pku.edu.cn/zsxx/lxszs/lxszyml/2026/ss/zsml_ss_lxs_cn.html'

const baseDocumentOptions: ParsePkuPdfCatalogOptions = {
  document: {
    department: '数学科学学院',
    officialUrl:
      'https://admission.pku.edu.cn/zsxx/lxszs/lxszyml/2026/ss/zsml_ss_lxs_cn_00001.pdf',
    fileName: 'zsml_ss_lxs_cn_00001.pdf',
    indexLocator: 'html:line=4;a[href="./zsml_ss_lxs_cn_00001.pdf"]',
  },
  institutionId: 'uni-peking-university',
  checkedAt: '2026-07-24T08:00:00.000Z',
  degreeLevel: 'master',
  instructionLanguage: 'Chinese',
}

describe('PKU official PDF catalog harvester', () => {
  it('reconciles official department PDF anchors and quarantines a catalog-prefix mismatch', () => {
    const result = parsePkuCatalogIndexHtml(indexHtml, {
      indexUrl,
      degreeLevel: 'master',
      instructionLanguage: 'Chinese',
    })

    expect(result).toMatchObject({
      anchorsFound: 3,
      degreeLevel: 'master',
      instructionLanguage: 'Chinese',
    })
    expect(result.documents).toHaveLength(2)
    expect(result.documents.map((document) => document.department)).toEqual([
      '数学科学学院',
      '外国语学院',
    ])
    expect(result.quarantined).toEqual([
      expect.objectContaining({
        scope: 'index',
        department: '先进制造与机器人学院',
        reasons: ['catalog_prefix_mismatch'],
      }),
    ])
  })

  it('publishes exactly one verified entity per official program code', () => {
    const result = parsePkuPdfCatalogText(mathLayout, baseDocumentOptions)

    expect(result.entities).toHaveLength(3)
    expect(result.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'program',
        institutionId: 'uni-peking-university',
        programType: 'degree',
        degreeLevel: 'master',
        instructionLanguage: 'Chinese',
        programCode: '025100',
        name: '金融(Finance)',
        department: '数学科学学院',
        officialUrl: baseDocumentOptions.document.officialUrl,
        sourceCheckedAt: baseDocumentOptions.checkedAt,
        verificationStatus: 'verified',
      }),
      expect.objectContaining({
        programCode: '070102',
        name: '计算数学(Computational Mathematics)',
      }),
    ]))
    expect(result.entities[0]!.evidence).toMatchObject({
      officialUrl: baseDocumentOptions.document.officialUrl,
      checkedAt: baseDocumentOptions.checkedAt,
    })
    expect(result.entities[0]!.evidence.locator).toMatch(
      /^pdf:page=1;lines=\d+-\d+;code=/u,
    )
    expect(result.entities[0]!.evidence.quote).toContain('数学科学学院')
    expect(result.entities[0]!.entityKey).toMatch(/^pku:master:chinese:/u)
    expect(result.quarantined).toEqual([])
  })

  it('does not turn research directions into projects', () => {
    const result = parsePkuPdfCatalogText(mathLayout, baseDocumentOptions)

    expect(result.entities.map((entity) => entity.name)).not.toEqual(
      expect.arrayContaining(['密码学与信息安全', '代数', '不区分研究方向']),
    )
    expect(result.reconciliation).toMatchObject({
      programCandidates: 3,
      verifiedRows: 3,
      quarantinedRows: 0,
      duplicateRows: 0,
    })
  })

  it('ignores indented direction continuations and accepts an official index parenthetical alias', () => {
    const department = `${baseDocumentOptions.document.department}(Alias)`
    const result = parsePkuPdfCatalogText(mathLayout, {
      ...baseDocumentOptions,
      document: {
        ...baseDocumentOptions.document,
        department,
      },
    })

    expect(result.entities).toHaveLength(3)
    const program = result.entities.find((entity) => entity.programCode === '070101')
    expect(program?.name).toContain('Pure Mathematics')
    expect(program?.name).not.toContain('wrapped direction continuation')
    expect(program?.department).toBe(department)
    expect(result.quarantined).toEqual([])
  })
  it('joins wrapped names and carries the verified table boundary onto a continuation page', () => {
    const result = parsePkuPdfCatalogText(languagesLayout, {
      ...baseDocumentOptions,
      document: {
        department: '外国语学院',
        officialUrl:
          'https://admission.pku.edu.cn/zsxx/lxszs/lxszyml/2026/ss/zsml_ss_lxs_cn_00039.pdf',
        fileName: 'zsml_ss_lxs_cn_00039.pdf',
        indexLocator: 'html:line=5;a[href="./zsml_ss_lxs_cn_00039.pdf"]',
      },
    })

    expect(result.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        programCode: '050108',
        name: '比较文学与世界文学(Comparative Literature and World Literature)',
      }),
      expect.objectContaining({
        programCode: '050210',
        name: '亚非语言文学(Languages and Literatures of Asia and Africa)',
      }),
      expect.objectContaining({
        programCode: '055106',
        name: '日语口译(Japanese Interpreting)',
        evidence: expect.objectContaining({ page: 2 }),
      }),
    ]))
    expect(result.reconciliation).toMatchObject({
      pages: 2,
      tableHeaderPages: 1,
      programCandidates: 3,
      verifiedRows: 3,
    })
  })

  it('quarantines title mismatches and incomplete identities instead of guessing', () => {
    const mismatch = parsePkuPdfCatalogText(mathLayout, {
      ...baseDocumentOptions,
      document: {
        ...baseDocumentOptions.document,
        department: '物理学院',
      },
    })
    const incomplete = parsePkuPdfCatalogText(
      `${mathLayout}\n未编码项目(Uncoded Program)\n`,
      baseDocumentOptions,
    )

    expect(mismatch.entities).toEqual([])
    expect(mismatch.quarantined).toEqual([
      expect.objectContaining({
        scope: 'document',
        reasons: ['department_title_mismatch'],
      }),
    ])
    expect(incomplete.quarantined).toEqual([
      expect.objectContaining({
        scope: 'row',
        candidateName: '未编码项目(Uncoded Program)',
        reasons: ['missing_program_code'],
      }),
    ])
  })

  it('permanently quarantines every row in an A/B/A program-code conflict', () => {
    const conflictingLayout = [
      '\u6570\u5b66\u79d1\u5b66\u5b66\u9662\u62db\u751f\u4e13\u4e1a\u53ca\u7814\u7a76\u65b9\u5411',
      '',
      '\u4e13\u4e1a\u540d\u79f0                          \u7814\u7a76\u65b9\u5411',
      'Program Alpha',
      '(123456)',
      'Program Beta',
      '(123456)',
      'Program Alpha',
      '(123456)',
    ].join('\n')
    const result = parsePkuPdfCatalogText(conflictingLayout, baseDocumentOptions)

    expect(result.entities).toEqual([])
    expect(result.quarantined).toHaveLength(3)
    expect(result.quarantined.map((item) => item.candidateName)).toEqual([
      'Program Alpha',
      'Program Beta',
      'Program Alpha',
    ])
    expect(result.quarantined.every((item) => (
      item.reasons.includes('conflicting_duplicate_program_code')
    ))).toBe(true)
    expect(result.reconciliation).toMatchObject({
      programCandidates: 3,
      verifiedRows: 0,
      quarantinedRows: 3,
      duplicateRows: 2,
    })
  })

  it('is deterministic and fixture-only, with no network in either parser', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network must not be used by deterministic parsers')
    })
    vi.stubGlobal('fetch', fetchSpy)

    const firstIndex = parsePkuCatalogIndexHtml(indexHtml, {
      indexUrl,
      degreeLevel: 'master',
      instructionLanguage: 'Chinese',
    })
    const secondIndex = parsePkuCatalogIndexHtml(indexHtml, {
      indexUrl,
      degreeLevel: 'master',
      instructionLanguage: 'Chinese',
    })
    const firstPdf = parsePkuPdfCatalogText(mathLayout, baseDocumentOptions)
    const secondPdf = parsePkuPdfCatalogText(mathLayout, baseDocumentOptions)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(secondIndex).toEqual(firstIndex)
    expect(secondPdf).toEqual(firstPdf)
    vi.unstubAllGlobals()
  })

  it('rejects non-official URLs and mismatched catalog dimensions', () => {
    expect(() => parsePkuCatalogIndexHtml(indexHtml, {
      indexUrl: 'https://example.com/catalog.html',
      degreeLevel: 'master',
      instructionLanguage: 'Chinese',
    })).toThrow('officialUrl must be an HTTPS admission.pku.edu.cn URL')
    expect(() => parsePkuCatalogIndexHtml(indexHtml, {
      indexUrl: indexUrl.replace('admission.pku.edu.cn', 'admission.pku.edu.cn:444'),
      degreeLevel: 'master',
      instructionLanguage: 'Chinese',
    })).toThrow('officialUrl must be an HTTPS admission.pku.edu.cn URL')
    expect(() => parsePkuCatalogIndexHtml(indexHtml, {
      indexUrl,
      degreeLevel: 'doctorate',
      instructionLanguage: 'Chinese',
    })).toThrow('indexUrl path does not match')
    expect(() => parsePkuPdfCatalogText(mathLayout, {
      ...baseDocumentOptions,
      checkedAt: 'not-a-date',
    })).toThrow('checkedAt must be an ISO timestamp')
  })
})
