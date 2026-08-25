import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'

const ROOT = resolve(__dirname, '../..')
const SOURCE_DATA_DIR = join(ROOT, 'content', 'data')
const IMPORTER = join(ROOT, 'scripts', 'ingestion', 'apply-gdufs-official-depth-2026-08-25.cjs')
const LEDGER = join(ROOT, 'quality', 'official-depth-wave-2026-08-25', 'gdufs-fact-ledger.json')
const TODAY = '2026-08-25'
const GDUFS_TUITION_ATTACHMENT_URL = 'https://iie.gdufs.edu.cn/virtual_attach_file.vsb?afc=pM7rvknlW7MzfRo6l78o7laMmWknRN_8nR67UzQVU8lZUm70gihFp2hmCIa0L1yiUSyiLkyYU49DMmvbUm-sLmviL8U8MNMfoz-4o7W7MzAFnzN4L8-PUz6FoRvYMzLJqjfjo4OeoDPZvsAbgDTJQty0LzGboSyiMR9ZgtA8pUFcc&oid=962243922&tid=1099&nid=5488&e=.jpg'
const LOCALES = ['en', 'zh', 'ru', 'de', 'fr', 'es'] as const

const PROGRAM_IDS = [
  'program-guangdong-university-of-foreign-studies-chinese-language-bachelor',
  'program-guangdong-university-of-foreign-studies-international-business-bachelor',
  'program-guangdong-university-of-foreign-studies-global-economic-governance-doctorate',
  'program-guangdong-university-of-foreign-studies-iclt-one-semester-language',
  'program-guangdong-university-of-foreign-studies-chinese-language-semester-language',
  'prog-gap-prog-gdufs-chinese-thai-translation-bachelor',
  'prog-gap-prog-gdufs-chinese-business-bachelor',
  'prog-gap-prog-gdufs-chinese-culture-communication-bachelor',
  'prog-gap-clw-sw-gdufs-iclt-year',
  'prog-gap-chinese-degree-gdufs-international-chinese-education-master',
  'prog-gap-prog-gdufs-mba-international-2026',
] as const

const DEGREE_PROGRAM_IDS = [
  'program-guangdong-university-of-foreign-studies-chinese-language-bachelor',
  'program-guangdong-university-of-foreign-studies-international-business-bachelor',
  'program-guangdong-university-of-foreign-studies-global-economic-governance-doctorate',
  'prog-gap-prog-gdufs-chinese-thai-translation-bachelor',
  'prog-gap-prog-gdufs-chinese-business-bachelor',
  'prog-gap-prog-gdufs-chinese-culture-communication-bachelor',
  'prog-gap-chinese-degree-gdufs-international-chinese-education-master',
  'prog-gap-prog-gdufs-mba-international-2026',
]

const CLOSED_CYCLES = new Map([
  ['cycle-2026-gdufs-chinese-language-bachelor-autumn', 20000],
  ['cycle-2026-gdufs-international-business-bachelor-autumn', 33800],
  ['cycle-2026-gdufs-global-economic-governance-doctorate-autumn', 30000],
  ['cycle-2026-gdufs-chinese-language-semester-autumn', 8600],
  ['cycle-gap-prog-gdufs-chinese-thai-translation-bachelor-2026-2027-other-fee-reference', 20000],
  ['cycle-gap-prog-gdufs-chinese-business-bachelor-2026-2027-other-fee-reference', 20000],
  ['cycle-gap-prog-gdufs-chinese-culture-communication-bachelor-2026-2027-other-fee-reference', 20000],
  ['cycle-gap-chinese-degree-gdufs-international-chinese-education-master-2026-2027-autumn', 28000],
  ['cycle-gap-prog-gdufs-mba-international-2026-2026-2027-other-fee-reference', 108000],
])

const FILES_WRITTEN = [
  'sources.json',
  'programs.json',
  'admission-cycles.json',
  'scholarships.json',
] as const

let tempRoot = ''
let tempDataDir = ''
let baselineSlugs = new Map<string, string>()
let firstRunSnapshot = new Map<string, string>()
let secondRunSnapshot = new Map<string, string>()

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function loadTempBundle() {
  return bundleSchema.parse({
    sources: readJson(join(tempDataDir, 'sources.json')),
    cities: readJson(join(tempDataDir, 'cities.json')),
    universities: readJson(join(tempDataDir, 'universities.json')),
    programs: readJson(join(tempDataDir, 'programs.json')),
    admissionCycles: readJson(join(tempDataDir, 'admission-cycles.json')),
    scholarships: readJson(join(tempDataDir, 'scholarships.json')),
  })
}

function runImporter(): void {
  execFileSync(process.execPath, [IMPORTER], {
    cwd: ROOT,
    env: { ...process.env, STUDYINCHINA_DATA_DIR: tempDataDir },
    stdio: 'pipe',
  })
}

function snapshotWrittenFiles(): Map<string, string> {
  return new Map(FILES_WRITTEN.map((name) => [
    name,
    readFileSync(join(tempDataDir, name), 'utf8'),
  ]))
}

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'studyinchina-gdufs-depth-'))
  tempDataDir = join(tempRoot, 'data')
  mkdirSync(tempDataDir)

  for (const name of readdirSync(SOURCE_DATA_DIR).filter((entry) => entry.endsWith('.json'))) {
    copyFileSync(join(SOURCE_DATA_DIR, name), join(tempDataDir, name))
  }

  const baseline = loadTempBundle()
  baselineSlugs = new Map(baseline.programs
    .filter((program) => PROGRAM_IDS.includes(program.id as typeof PROGRAM_IDS[number]))
    .map((program) => [program.id, program.slug]))

  runImporter()
  firstRunSnapshot = snapshotWrittenFiles()
  runImporter()
  secondRunSnapshot = snapshotWrittenFiles()
})

afterAll(() => {
  if (tempRoot.startsWith(tmpdir())) rmSync(tempRoot, { recursive: true, force: true })
})

describe('GDUFS official depth importer on 2026-08-25', () => {
  it('is byte-for-byte idempotent and leaves the complete bundle schema-valid', () => {
    expect(secondRunSnapshot).toEqual(firstRunSnapshot)
    expect(() => loadTempBundle()).not.toThrow()
  })

  it('preserves existing IDs/slugs and separates scholarship study from self-funded language study', () => {
    const data = loadTempBundle()

    for (const id of PROGRAM_IDS) {
      const program = data.programs.find((item) => item.id === id)
      expect(program, id).toBeDefined()
      if (baselineSlugs.has(id)) {
        expect(program?.slug, id).toBe(baselineSlugs.get(id))
      } else {
        expect(program?.slug, id).toBe(
          'guangdong-university-of-foreign-studies-chinese-language-semester-language',
        )
      }
      expect(program?.durationMonths, id).not.toBeNull()
      expect(program?.teachingLanguages.length, id).toBeGreaterThan(0)
      for (const locale of LOCALES) {
        expect(program?.name[locale]?.trim(), `${id}:${locale}`).toBeTruthy()
      }
    }

    for (const id of PROGRAM_IDS.filter((item) => item !== 'prog-gap-clw-sw-gdufs-iclt-year')) {
      const program = data.programs.find((item) => item.id === id)
      expect(program?.verifiedAt, id).toBe(TODAY)
      expect(program?.status, id).toBe('verified')
      expect(program?.applyUrl, id).toBe('https://gdufs.17gz.org/')
      expect(program?.languageRequirements.length, id).toBeGreaterThan(0)
      expect(program?.sourceIds.some((sourceId) => {
        const source = data.sources.find((item) => item.id === sourceId)
        return source?.official && source.accessedAt === TODAY
      }), id).toBe(true)
    }

    const scholarshipSemester = data.programs.find(
      (program) => program.id === 'program-guangdong-university-of-foreign-studies-iclt-one-semester-language',
    )
    expect(scholarshipSemester?.name.en).toBe(
      'International Chinese Language Teachers Scholarship One-Semester Study',
    )
    expect(scholarshipSemester?.durationMonths).toBe(5)
    expect(scholarshipSemester?.programUrl).toBe(
      'https://iie.gdufs.edu.cn/info/1087/1536.htm',
    )
    expect(scholarshipSemester?.sourceIds).toEqual(['src-gdufs-iclt-scholarship'])
    expect(scholarshipSemester?.languageRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ test: 'HSK', minimum: 'Level 3, score 180' }),
      expect.objectContaining({ test: 'other', minimum: expect.stringContaining('recommending institution') }),
    ]))

    const selfFundedSemester = data.programs.find(
      (program) => program.id === 'program-guangdong-university-of-foreign-studies-chinese-language-semester-language',
    )
    expect(selfFundedSemester?.name.en).toBe('Chinese Language Semester Program')
    expect(selfFundedSemester?.durationMonths).toBe(4)
    expect(selfFundedSemester?.programUrl).toBe(
      'https://iie.gdufs.edu.cn/info/1099/5508.htm',
    )
    expect(selfFundedSemester?.sourceIds).toEqual([
      'source-gdufs-2026-autumn-chinese-language-program',
    ])
  })

  it('retains each degree program detail page and removes the duplicate guide source', () => {
    const data = loadTempBundle()
    const expectedProgramUrls = new Map([
      ['program-guangdong-university-of-foreign-studies-chinese-language-bachelor', 'https://iie.gdufs.edu.cn/info/1078/3350.htm'],
      ['program-guangdong-university-of-foreign-studies-international-business-bachelor', 'https://iie-en.gdufs.edu.cn/info/1132/1951.htm'],
      ['program-guangdong-university-of-foreign-studies-global-economic-governance-doctorate', 'https://giis.gdufs.edu.cn/info/1643/16885.htm'],
      ['prog-gap-prog-gdufs-chinese-thai-translation-bachelor', 'https://iie-en.gdufs.edu.cn/info/1132/2191.htm'],
      ['prog-gap-prog-gdufs-chinese-business-bachelor', 'https://iie-en.gdufs.edu.cn/info/1132/2191.htm'],
      ['prog-gap-prog-gdufs-chinese-culture-communication-bachelor', 'https://iie-en.gdufs.edu.cn/info/1132/2191.htm'],
      ['prog-gap-chinese-degree-gdufs-international-chinese-education-master', 'https://iie.gdufs.edu.cn/info/1099/5488.htm'],
      ['prog-gap-prog-gdufs-mba-international-2026', 'https://englishmba.gdufs.edu.cn/info/1010/3448.htm'],
    ])

    for (const [id, expectedUrl] of expectedProgramUrls) {
      const program = data.programs.find((item) => item.id === id)
      expect(program?.programUrl, id).toBe(expectedUrl)
      expect(program?.sourceIds, id).toContain('src-gdufs-2026-degree-admissions')
      expect(program?.sourceIds, id).not.toContain('source-gdufs-2026-degree-programs')
    }
    expect(data.sources.some((source) => source.id === 'source-gdufs-2026-degree-programs')).toBe(false)
  })

  it('stores exact 2026 fees as closed historical cycles and removes projected 2027 facts', () => {
    const data = loadTempBundle()

    for (const [id, tuitionCny] of CLOSED_CYCLES) {
      const cycle = data.admissionCycles.find((item) => item.id === id)
      expect(cycle, id).toBeDefined()
      expect(cycle?.status, id).toBe('stale')
      expect(cycle?.dateStatus, id).toBe('previous-cycle-reference')
      expect(cycle?.academicYear, id).toBe('2026-2027')
      expect(cycle?.intake, id).toBe('autumn')
      expect(cycle?.tuitionCny, id).toBe(tuitionCny)
      expect(cycle?.tuitionStatus, id).toBe('confirmed')
      expect(cycle?.applicationFeeCny, id).toBe(500)
      expect(cycle?.closesOn, id).toBe(
        id === 'cycle-2026-gdufs-chinese-language-semester-autumn'
          ? '2026-06-30'
          : '2026-06-20',
      )
    }

    const mbaCycle = data.admissionCycles.find(
      (cycle) => cycle.id === 'cycle-gap-prog-gdufs-mba-international-2026-2026-2027-other-fee-reference',
    )
    expect(mbaCycle?.tuitionCny).toBe(108000)
    expect(mbaCycle?.tuitionPeriod).toBe('program')
    expect(mbaCycle?.notes?.en).toContain('CNY 54,000/year')
    expect(mbaCycle?.notes?.en).toContain('CNY 36,000/year')

    for (const id of [
      'cycle-2027-gdufs-chinese-language-bachelor-spring',
      'cycle-2027-gdufs-international-business-autumn',
      'cycle-2027-gdufs-global-economic-governance-autumn',
    ]) {
      expect(data.admissionCycles.some((cycle) => cycle.id === id), id).toBe(false)
    }

    const preservedScholarshipCycle = data.admissionCycles.find(
      (cycle) => cycle.id === 'cycle-2027-gdufs-iclt-one-semester-spring',
    )
    expect(preservedScholarshipCycle?.programId).toBe(
      'program-guangdong-university-of-foreign-studies-iclt-one-semester-language',
    )
    expect(preservedScholarshipCycle?.closesOn).toBe('2026-10-31')
    expect(preservedScholarshipCycle?.status).toBe('verified')
    expect(preservedScholarshipCycle?.verifiedAt).toBe(TODAY)
    expect(preservedScholarshipCycle?.reviewAfter).toBe('2026-09-01')
    expect(preservedScholarshipCycle?.sourceIds).toEqual(['src-gdufs-iclt-scholarship'])
    expect(selectPublishedData(data, TODAY).admissionCycles.some(
      (cycle) => cycle.id === 'cycle-2027-gdufs-iclt-one-semester-spring',
    )).toBe(true)

    const selfFundedCycle = data.admissionCycles.find(
      (cycle) => cycle.id === 'cycle-2026-gdufs-chinese-language-semester-autumn',
    )
    expect(selfFundedCycle?.programId).toBe(
      'program-guangdong-university-of-foreign-studies-chinese-language-semester-language',
    )
  })

  it('maps only audited degree identities while disclosing broader university-scholarship eligibility', () => {
    const data = loadTempBundle()
    const expectedDegreeIds = [...DEGREE_PROGRAM_IDS].sort()

    const universityAward = data.scholarships.find(
      (scholarship) => scholarship.id === 'scholarship-gdufs-international-student',
    )
    expect(universityAward?.deadline).toBe('2026-07-05')
    expect(universityAward?.status).toBe('stale')
    expect(universityAward?.reviewAfter).toBe(TODAY)
    expect(universityAward?.programIds.slice().sort()).toEqual(expectedDegreeIds)
    expect(universityAward?.sourceIds).toEqual(['source-gdufs-2026-university-scholarship'])
    expect(universityAward?.summary?.en).toContain('at least one academic year')
    expect(universityAward?.summary?.en).toContain('safely mapped')
    expect(universityAward?.summary?.zh).toContain('不少于一学年')
    expect(universityAward?.summary?.en).not.toContain('degree-only')

    const provincialAward = data.scholarships.find(
      (scholarship) => scholarship.id === 'scholarship-gdufs-guangdong-government',
    )
    expect(provincialAward?.deadline).toBeNull()
    expect(provincialAward?.applicationUrl).toBeNull()
    expect(provincialAward?.coverage.tuition).toBe('unknown')
    expect(provincialAward?.programIds.slice().sort()).toEqual(expectedDegreeIds)

    const icltAward = data.scholarships.find(
      (scholarship) => scholarship.id === 'scholarship-gdufs-iclt-one-semester-2027',
    )
    expect(icltAward).toMatchObject({
      slug: 'gdufs-iclt-one-semester-2027',
      programIds: ['program-guangdong-university-of-foreign-studies-iclt-one-semester-language'],
      deadline: '2026-10-31',
      applicationUrl: 'https://www.chinese.cn/page/#/pcpage/project_detail',
      verifiedAt: TODAY,
      reviewAfter: '2026-09-01',
      status: 'verified',
      coverage: {
        tuition: 'full',
        accommodation: 'full',
        insurance: true,
        stipendCnyPerMonth: 2500,
      },
    })
    expect(icltAward?.sourceIds).toEqual(['src-gdufs-iclt-scholarship'])
    expect(selectPublishedData(data, TODAY).scholarships.some(
      (scholarship) => scholarship.id === 'scholarship-gdufs-iclt-one-semester-2027',
    )).toBe(true)

    for (const award of [universityAward, provincialAward, icltAward]) {
      for (const locale of LOCALES) {
        expect(award?.name[locale]?.trim(), locale).toBeTruthy()
        expect(award?.summary?.[locale]?.trim(), locale).toBeTruthy()
      }
    }
  })
  it('keeps private-R2 snapshot metadata and a locator-backed decision for every updated fact', () => {
    const ledger = readJson(LEDGER) as {
      policy: Record<string, boolean>
      sources: Array<{
        sourceId: string
        officialUrl: string
        snapshotStatus?: string
        contentSha256?: string | null
        r2ObjectKey?: string | null
        snapshotMimeType?: string
        snapshotSizeBytes?: number | null
        attachmentUrl?: string
        attachmentSnapshot?: {
          snapshotStatus: string
          officialUrl: string
          contentSha256: string
          sizeBytes: number
          r2ObjectKey: string
          mimeType: string
        }
        locators: Array<{ supports: string[] }>
        feeRows?: Array<{
          programRaw: string
          amountRaw: string
          periodRaw: string
          structuredAmountCny?: number
          structuredPeriod?: string
        }>
      }>
      programCoverage: Array<{ programId: string }>
      scholarshipCoverage: Array<{
        scholarshipId: string
        publishedFacts: string[]
        withheldFacts?: string[]
        mappingStatus?: string
        verifiedAt?: string
        reviewAfter?: string
      }>
    }

    expect(ledger.policy).toMatchObject({
      officialSourcesOnly: true,
      unknownValuesInferred: false,
      closed2026CyclesPublishedAsCurrent: false,
      projected2027CyclesAllowed: false,
      privateSnapshotsPublic: false,
    })
    expect(ledger.sources
      .map(({ sourceId, officialUrl }) => ({ sourceId, officialUrl }))
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId))).toEqual([
      { sourceId: 'source-gdufs-2026-autumn-chinese-language-program', officialUrl: 'https://iie.gdufs.edu.cn/info/1099/5508.htm' },
      { sourceId: 'source-gdufs-2026-university-scholarship', officialUrl: 'https://iie.gdufs.edu.cn/info/1126/5578.htm' },
      { sourceId: 'src-gdufs-2026-degree-admissions', officialUrl: 'https://iie.gdufs.edu.cn/info/1099/5488.htm' },
      { sourceId: 'src-gdufs-iclt-scholarship', officialUrl: 'https://iie.gdufs.edu.cn/info/1087/1536.htm' },
    ].sort((left, right) => left.sourceId.localeCompare(right.sourceId)))
    for (const source of ledger.sources) {
      const url = new URL(source.officialUrl)
      expect(url.protocol).toBe('https:')
      expect(url.hostname.endsWith('.gdufs.edu.cn')).toBe(true)
      expect(source.locators.flatMap((locator) => locator.supports).length).toBeGreaterThan(0)
    }

    const expectedSnapshots = new Map([
      ['src-gdufs-2026-degree-admissions', {
        sha256: 'e56545a3662b45f750bf2a299b2f33cabc7cd49bc8741e11dcce97a8573a4b17',
        key: 'snapshots/e5/src-gdufs-2026-degree-admissions/e56545a3662b45f750bf2a299b2f33cabc7cd49bc8741e11dcce97a8573a4b17.html',
      }],
      ['source-gdufs-2026-autumn-chinese-language-program', {
        sha256: 'ce127ef83244a7f375240344c4bddd1cd28a315d1b3a361de28671d1a0b13161',
        key: 'snapshots/ce/source-gdufs-2026-autumn-chinese-language-program/ce127ef83244a7f375240344c4bddd1cd28a315d1b3a361de28671d1a0b13161.html',
      }],
      ['source-gdufs-2026-university-scholarship', {
        sha256: 'efc1df3d774f6bfe3a937e0048a542a3e1f221cf7a615ebdc71d85abeba16927',
        key: 'snapshots/ef/source-gdufs-2026-university-scholarship/efc1df3d774f6bfe3a937e0048a542a3e1f221cf7a615ebdc71d85abeba16927.html',
      }],
      ['src-gdufs-iclt-scholarship', {
        sha256: 'aae000231cd67e30677434c5f3085a448146209a49eae220ff4bcc5868c0f7d5',
        key: 'snapshots/aa/src-gdufs-iclt-scholarship/aae000231cd67e30677434c5f3085a448146209a49eae220ff4bcc5868c0f7d5.html',
      }],
    ])

    for (const [sourceId, expected] of expectedSnapshots) {
      const source = ledger.sources.find((item) => item.sourceId === sourceId)
      expect(source, sourceId).toMatchObject({
        snapshotStatus: 'stored_private_r2',
        contentSha256: expected.sha256,
        r2ObjectKey: expected.key,
        snapshotMimeType: 'text/html',
        snapshotSizeBytes: null,
      })
    }

    const degreeGuide = ledger.sources.find(
      (source) => source.sourceId === 'src-gdufs-2026-degree-admissions',
    )
    expect(degreeGuide?.attachmentUrl).toBe(GDUFS_TUITION_ATTACHMENT_URL)
    expect(degreeGuide?.attachmentSnapshot).toEqual({
      snapshotStatus: 'stored_private_r2',
      officialUrl: GDUFS_TUITION_ATTACHMENT_URL,
      contentSha256: '06fdb5f5c6eb93f076a8fd6043310e686e6412455da1503a388953f1b128cd1f',
      sizeBytes: 553555,
      r2ObjectKey: 'snapshots/06/src-gdufs-2026-degree-admissions/06fdb5f5c6eb93f076a8fd6043310e686e6412455da1503a388953f1b128cd1f.jpg',
      mimeType: 'image/jpeg',
    })
    expect(degreeGuide?.feeRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        programRaw: 'MBA（工商管理硕士）（2年全日制） / MBA (Master of Business Administration) (2-years’ full-time program)',
        amountRaw: '54,000',
        periodRaw: '年 year',
      }),
      expect.objectContaining({
        programRaw: 'MBA（工商管理硕士）（3年非全日制） / MBA (Master of Business Administration) (3-years’ part-time program)',
        amountRaw: '36,000',
        periodRaw: '年 year',
      }),
    ]))

    expect(ledger.programCoverage.map((item) => item.programId).sort()).toEqual(
      [...PROGRAM_IDS].sort(),
    )
    expect(ledger.scholarshipCoverage.map((item) => item.scholarshipId).sort()).toEqual([
      'scholarship-gdufs-guangdong-government',
      'scholarship-gdufs-iclt-one-semester-2027',
      'scholarship-gdufs-international-student',
    ])
    const universityCoverage = ledger.scholarshipCoverage.find(
      (item) => item.scholarshipId === 'scholarship-gdufs-international-student',
    )
    expect(universityCoverage?.publishedFacts.join(' ')).toContain(
      'Chinese-language students enrolled for at least one academic year',
    )
    expect(universityCoverage?.publishedFacts.join(' ')).not.toContain('degree-only')
    expect(universityCoverage?.withheldFacts?.join(' ')).toContain('pending safe mapping')
    expect(universityCoverage?.mappingStatus).toBe('partial_official_scope')

    const icltCoverage = ledger.scholarshipCoverage.find(
      (item) => item.scholarshipId === 'scholarship-gdufs-iclt-one-semester-2027',
    )
    expect(icltCoverage?.verifiedAt).toBe(TODAY)
    expect(icltCoverage?.reviewAfter).toBe('2026-09-01')
  })
})
