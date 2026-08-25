import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bundleSchema } from '../../src/lib/data/schema'

const ROOT = resolve(__dirname, '../..')
const SOURCE_DATA_DIR = join(ROOT, 'content', 'data')
const IMPORTER = join(ROOT, 'scripts', 'ingestion', 'apply-hit-xjtu-official-depth-2026-08-25.cjs')
const LEDGER = join(ROOT, 'quality', 'official-depth-wave-2026-08-25', 'hit-xjtu-fact-ledger.json')
const TODAY = '2026-08-25'
const LOCALES = ['en', 'zh', 'ru', 'de', 'fr', 'es'] as const

const HIT_MASTER_IDS = [
  'program-harbin-institute-of-technology-civil-engineering-master',
  'program-harbin-institute-of-technology-mechanical-engineering-master',
] as const
const HIT_PRE_UNIVERSITY_IDS = [
  'prog-gap-wave8-hit-pre-university-program',
  'program-harbin-institute-of-technology-pre-university-chinese-18-week-foundation',
  'program-harbin-institute-of-technology-pre-university-english-18-week-foundation',
] as const
const XJTU_ENGINEERING_IDS = [
  'program-xian-jiaotong-university-electrical-engineering-and-automation-bachelor',
  'program-xian-jiaotong-university-energy-and-power-engineering-bachelor',
  'program-xian-jiaotong-university-intelligent-manufacturing-engineering-bachelor',
  'program-xian-jiaotong-university-materials-science-and-engineering-bachelor',
] as const
const XJTU_MBBS_ID = 'program-xian-jiaotong-university-clinical-medicine-mbbs-bachelor'
const EXISTING_PROGRAM_IDS = [
  ...HIT_MASTER_IDS,
  'prog-gap-wave8-hit-long-term-chinese-language',
  'prog-gap-wave8-hit-global-summer-school',
  'prog-gap-wave8-hit-pre-university-program',
  'prog-gap-wave8-hit-winter-short-term-chinese-2026',
  ...XJTU_ENGINEERING_IDS.slice(0, 3),
] as const
const NEW_PROGRAM_IDS = [
  HIT_PRE_UNIVERSITY_IDS[1],
  HIT_PRE_UNIVERSITY_IDS[2],
  XJTU_ENGINEERING_IDS[3],
  XJTU_MBBS_ID,
] as const
const QUARANTINED_XJTU_CLP_IDS = [
  'program-xian-jiaotong-university-chinese-language-program-one-semester-language',
  'program-xian-jiaotong-university-chinese-language-program-one-academic-year-language',
] as const
const QUARANTINED_XJTU_DYNAMIC_CYCLE_IDS = [
  'cycle-2026-xian-jiaotong-university-electrical-engineering-and-automation-bachelor-autumn',
  'cycle-2026-xian-jiaotong-university-energy-and-power-engineering-bachelor-autumn',
  'cycle-2026-xian-jiaotong-university-intelligent-manufacturing-engineering-bachelor-autumn',
  'cycle-2026-xian-jiaotong-university-materials-science-and-engineering-bachelor-autumn',
  'cycle-2026-xian-jiaotong-university-clinical-medicine-mbbs-bachelor-autumn',
] as const
const FILES_WRITTEN = [
  'sources.json',
  'programs.json',
  'admission-cycles.json',
  'scholarships.json',
] as const

let tempRoot = ''
let tempDataDir = ''
let baselineProgramSlugs = new Map<string, string>()
let baselineScholarshipSlugs = new Map<string, string>()
let baselineWhuSnapshot = ''
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

function snapshotWhu(bundle: ReturnType<typeof loadTempBundle>): string {
  const programIds = new Set(bundle.programs
    .filter((program) => program.universityId === 'uni-wuhan-university')
    .map((program) => program.id))
  return JSON.stringify({
    programs: bundle.programs.filter((program) => programIds.has(program.id)),
    cycles: bundle.admissionCycles.filter((cycle) => programIds.has(cycle.programId)),
    scholarships: bundle.scholarships.filter((scholarship) => (
      scholarship.universityIds.includes('uni-wuhan-university')
    )),
  })
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + String.fromCharCode(10), 'utf8')
}

function seedUnsafeXjtuDynamicFacts(): void {
  const cyclePath = join(tempDataDir, 'admission-cycles.json')
  const cycles = readJson(cyclePath) as Array<Record<string, unknown>>
  const xjtuProgramIds = [...XJTU_ENGINEERING_IDS, XJTU_MBBS_ID]
  const quarantinedIds = new Set<string>(QUARANTINED_XJTU_DYNAMIC_CYCLE_IDS)
  const unsafeCycles = xjtuProgramIds.map((programId, index) => ({
    id: QUARANTINED_XJTU_DYNAMIC_CYCLE_IDS[index],
    programId,
    academicYear: '2026-2027',
    intake: 'autumn',
    opensOn: '2025-11-01',
    closesOn: '2026-06-30',
    dateStatus: 'published',
    tuitionCny: programId === XJTU_MBBS_ID ? 40000 : 180000,
    tuitionPeriod: 'academic-year',
    tuitionStatus: 'confirmed',
    evidenceBasis: 'cycle-specific',
    factScope: 'complete',
    applicationFeeCny: 500,
    notes: null,
    sourceIds: ['source-xjtu-2026-undergraduate-fees-scholarships'],
    verifiedAt: TODAY,
    reviewAfter: '2026-09-24',
    status: 'verified',
  }))
  writeJson(cyclePath, [
    ...cycles.filter((cycle) => !quarantinedIds.has(String(cycle.id))),
    ...unsafeCycles,
  ])

  const scholarshipPath = join(tempDataDir, 'scholarships.json')
  const scholarshipIds = new Set([
    'scholarship-xian-jiaotong-university-international-student',
    'scholarship-xian-belt-and-road',
  ])
  const scholarships = readJson(scholarshipPath) as Array<Record<string, unknown>>
  writeJson(scholarshipPath, scholarships.map((scholarship) => (
    scholarshipIds.has(String(scholarship.id))
      ? {
          ...scholarship,
          programIds: xjtuProgramIds,
          coverage: {
            tuition: 'partial',
            accommodation: 'full',
            insurance: true,
            stipendCnyPerMonth: 1500,
          },
          deadline: '2026-06-30',
          applicationUrl: 'https://isso.xjtu.edu.cn/recruit/login',
          verifiedAt: TODAY,
          reviewAfter: '2026-09-24',
          status: 'verified',
        }
      : scholarship
  )))
}
beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'studyinchina-hit-xjtu-depth-'))
  tempDataDir = join(tempRoot, 'data')
  mkdirSync(tempDataDir)

  for (const name of readdirSync(SOURCE_DATA_DIR).filter((entry) => entry.endsWith('.json'))) {
    copyFileSync(join(SOURCE_DATA_DIR, name), join(tempDataDir, name))
  }

  const baseline = loadTempBundle()
  baselineProgramSlugs = new Map(baseline.programs
    .filter((program) => EXISTING_PROGRAM_IDS.includes(program.id as typeof EXISTING_PROGRAM_IDS[number]))
    .map((program) => [program.id, program.slug]))
  baselineScholarshipSlugs = new Map(baseline.scholarships
    .filter((scholarship) => [
      'scholarship-xian-jiaotong-university-international-student',
      'scholarship-xian-belt-and-road',
    ].includes(scholarship.id))
    .map((scholarship) => [scholarship.id, scholarship.slug]))
  baselineWhuSnapshot = snapshotWhu(baseline)

  seedUnsafeXjtuDynamicFacts()
  runImporter()
  firstRunSnapshot = snapshotWrittenFiles()
  runImporter()
  secondRunSnapshot = snapshotWrittenFiles()
})

afterAll(() => {
  if (tempRoot.startsWith(tmpdir())) rmSync(tempRoot, { recursive: true, force: true })
})

describe('HIT and XJTU official depth importer on 2026-08-25', () => {
  it('is byte-for-byte idempotent and leaves the complete catalog schema-valid', () => {
    expect(secondRunSnapshot).toEqual(firstRunSnapshot)
    expect(() => loadTempBundle()).not.toThrow()
  })

  it('preserves every existing ID/slug, creates four stable identities once, and leaves WHU untouched', () => {
    const data = loadTempBundle()

    for (const id of EXISTING_PROGRAM_IDS) {
      const program = data.programs.find((item) => item.id === id)
      expect(program, id).toBeDefined()
      expect(program?.slug, id).toBe(baselineProgramSlugs.get(id))
    }
    for (const id of NEW_PROGRAM_IDS) {
      expect(data.programs.filter((program) => program.id === id), id).toHaveLength(1)
    }
    for (const id of [
      'scholarship-xian-jiaotong-university-international-student',
      'scholarship-xian-belt-and-road',
    ]) {
      const scholarship = data.scholarships.find((item) => item.id === id)
      expect(scholarship?.slug, id).toBe(baselineScholarshipSlugs.get(id))
    }
    expect(snapshotWhu(data)).toBe(baselineWhuSnapshot)
  })

  it('deepens both HIT English masters and stores their 2026 facts only as closed history', () => {
    const data = loadTempBundle()

    for (const id of HIT_MASTER_IDS) {
      const program = data.programs.find((item) => item.id === id)
      expect(program?.durationMonths, id).toBe(24)
      expect(program?.durationMonthsMax, id).toBe(36)
      expect(program?.teachingLanguages, id).toEqual(['English'])
      expect(program?.applyUrl, id).toBe('https://hit.at0086.cn/StuApplication/Login.aspx')
      expect(program?.languageRequirements.map((item) => item.test), id).toEqual(
        expect.arrayContaining(['TOEFL', 'IELTS', 'other']),
      )
      expect(program?.status, id).toBe('verified')
      expect(program?.verifiedAt, id).toBe(TODAY)

      const cycle = data.admissionCycles.find((item) => item.programId === id)
      expect(cycle?.dateStatus, id).toBe('previous-cycle-reference')
      expect(cycle?.status, id).toBe('stale')
      expect(cycle?.closesOn, id).toBe('2026-05-31')
      expect(cycle?.tuitionCny, id).toBe(34000)
      expect(cycle?.tuitionPeriod, id).toBe('academic-year')
      expect(cycle?.applicationFeeCny, id).toBe(400)
    }
  })

  it('separates HIT non-degree routes without manufacturing missing duration or application-fee facts', () => {
    const data = loadTempBundle()
    const longChinese = data.programs.find(
      (program) => program.id === 'prog-gap-wave8-hit-long-term-chinese-language',
    )
    expect(longChinese?.durationMonths).toBe(4)
    expect(longChinese?.languageRequirements.length).toBeGreaterThanOrEqual(2)
    const longCycles = data.admissionCycles.filter((cycle) => cycle.programId === longChinese?.id)
    expect(longCycles).toHaveLength(2)
    expect(longCycles.map((cycle) => cycle.closesOn).sort()).toEqual([
      '2026-01-15',
      '2026-07-15',
    ])
    for (const cycle of longCycles) {
      expect(cycle.tuitionCny).toBe(7300)
      expect(cycle.tuitionPeriod).toBe('semester')
      expect(cycle.applicationFeeCny).toBe(400)
      expect(cycle.status).toBe('stale')
    }

    const globalSummer = data.programs.find(
      (program) => program.id === 'prog-gap-wave8-hit-global-summer-school',
    )
    expect(globalSummer?.durationMonths).toBeNull()
    expect(globalSummer?.teachingLanguages).toEqual(['English'])
    expect(globalSummer?.languageRequirements.length).toBe(2)
    const globalSummerCycle = data.admissionCycles.find(
      (cycle) => cycle.programId === globalSummer?.id,
    )
    expect(globalSummerCycle?.tuitionCny).toBe(0)
    expect(globalSummerCycle?.applicationFeeCny).toBeNull()
    expect(globalSummerCycle?.factScope).toBe('partial')
    expect(globalSummerCycle?.notes?.en).toContain('durationMonths remains null')

    const expectedFoundationCycles = new Map([
      ['prog-gap-wave8-hit-pre-university-program', 24600],
      [HIT_PRE_UNIVERSITY_IDS[1], 12300],
      [HIT_PRE_UNIVERSITY_IDS[2], 18000],
    ])
    for (const [id, tuition] of expectedFoundationCycles) {
      const program = data.programs.find((item) => item.id === id)
      const cycle = data.admissionCycles.find((item) => item.programId === id)
      expect(program?.teachingLanguages, id).toEqual([
        id === HIT_PRE_UNIVERSITY_IDS[2] ? 'English' : 'Chinese',
      ])
      expect(program?.languageRequirements.length, id).toBeGreaterThanOrEqual(2)
      expect(cycle?.tuitionCny, id).toBe(tuition)
      expect(cycle?.tuitionPeriod, id).toBe('program')
      expect(cycle?.applicationFeeCny, id).toBe(400)
      expect(cycle?.status, id).toBe('stale')
    }
    expect(data.programs.find((item) => item.id === HIT_PRE_UNIVERSITY_IDS[0])?.durationMonths).toBe(9)
  })

  it('refreshes the existing HIT winter cycle and its six-language identity without changing ID/slug', () => {
    const data = loadTempBundle()
    const id = 'prog-gap-wave8-hit-winter-short-term-chinese-2026'
    const program = data.programs.find((item) => item.id === id)
    expect(program?.slug).toBe(baselineProgramSlugs.get(id))
    expect(program?.verifiedAt).toBe(TODAY)
    expect(program?.reviewAfter).toBe('2026-09-01')
    expect(program?.languageRequirements.length).toBe(2)
    for (const locale of LOCALES) {
      expect(program?.name[locale]?.trim(), locale).toBeTruthy()
    }

    const cycle = data.admissionCycles.find((item) => item.programId === id)
    expect(cycle).toMatchObject({
      closesOn: '2026-11-30',
      dateStatus: 'published',
      tuitionCny: 3500,
      tuitionPeriod: 'program',
      applicationFeeCny: 400,
      verifiedAt: TODAY,
      reviewAfter: '2026-09-01',
      status: 'verified',
    })
    expect(cycle?.notes?.en).toContain('insurance CNY 160')
    expect(cycle?.notes?.en).toContain('accommodation CNY 800–1,000')
  })

  it('publishes only static XJTU undergraduate identities and removes every unsafe 2026 cycle', () => {
    const data = loadTempBundle()
    const programIds = [...XJTU_ENGINEERING_IDS, XJTU_MBBS_ID]

    for (const id of programIds) {
      const isMbbs = id === XJTU_MBBS_ID
      const program = data.programs.find((item) => item.id === id)
      expect(program?.durationMonths, id).toBeNull()
      expect(program?.durationMonthsMax, id).toBeNull()
      expect(program?.teachingLanguages, id).toEqual(['English'])
      expect(program?.verificationScope, id).toBe('identity')
      expect(program?.languageRequirements, id).toEqual([])
      expect(program?.details, id).toBeUndefined()
      expect(program?.applyUrl, id).toBe('https://isso.xjtu.edu.cn/recruit/login')
      expect(program?.programUrl, id).toBe(
        isMbbs
          ? 'https://sie.xjtu.edu.cn/en/YXBK.pdf'
          : 'https://sie.xjtu.edu.cn/en/BKYW.pdf',
      )
      expect(program?.sourceIds, id).toEqual([
        isMbbs
          ? 'source-xjtu-2026-mbbs-guide'
          : 'source-xjtu-2026-undergraduate-program-list',
        'source-xjtu-official-application-system',
      ])
    }

    for (const identityProgram of data.programs.filter(
      (program) => program.verificationScope === 'identity',
    )) {
      expect(identityProgram.durationMonths, identityProgram.id).toBeNull()
      expect(identityProgram.languageRequirements, identityProgram.id).toEqual([])
      expect(identityProgram.details, identityProgram.id).toBeUndefined()
    }

    for (const cycleId of QUARANTINED_XJTU_DYNAMIC_CYCLE_IDS) {
      expect(data.admissionCycles.some((cycle) => cycle.id === cycleId), cycleId).toBe(false)
    }
  })
  it('keeps both XJTU scholarship identities stale and withholds every unsupported dynamic field', () => {
    const data = loadTempBundle()
    const expectedCoverage = {
      tuition: 'unknown',
      accommodation: 'unknown',
      insurance: 'unknown',
      stipendCnyPerMonth: null,
    }

    for (const id of [
      'scholarship-xian-jiaotong-university-international-student',
      'scholarship-xian-belt-and-road',
    ]) {
      const scholarship = data.scholarships.find((item) => item.id === id)
      expect(scholarship?.universityIds, id).toEqual(['uni-xian-jiaotong-university'])
      expect(scholarship?.programIds, id).toEqual([])
      expect(scholarship?.coverage, id).toEqual(expectedCoverage)
      expect(scholarship?.deadline, id).toBeNull()
      expect(scholarship?.applicationUrl, id).toBeNull()
      expect(scholarship?.verifiedAt, id).toBe(TODAY)
      expect(scholarship?.reviewAfter, id).toBe(TODAY)
      expect(scholarship?.status, id).toBe('stale')
      expect(scholarship?.summary?.en, id).toContain('identity retained only')
      expect(scholarship?.summary?.en, id).toContain('quarantined')
      expect(scholarship?.sourceIds, id).toEqual([
        'source-xjtu-2026-undergraduate-fees-scholarships',
      ])
    }
  })
  it('records the missing XJTU PDF snapshots and quarantines every dependent fact set', () => {
    const data = loadTempBundle()
    const ledger = readJson(LEDGER) as {
      policy: Record<string, boolean>
      xjtuPdfEvidenceGate: {
        rawPdfBytesCaptured: boolean
        browserSnapshotCaptured: boolean
        evidenceAvailable: string
        sha256: string | null
        sizeBytes: number | null
        privateSnapshotPath: string | null
      }
      sources: Array<{
        sourceId: string
        officialUrl: string
        locators: Array<{ supports: string[] }>
        evidenceAcquisition?: string
        releaseEvidenceScope?: string
        snapshot?: {
          status: string
          sha256: string | null
          sizeBytes: number | null
          privatePath: string | null
        }
      }>
      quarantinedCandidates: Array<{
        suggestedProgramId: string
        officialUrl: string
        state: string
        reasonCode: string
        snapshot: { status: string; sha256: string | null }
      }>
      quarantinedFactSets: Array<{
        id: string
        state: string
        reasonCode: string
        snapshotStatus: string
        affectedProgramIds?: string[]
        affectedScholarshipIds?: string[]
      }>
    }

    expect(ledger.policy).toMatchObject({
      officialSourcesOnly: true,
      httpsSourcesOnly: true,
      unknownValuesInferred: false,
      quarantinedCandidatesPublished: false,
      existingIdsAndSlugsPreserved: true,
    })
    expect(ledger.xjtuPdfEvidenceGate).toEqual(expect.objectContaining({
      rawPdfBytesCaptured: false,
      browserSnapshotCaptured: false,
      evidenceAvailable: 'official_search_index_text_only',
      sha256: null,
      sizeBytes: null,
      privateSnapshotPath: null,
    }))

    expect(ledger.sources).toHaveLength(10)
    for (const source of ledger.sources) {
      const url = new URL(source.officialUrl)
      expect(url.protocol).toBe('https:')
      expect(
        url.hostname.endsWith('.hit.edu.cn') || url.hostname.endsWith('.xjtu.edu.cn'),
        url.hostname,
      ).toBe(true)
      expect(source.locators.flatMap((locator) => locator.supports).length).toBeGreaterThan(0)
    }

    const xjtuPdfSources = ledger.sources.filter((source) => source.officialUrl.endsWith('.pdf'))
    expect(xjtuPdfSources).toHaveLength(4)
    for (const source of xjtuPdfSources) {
      expect(source.evidenceAcquisition, source.sourceId).toBe('official_search_index_text_only')
      expect(source.snapshot, source.sourceId).toEqual({
        status: 'unavailable',
        sha256: null,
        sizeBytes: null,
        privatePath: null,
      })
    }
    expect(Object.fromEntries(xjtuPdfSources.map((source) => [
      source.sourceId,
      source.releaseEvidenceScope,
    ]))).toEqual({
      'source-xjtu-2026-undergraduate-guide': 'none_dynamic_quarantined',
      'source-xjtu-2026-undergraduate-program-list': 'identity_only',
      'source-xjtu-2026-mbbs-guide': 'identity_only',
      'source-xjtu-2026-undergraduate-fees-scholarships': 'none_dynamic_quarantined',
    })
    expect(ledger.sources.find(
      (source) => source.sourceId === 'source-xjtu-official-application-system',
    )).toEqual(expect.objectContaining({
      officialUrl: 'https://isso.xjtu.edu.cn/recruit/login',
      evidenceAcquisition: 'direct_https_html',
      releaseEvidenceScope: 'application_entrypoint_only',
    }))

    expect(ledger.quarantinedFactSets.map((item) => item.id).sort()).toEqual([
      'xjtu-2026-undergraduate-dynamic-cycles',
      'xjtu-2026-undergraduate-scholarship-dynamic-facts',
    ])
    for (const factSet of ledger.quarantinedFactSets) {
      expect(factSet.state).toBe('quarantined')
      expect(factSet.reasonCode).toBe('pending_official_snapshot')
      expect(factSet.snapshotStatus).toBe('unavailable')
    }
    expect(ledger.quarantinedFactSets.find(
      (item) => item.id === 'xjtu-2026-undergraduate-dynamic-cycles',
    )?.affectedProgramIds).toHaveLength(5)
    expect(ledger.quarantinedFactSets.find(
      (item) => item.id === 'xjtu-2026-undergraduate-scholarship-dynamic-facts',
    )?.affectedScholarshipIds).toHaveLength(2)

    expect(ledger.quarantinedCandidates.map((item) => item.suggestedProgramId).sort()).toEqual(
      [...QUARANTINED_XJTU_CLP_IDS].sort(),
    )
    for (const item of ledger.quarantinedCandidates) {
      expect(item.state).toBe('quarantined')
      expect(item.reasonCode).toBe('pending_official_snapshot')
      expect(item.officialUrl).toBe('https://sie.xjtu.edu.cn/2026CLP.pdf')
      expect(item.snapshot).toEqual(expect.objectContaining({ status: 'unavailable', sha256: null }))
      expect(data.programs.some((program) => program.id === item.suggestedProgramId)).toBe(false)
    }
    expect(data.sources.some((source) => source.url.endsWith('/2026CLP.pdf'))).toBe(false)
    for (const identityProgram of data.programs.filter(
      (program) => program.verificationScope === 'identity',
    )) {
      expect(identityProgram.durationMonths, identityProgram.id).toBeNull()
      expect(identityProgram.languageRequirements, identityProgram.id).toEqual([])
      expect(identityProgram.details, identityProgram.id).toBeUndefined()
    }

    for (const cycleId of QUARANTINED_XJTU_DYNAMIC_CYCLE_IDS) {
      expect(data.admissionCycles.some((cycle) => cycle.id === cycleId), cycleId).toBe(false)
    }

    for (const sourceId of [
      'source-hit-2026-master-admissions',
      'src-gap-program-wave8-hit-long-term-chinese-language',
      'src-gap-program-wave8-hit-global-summer-school',
      'src-gap-program-wave8-hit-pre-university-program',
      'src-gap-program-wave8-hit-winter-short-term-chinese-2026',
      'source-xjtu-2026-undergraduate-guide',
      'source-xjtu-2026-undergraduate-program-list',
      'source-xjtu-2026-mbbs-guide',
      'source-xjtu-2026-undergraduate-fees-scholarships',
      'source-xjtu-official-application-system',
    ]) {
      const source = data.sources.find((item) => item.id === sourceId)
      expect(source?.official, sourceId).toBe(true)
      expect(source?.accessedAt, sourceId).toBe(TODAY)
      expect(source?.url.startsWith('https://'), sourceId).toBe(true)
    }
  })
})
