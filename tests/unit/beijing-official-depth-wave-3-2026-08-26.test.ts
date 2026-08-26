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
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getApplicationState, selectAdmissionCycle } from '../../src/lib/data/admission'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SOURCE_DATA_DIR = join(ROOT, 'content', 'data')
const IMPORTER = join(
  ROOT,
  'scripts',
  'ingestion',
  'apply-beijing-official-depth-wave-3-2026-08-26.cjs',
)
const LEDGER = join(
  ROOT,
  'quality',
  'official-depth-wave-3-2026-08-26',
  'beijing-fact-ledger.json',
)
const TODAY = '2026-08-26'
const CLP_ID = 'program-tsinghua-university-chinese-language-program-language'
const VISITING_ID = 'program-tsinghua-university-visiting-student-program-other'
const UNSUPPORTED_BA_ID = 'program-tsinghua-university-business-administration-master'
const CURRENT_CYCLE_IDS = [
  'cycle-thu-chinese-language-spring-2027',
  'cycle-thu-visiting-student-spring-2027',
  'cycle-thu-visiting-student-autumn-2027',
] as const
const HISTORICAL_CYCLE_IDS = [
  'cycle-thu-architecture-2026-2027-autumn-fee-reference',
  'cycle-thu-icpm-2026-2027-autumn-fee-reference',
  'cycle-thu-environmental-science-master-2026-2027-autumn-fee-reference',
  'cycle-thu-vehicle-mobility-2026-2027-autumn-fee-reference',
  'cycle-thu-global-manufacturing-2026-2027-autumn-fee-reference',
  'cycle-thu-imem-2026-2027-autumn-fee-reference',
  'cycle-thu-advanced-computing-2026-2027-autumn-fee-reference',
  'cycle-thu-computer-science-phd-2026-2027-autumn-fee-reference',
  'cycle-thu-nuclear-engineering-management-2026-2027-autumn-fee-reference',
  'cycle-thu-global-mba-2026-2027-autumn-fee-reference',
  'cycle-thu-mid-2026-2027-autumn-fee-reference',
  'cycle-thu-llm-chinese-law-2026-2027-autumn-fee-reference',
  'cycle-gap-pku-depth-cs-master-english-2026-2027-autumn-fee-reference',
  'cycle-gap-pku-depth-cs-doctorate-english-2026-2027-autumn-fee-reference',
  'cycle-gap-pku-depth-impa-cppic-master-2026-2027-autumn-fee-reference',
  'cycle-gap-pku-depth-llm-chinese-law-2026-2027-autumn-fee-reference',
] as const
const FILES_WRITTEN = ['sources.json', 'programs.json', 'admission-cycles.json'] as const

let tempRoot = ''
let tempDataDir = ''
let originalBusinessSlug = ''
let firstRunSnapshot = new Map<string, string>()
let secondRunSnapshot = new Map<string, string>()

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
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
  tempRoot = mkdtempSync(join(tmpdir(), 'studyinchina-beijing-wave3-'))
  tempDataDir = join(tempRoot, 'data')
  mkdirSync(tempDataDir)

  for (const name of readdirSync(SOURCE_DATA_DIR).filter((entry) => entry.endsWith('.json'))) {
    copyFileSync(join(SOURCE_DATA_DIR, name), join(tempDataDir, name))
  }

  const baselinePrograms = readJson(join(tempDataDir, 'programs.json')) as Array<{
    id: string
    slug: string
  }>
  originalBusinessSlug = baselinePrograms.find((program) => program.id === UNSUPPORTED_BA_ID)?.slug ?? ''

  const cyclePath = join(tempDataDir, 'admission-cycles.json')
  const cycles = readJson(cyclePath) as Array<Record<string, unknown>>
  cycles.push({
    id: 'cycle-injected-unsupported-thu-business-administration',
    programId: UNSUPPORTED_BA_ID,
    academicYear: '2028-2029',
    intake: 'autumn',
    opensOn: '2028-01-01',
    closesOn: '2028-05-01',
    dateStatus: 'published',
    tuitionCny: 999999,
    tuitionPeriod: 'program',
    tuitionStatus: 'confirmed',
    evidenceBasis: 'cycle-specific',
    factScope: 'complete',
    applicationFeeCny: 999,
    sourceIds: ['src-uni-tsinghua-university'],
    verifiedAt: TODAY,
    reviewAfter: '2026-09-26',
    status: 'verified',
  })
  writeJson(cyclePath, cycles)

  runImporter()
  firstRunSnapshot = snapshotWrittenFiles()
  runImporter()
  secondRunSnapshot = snapshotWrittenFiles()
})

afterAll(() => {
  if (tempRoot.startsWith(tmpdir())) rmSync(tempRoot, { recursive: true, force: true })
})

describe('Beijing official depth wave 3 importer on 2026-08-26', () => {
  it('is byte-for-byte idempotent and leaves the complete catalog schema-valid', () => {
    expect(secondRunSnapshot).toEqual(firstRunSnapshot)
    expect(() => loadTempBundle()).not.toThrow()
  })

  it('completes the official Spring 2027 Tsinghua Chinese Language Program', () => {
    const data = loadTempBundle()
    const program = data.programs.find((item) => item.id === CLP_ID)
    const cycle = data.admissionCycles.find(
      (item) => item.id === 'cycle-thu-chinese-language-spring-2027',
    )

    expect(program).toMatchObject({
      durationMonths: 4,
      durationMonthsMax: null,
      teachingLanguages: ['English', 'Chinese'],
      applyUrl: 'https://intl-nondegree.tsinghua.edu.cn/f/login',
      verificationScope: 'complete',
      verifiedAt: TODAY,
      reviewAfter: '2026-08-29',
      status: 'verified',
    })
    expect(program?.details?.overview.en).toContain('18 weeks')
    expect(program?.details?.qualification.en).toContain('20–55')
    expect(program?.details?.qualification.en).toContain('bachelor')
    expect(program?.details?.applicationMaterials).toHaveLength(3)

    expect(cycle).toMatchObject({
      academicYear: '2026-2027',
      intake: 'spring',
      opensOn: '2026-09-29',
      closesOn: '2026-11-03',
      dateStatus: 'published',
      tuitionCny: 12600,
      tuitionPeriod: 'semester',
      tuitionStatus: 'confirmed',
      applicationFeeCny: 400,
      evidenceBasis: 'cycle-specific',
      factScope: 'complete',
      status: 'verified',
    })
    expect(cycle?.notes?.en).toContain('11:00 Beijing time')
    expect(cycle?.notes?.en).toContain('no scholarship')
    expect(getApplicationState(cycle, TODAY)).toBe('upcoming')
  })

  it('publishes both real 2027 visiting windows while keeping the official fee matrix non-scalar', () => {
    const data = loadTempBundle()
    const program = data.programs.find((item) => item.id === VISITING_ID)
    const spring = data.admissionCycles.find(
      (item) => item.id === 'cycle-thu-visiting-student-spring-2027',
    )
    const autumn = data.admissionCycles.find(
      (item) => item.id === 'cycle-thu-visiting-student-autumn-2027',
    )

    expect(program).toMatchObject({
      durationMonths: 5,
      durationMonthsMax: 24,
      teachingLanguages: ['Chinese', 'English'],
      applyUrl: 'https://intl-nondegree.tsinghua.edu.cn/f/login',
      verificationScope: 'complete',
      status: 'verified',
    })
    expect(program?.details?.overview.en).toContain('one semester to two years')
    expect(program?.details?.qualification.en).toContain('45')
    expect(program?.details?.qualification.en).toContain('50')
    expect(program?.languageRequirements).toEqual(expect.arrayContaining([
      { test: 'HSK', minimum: expect.stringContaining('210') },
      { test: 'HSK', minimum: expect.stringContaining('180') },
      { test: 'TOEFL', minimum: expect.stringContaining('90') },
      { test: 'IELTS', minimum: expect.stringContaining('6.5') },
    ]))

    expect(spring).toMatchObject({
      opensOn: '2026-10-15',
      closesOn: '2026-11-30',
      tuitionCny: null,
      tuitionPeriod: null,
      tuitionStatus: null,
      applicationFeeCny: 400,
      factScope: 'partial',
      status: 'verified',
    })
    expect(autumn).toMatchObject({
      opensOn: '2027-03-15',
      closesOn: '2027-05-15',
      tuitionCny: null,
      tuitionPeriod: null,
      tuitionStatus: null,
      applicationFeeCny: 400,
      factScope: 'partial',
      status: 'verified',
    })
    for (const cycle of [spring, autumn]) {
      expect(cycle?.notes?.en).toContain('General visitors pay')
      expect(cycle?.notes?.en).toContain('Senior visitors pay')
      expect(cycle?.notes?.en).toContain('No single tuition value')
      expect(getApplicationState(cycle, TODAY)).toBe('upcoming')
    }
    expect(autumn?.notes?.en).toContain('15 March–30 April 2027')
    expect(selectAdmissionCycle(data.admissionCycles, VISITING_ID, TODAY)?.id).toBe(
      'cycle-thu-visiting-student-spring-2027',
    )
  })

  it('archives the unsupported generic Business Administration identity without breaking its slug', () => {
    const data = loadTempBundle()
    const program = data.programs.find((item) => item.id === UNSUPPORTED_BA_ID)

    expect(originalBusinessSlug).toBe('tsinghua-university-business-administration-master')
    expect(program).toMatchObject({
      slug: originalBusinessSlug,
      durationMonths: null,
      durationMonthsMax: null,
      applyUrl: null,
      teachingLanguages: [],
      languageRequirements: [],
      verificationScope: 'identity',
      status: 'archived',
    })
    expect(data.admissionCycles.some((cycle) => cycle.programId === UNSUPPORTED_BA_ID)).toBe(false)
    expect(selectPublishedData(data, TODAY).programs.some(
      (item) => item.id === UNSUPPORTED_BA_ID,
    )).toBe(false)
  })

  it('keeps every 2026 Tsinghua and PKU fee as historical reference, never current/open', () => {
    const data = loadTempBundle()
    const historical = HISTORICAL_CYCLE_IDS.map((id) => {
      const cycle = data.admissionCycles.find((item) => item.id === id)
      expect(cycle, id).toBeDefined()
      return cycle!
    })

    for (const cycle of historical) {
      expect(cycle.academicYear, cycle.id).toBe('2026-2027')
      expect(cycle.dateStatus, cycle.id).toBe('previous-cycle-reference')
      expect(cycle.opensOn, cycle.id).toBeNull()
      expect(cycle.closesOn, cycle.id).toBeNull()
      expect(cycle.status, cycle.id).toBe('stale')
      expect(getApplicationState(cycle, TODAY), cycle.id).toBe('previous-cycle')
      expect(cycle.notes?.en, cycle.id).toContain('No 2027 application date or fee is inferred')
    }

    expect(data.admissionCycles.find(
      (cycle) => cycle.id === 'cycle-thu-architecture-2026-2027-autumn-fee-reference',
    )).toMatchObject({ tuitionCny: 120000, tuitionPeriod: 'program', tuitionStatus: 'reference' })
    expect(data.admissionCycles.find(
      (cycle) => cycle.id === 'cycle-gap-pku-depth-cs-doctorate-english-2026-2027-autumn-fee-reference',
    )?.notes?.en).toContain('CNY 200,000 for four years or CNY 250,000 for five years')
    expect(data.admissionCycles.find(
      (cycle) => cycle.id === 'cycle-gap-pku-depth-impa-cppic-master-2026-2027-autumn-fee-reference',
    )).toMatchObject({ tuitionCny: 190000, tuitionPeriod: 'academic-year', applicationFeeCny: 800 })

    const publishedCycleIds = new Set(
      selectPublishedData(data, TODAY).admissionCycles.map((cycle) => cycle.id),
    )
    expect(CURRENT_CYCLE_IDS.every((id) => publishedCycleIds.has(id))).toBe(true)
    expect(HISTORICAL_CYCLE_IDS.some((id) => publishedCycleIds.has(id))).toBe(false)
  })

  it('records raw-byte hashes, PDF/HTML locators, private R2 keys and every withheld fact', () => {
    const ledger = readJson(LEDGER) as {
      policy: Record<string, boolean>
      snapshotConvention: {
        status: string
        bucket: string
        confirmedAt: string
      }
      sources: Array<{
        sourceId: string
        officialUrl: string
        evidenceAcquisition: string
        releaseEvidenceScope: string
        snapshot: {
          status: string
          sha256: string
          sizeBytes: number
          mimeType: string
          r2ObjectKey: string
        }
        locators: Array<{ kind: string; page?: number; supports: string[] }>
        feeMatrix?: {
          scalarCatalogValue: number | null
          generalVisiting: Record<string, number>
          seniorVisiting: Record<string, number>
        }
      }>
      currentProgramCoverage: Array<{
        programId: string
        withheldFacts: string[]
        tuitionRepresentation?: string
      }>
      historicalCycleCoverage: string[]
      quarantinedFactSets: Array<{
        programId: string
        preservedSlug: string
        state: string
        reasonCode: string
        cyclesRemoved: string[]
      }>
    }

    expect(ledger.policy).toMatchObject({
      officialSourcesOnly: true,
      httpsSourcesOnly: true,
      searchSnippetsSupportDynamicFacts: false,
      unknownValuesInferred: false,
      closed2026CyclesPublishedAsCurrent: false,
      scalarVisitingTuitionAllowed: false,
      rawEvidenceCommittedToGit: false,
      privateR2ObjectKeysRegistered: true,
      privateR2UploadConfirmed: true,
    })
    expect(ledger.snapshotConvention).toMatchObject({
      status: 'confirmed_private_r2_upload',
      bucket: 'studyinchina-source-snapshots',
    })
    expect(ledger.snapshotConvention.confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)

    expect(ledger.sources).toHaveLength(11)
    for (const source of ledger.sources) {
      const url = new URL(source.officialUrl)
      expect(url.protocol, source.sourceId).toBe('https:')
      expect(
        url.hostname.endsWith('.tsinghua.edu.cn') || url.hostname.endsWith('.pku.edu.cn'),
        source.sourceId,
      ).toBe(true)
      expect(source.snapshot.status, source.sourceId).toBe(
        'confirmed_private_r2_upload',
      )
      expect(source.snapshot.sha256, source.sourceId).toMatch(/^[a-f0-9]{64}$/)
      expect(source.snapshot.sizeBytes, source.sourceId).toBeGreaterThan(0)
      expect(source.snapshot.r2ObjectKey, source.sourceId).toContain(source.snapshot.sha256)
      expect(source.locators.flatMap((locator) => locator.supports).length, source.sourceId)
        .toBeGreaterThan(0)
    }

    const clpPdf = ledger.sources.find(
      (source) => source.sourceId === 'source-thu-clp-spring-2027-guide-pdf',
    )
    expect(clpPdf?.evidenceAcquisition).toBe('raw_pdf_bytes')
    expect(clpPdf?.locators.map((locator) => locator.page)).toEqual([3, 4, 5])
    expect(clpPdf?.snapshot).toMatchObject({
      sha256: '1666a2d1d9c532c3c4e95e9911cd3595f7036ffe58ddd5cac7aa16ced0072457',
      sizeBytes: 5375945,
      mimeType: 'application/pdf',
    })

    const visitingFees = ledger.sources.find(
      (source) => source.sourceId === 'source-thu-visiting-fees-schedule',
    )
    expect(visitingFees?.feeMatrix?.scalarCatalogValue).toBeNull()
    expect(visitingFees?.feeMatrix?.generalVisiting).toEqual({
      scienceEngineering: 30000,
      economicsManagement: 26000,
      lawJournalismHumanitiesSocialSciences: 25000,
      arts: 40000,
    })
    expect(visitingFees?.feeMatrix?.seniorVisiting).toEqual({
      scienceEngineering: 33000,
      economicsManagement: 30000,
      lawJournalismHumanitiesSocialSciences: 28000,
      arts: 45000,
    })

    expect(ledger.historicalCycleCoverage.slice().sort()).toEqual(
      [...HISTORICAL_CYCLE_IDS].sort(),
    )
    const visitingCoverage = ledger.currentProgramCoverage.find(
      (item) => item.programId === VISITING_ID,
    )
    expect(visitingCoverage?.withheldFacts).toEqual([
      'scalar_tuition_withheld_because_official_fee_depends_on_category_and_discipline',
    ])
    expect(visitingCoverage?.tuitionRepresentation).toBe(
      'structured_fee_matrix_in_ledger_and_cycle_notes',
    )

    expect(ledger.quarantinedFactSets).toEqual([
      expect.objectContaining({
        programId: UNSUPPORTED_BA_ID,
        preservedSlug: originalBusinessSlug,
        state: 'archived_not_public',
        reasonCode: 'no_exact_international_program_mapping',
        cyclesRemoved: ['cycle-2027-tsinghua-university-business-administration-master'],
      }),
    ])

    const receiptPath = join(dirname(LEDGER), 'beijing-r2-upload-receipt.json')
    const receipt = readJson(receiptPath) as {
      receiptVersion: number
      waveId: string
      bucket: string
      visibility: string
      verification: {
        expectedObjects: number
        verifiedObjects: number
        allObjectsVerified: boolean
      }
      objects: Array<{
        sourceId: string
        sha256: string
        size: number
        mime: string
        r2Key: string
        remoteReadBackVerified: boolean
      }>
    }
    expect(receipt).toMatchObject({
      receiptVersion: 1,
      waveId: 'beijing-official-depth-wave-3-2026-08-26',
      bucket: 'studyinchina-source-snapshots',
      visibility: 'private',
      verification: {
        expectedObjects: 11,
        verifiedObjects: 11,
        allObjectsVerified: true,
      },
    })
    expect(receipt.objects).toHaveLength(11)
    for (const source of ledger.sources) {
      expect(receipt.objects.find((item) => item.sourceId === source.sourceId)).toMatchObject({
        sha256: source.snapshot.sha256,
        size: source.snapshot.sizeBytes,
        mime: source.snapshot.mimeType,
        r2Key: source.snapshot.r2ObjectKey,
        remoteReadBackVerified: true,
      })
    }
    const receiptText = readFileSync(receiptPath, 'utf8')
    expect(receiptText).not.toContain('"localPath"')
    expect(receiptText).not.toMatch(/[A-Za-z]:\\\\/)
    expect(receiptText).not.toMatch(/CLOUDFLARE_(API_TOKEN|ACCOUNT_ID)/)
    expect(readdirSync(dirname(LEDGER)).sort()).toEqual(expect.arrayContaining([
      'beijing-fact-ledger.json',
      'beijing-r2-upload-receipt.json',
    ]))
  })
})
