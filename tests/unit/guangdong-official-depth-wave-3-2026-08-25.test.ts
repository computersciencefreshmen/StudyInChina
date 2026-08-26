import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getApplicationState } from '../../src/lib/data/admission'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'

const ROOT = resolve(__dirname, '../..')
const DATA_DIR = join(ROOT, 'content', 'data')
const IMPORTER = join(
  ROOT,
  'scripts',
  'ingestion',
  'apply-guangdong-official-depth-wave-3-2026-08-25.cjs',
)
const LEDGER = join(
  ROOT,
  'quality',
  'official-depth-wave-3-2026-08-25',
  'guangdong-fact-ledger.json',
)
const R2_AUDIT_RECEIPT = join(
  ROOT,
  'quality',
  'official-depth-wave-3-2026-08-25',
  'guangdong-r2-audit-receipt-2026-08-26.json',
)
const TODAY = '2026-08-25'

const SZU_PROGRAM_IDS = [
  'program-shenzhen-university-computer-science-bachelor',
  'program-shenzhen-university-design-master',
  'program-shenzhen-university-chinese-language-program-language',
  'program-shenzhen-university-iclt-one-semester-language',
  'program-shenzhen-university-international-business-administration-bachelor',
  'program-shenzhen-university-international-economics-and-trade-bachelor',
  'program-shenzhen-university-financial-technology-webank-asean-class-bachelor',
  'program-shenzhen-university-foreign-languages-and-literature-master',
  'program-shenzhen-university-area-studies-master',
  'program-shenzhen-university-civil-engineering-master',
  'program-shenzhen-university-journalism-and-communication-doctorate',
  'program-shenzhen-university-chemistry-doctorate',
  'program-shenzhen-university-biology-doctorate',
  'program-shenzhen-university-basic-medicine-doctorate',
  'prog-gap-prog-szu-chinese-language-literature-bachelor-2026',
  'prog-gap-clw-sw-szu-icl-master',
  'prog-gap-prog-szu-tcsol-bachelor-2026',
] as const

const JNU_PROGRAM_IDS = [
  'program-jinan-university-international-economics-and-trade-bachelor',
  'program-jinan-university-computer-science-and-technology-bachelor',
  'program-jinan-university-accounting-bachelor',
  'program-jinan-university-finance-bachelor',
  'program-jinan-university-pharmacy-bachelor',
  'program-jinan-university-international-journalism-and-communication-bachelor',
  'program-jinan-university-food-nutrition-and-health-bachelor',
  'program-jinan-university-clinical-medicine-bachelor',
  'prog-gap-clw-sw-jnu-chinese-language-bachelor',
  'prog-gap-clw-sw-jnu-chinese-culture-education-bachelor',
  'prog-gap-clw-sw-jnu-tcsol-bachelor',
] as const

const GDPU_PROGRAM_IDS = [
  'prog-gap-mew-0805-scw-gdpu-basic-medicine-master',
  'prog-gap-mew-0805-scw-gdpu-bioengineering-master',
  'prog-gap-mew-0805-scw-gdpu-integrated-medicine-master',
  'prog-gap-mew-0805-scw-gdpu-pharmacy-academic-master',
  'prog-gap-mew-0805-scw-gdpu-public-health-preventive-master',
] as const

const GDUFE_PROGRAM_IDS = [
  'prog-gap-mew-csw-gdufe-digital-economy-master',
  'prog-gap-mew-csw-gdufe-international-trade-master',
  'prog-gap-mew-csw-gdufe-international-chinese-education-master',
  'prog-gap-mew-csw-gdufe-international-trade-doctorate',
] as const

const WAVE_PROGRAM_IDS = [
  ...SZU_PROGRAM_IDS,
  ...JNU_PROGRAM_IDS,
  ...GDPU_PROGRAM_IDS,
  ...GDUFE_PROGRAM_IDS,
] as const
const WAVE_PROGRAM_ID_SET = new Set<string>(WAVE_PROGRAM_IDS)
const ICLT_PROGRAM_ID = 'program-shenzhen-university-iclt-one-semester-language'
const HISTORICAL_PROGRAM_IDS = WAVE_PROGRAM_IDS.filter((id) => id !== ICLT_PROGRAM_ID)
const HISTORICAL_PROGRAM_ID_SET = new Set<string>(HISTORICAL_PROGRAM_IDS)

const read = (name: string): unknown => JSON.parse(
  readFileSync(join(DATA_DIR, name), 'utf8'),
)
const data = bundleSchema.parse({
  admissionCycles: read('admission-cycles.json'),
  cities: read('cities.json'),
  programs: read('programs.json'),
  scholarships: read('scholarships.json'),
  sources: read('sources.json'),
  universities: read('universities.json'),
})
const published = selectPublishedData(data, TODAY)
const sourceById = new Map(data.sources.map((source) => [source.id, source]))

type Ledger = {
  checkedAt: string
  sources: Array<{
    sourceId: string
    officialUrl: string
    snapshotStatus: string
    contentSha256: string
    r2ObjectKey: string
    snapshotSizeBytes: number
  }>
  programCoverage: Array<{ programIds: string[] }>
  quarantine: Array<{ institutionId: string; decision: string }>
  publicationDecisions: string[]
}
type R2AuditReceipt = {
  summary: {
    expectedAssets: number
    localBytesVerified: number
    localBytesMissing: number
    evidenceValidatedAssets: number
    r2ObjectsProbed: number
    uploadAttempted: number
    objectsUploaded: number
    existingObjectsReused: number
    remoteReadbackVerified: number
    confirmedAssets: number
    quarantinedAssets: number
    contentChangedAndRekeyedAssets: number
  }
  assets: Array<{
    sourceId: string
    uploadStatus: string
    readbackStatus: string
    finalStatus: string
  }>
  sanitization: {
    localAbsolutePathsIncluded: boolean
    credentialsIncluded: boolean
  }
}

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger
const r2AuditReceiptRaw = readFileSync(R2_AUDIT_RECEIPT, 'utf8')
const r2AuditReceipt = JSON.parse(r2AuditReceiptRaw) as R2AuditReceipt

function program(id: string) {
  const result = data.programs.find((item) => item.id === id)
  expect(result, id).toBeDefined()
  return result!
}

function historicalCycle(programId: string) {
  const result = data.admissionCycles.find((item) => (
    item.programId === programId
      && item.academicYear === '2026-2027'
      && item.intake === 'autumn'
      && item.dateStatus === 'previous-cycle-reference'
  ))
  expect(result, programId).toBeDefined()
  return result!
}

describe('Guangdong official depth wave 3 on 2026-08-25', () => {
  it('materializes 37 existing identities and preserves stable IDs and slugs', () => {
    expect(WAVE_PROGRAM_IDS).toHaveLength(37)
    expect(new Set(WAVE_PROGRAM_IDS).size).toBe(37)

    const expectedDurations = new Map<string, number>([
      ['program-shenzhen-university-computer-science-bachelor', 48],
      ['program-shenzhen-university-design-master', 36],
      ['program-shenzhen-university-chinese-language-program-language', 5],
      ['program-shenzhen-university-iclt-one-semester-language', 5],
      ['program-shenzhen-university-international-business-administration-bachelor', 48],
      ['program-shenzhen-university-international-economics-and-trade-bachelor', 48],
      ['program-shenzhen-university-financial-technology-webank-asean-class-bachelor', 48],
      ['program-shenzhen-university-foreign-languages-and-literature-master', 24],
      ['program-shenzhen-university-area-studies-master', 24],
      ['program-shenzhen-university-civil-engineering-master', 36],
      ['program-shenzhen-university-journalism-and-communication-doctorate', 48],
      ['program-shenzhen-university-chemistry-doctorate', 48],
      ['program-shenzhen-university-biology-doctorate', 48],
      ['program-shenzhen-university-basic-medicine-doctorate', 48],
      ['prog-gap-prog-szu-chinese-language-literature-bachelor-2026', 48],
      ['prog-gap-clw-sw-szu-icl-master', 24],
      ['prog-gap-prog-szu-tcsol-bachelor-2026', 48],
      ...JNU_PROGRAM_IDS.map((id) => [
        id,
        id === 'program-jinan-university-clinical-medicine-bachelor' ? 72 : 48,
      ] as const),
      ...GDPU_PROGRAM_IDS.map((id) => [id, 36] as const),
      ['prog-gap-mew-csw-gdufe-digital-economy-master', 24],
      ['prog-gap-mew-csw-gdufe-international-trade-master', 36],
      ['prog-gap-mew-csw-gdufe-international-chinese-education-master', 36],
      ['prog-gap-mew-csw-gdufe-international-trade-doctorate', 48],
    ])

    expect(expectedDurations.size).toBe(37)
    for (const [id, durationMonths] of expectedDurations) {
      const item = program(id)
      expect(item.status, id).toBe('verified')
      expect(item.verifiedAt, id).toBe(TODAY)
      expect(item.durationMonths, id).toBe(durationMonths)
      expect(item.verificationScope, id).toBe('facts')
      expect(item.slug, id).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('uses confirmed languages and healthy HTTPS routes without guessing GDPU fields', () => {
    for (const id of SZU_PROGRAM_IDS) {
      const item = program(id)
      expect(item.teachingLanguages.length, id).toBeGreaterThan(0)
      expect(item.applyUrl, id).toMatch(/^https:\/\//)
    }
    for (const id of JNU_PROGRAM_IDS) {
      const item = program(id)
      expect(item.teachingLanguages.length, id).toBeGreaterThan(0)
      expect(item.applyUrl, id).toBe('https://lxlz.jnu.edu.cn/')
    }
    for (const id of GDUFE_PROGRAM_IDS) {
      const item = program(id)
      expect(item.teachingLanguages.length, id).toBeGreaterThan(0)
      expect(item.applyUrl, id).toBe('https://gdufe.at0086.cn/StuApplication/Login.aspx')
    }
    for (const id of GDPU_PROGRAM_IDS) {
      const item = program(id)
      expect(item.teachingLanguages, id).toEqual([])
      expect(item.applyUrl, id).toBeNull()
      expect(item.languageRequirements.some((requirement) => (
        requirement.test === 'IELTS' && requirement.minimum?.includes('6.0')
      )), id).toBe(true)
    }
  })

  it('keeps route-specific Chinese requirements from contaminating other routes', () => {
    const selfFundedIclMaster = program('prog-gap-clw-sw-szu-icl-master')
    const selfFundedRequirements = JSON.stringify(selfFundedIclMaster.languageRequirements)
    expect(selfFundedRequirements).toContain('Level 5, score 180')
    expect(selfFundedRequirements).not.toContain('210')
    expect(selfFundedRequirements).not.toContain('HSKK')

    const icltOneSemester = program(ICLT_PROGRAM_ID)
    const scholarshipRequirements = JSON.stringify(icltOneSemester.languageRequirements)
    expect(scholarshipRequirements).toContain('Level 3, score 180')
    expect(scholarshipRequirements).toContain('HSKK')

    for (const id of [
      'prog-gap-prog-szu-chinese-language-literature-bachelor-2026',
      'prog-gap-prog-szu-tcsol-bachelor-2026',
    ]) {
      const requirements = JSON.stringify(program(id).languageRequirements)
      expect(requirements, id).toContain('No HSK certificate required')
      expect(requirements, id).not.toContain('Level 4')
    }

    const jnuChineseCulture = program('prog-gap-clw-sw-jnu-chinese-culture-education-bachelor')
    expect(jnuChineseCulture.languageRequirements).toEqual([
      { test: 'HSK', minimum: 'Level 5, score 180' },
    ])
  })

  it('stores all 36 closed 2026 rounds as non-public historical references', () => {
    expect(HISTORICAL_PROGRAM_IDS).toHaveLength(36)
    for (const id of HISTORICAL_PROGRAM_IDS) {
      const cycle = historicalCycle(id)
      expect(cycle.status, id).toBe('stale')
      expect(cycle.reviewAfter, id).toBe(TODAY)
      expect(cycle.closesOn?.localeCompare(TODAY), id).toBeLessThan(0)
      expect(cycle.evidenceBasis, id).toBe('cycle-specific')
      expect(published.admissionCycles.some((item) => item.id === cycle.id), id).toBe(false)
    }
  })

  it('keeps every 2026 fee on the 2026–2027 historical record', () => {
    const expectedTuition = new Map<string, number>([
      ['program-shenzhen-university-computer-science-bachelor', 30000],
      ['program-shenzhen-university-design-master', 45000],
      ['program-shenzhen-university-chinese-language-program-language', 11000],
      ['program-shenzhen-university-international-business-administration-bachelor', 26000],
      ['program-shenzhen-university-international-economics-and-trade-bachelor', 26000],
      ['program-shenzhen-university-financial-technology-webank-asean-class-bachelor', 26000],
      ['program-shenzhen-university-foreign-languages-and-literature-master', 30000],
      ['program-shenzhen-university-area-studies-master', 30000],
      ['program-shenzhen-university-civil-engineering-master', 35000],
      ['program-shenzhen-university-journalism-and-communication-doctorate', 34000],
      ['program-shenzhen-university-chemistry-doctorate', 40000],
      ['program-shenzhen-university-biology-doctorate', 40000],
      ['program-shenzhen-university-basic-medicine-doctorate', 52000],
      ['prog-gap-prog-szu-chinese-language-literature-bachelor-2026', 26000],
      ['prog-gap-clw-sw-szu-icl-master', 30000],
      ['prog-gap-prog-szu-tcsol-bachelor-2026', 26000],
      ['program-jinan-university-international-economics-and-trade-bachelor', 28000],
      ['program-jinan-university-computer-science-and-technology-bachelor', 30000],
      ['program-jinan-university-accounting-bachelor', 32000],
      ['program-jinan-university-finance-bachelor', 28000],
      ['program-jinan-university-pharmacy-bachelor', 30000],
      ['program-jinan-university-international-journalism-and-communication-bachelor', 28000],
      ['program-jinan-university-food-nutrition-and-health-bachelor', 30000],
      ['program-jinan-university-clinical-medicine-bachelor', 40000],
      ['prog-gap-clw-sw-jnu-chinese-language-bachelor', 22000],
      ['prog-gap-clw-sw-jnu-chinese-culture-education-bachelor', 22000],
      ['prog-gap-clw-sw-jnu-tcsol-bachelor', 22000],
      ['prog-gap-mew-csw-gdufe-digital-economy-master', 25000],
      ['prog-gap-mew-csw-gdufe-international-trade-master', 25000],
      ['prog-gap-mew-csw-gdufe-international-chinese-education-master', 25000],
      ['prog-gap-mew-csw-gdufe-international-trade-doctorate', 30000],
    ])

    expect(expectedTuition.size).toBe(31)
    for (const [id, tuitionCny] of expectedTuition) {
      const cycle = historicalCycle(id)
      expect(cycle.academicYear, id).toBe('2026-2027')
      expect(cycle.tuitionCny, id).toBe(tuitionCny)
      expect(cycle.tuitionStatus, id).toBe('reference')
      expect(cycle.applicationFeeCny, id).toBe(id.startsWith('program-shenzhen-')
        || id.startsWith('prog-gap-prog-szu-')
        || id === 'prog-gap-clw-sw-szu-icl-master'
        ? 400
        : 500)
    }

    const projectedFeeCycles = data.admissionCycles.filter((cycle) => (
      WAVE_PROGRAM_ID_SET.has(cycle.programId)
        && cycle.academicYear === '2027-2028'
        && (cycle.tuitionCny !== null || cycle.applicationFeeCny !== null)
    ))
    expect(projectedFeeCycles).toEqual([])

    const currentConfirmedHistoricalFees = published.admissionCycles.filter((cycle) => (
      HISTORICAL_PROGRAM_ID_SET.has(cycle.programId)
        && cycle.tuitionStatus === 'confirmed'
    ))
    expect(currentConfirmedHistoricalFees).toEqual([])
  })

  it('keeps all five GDPU fees officially unannounced', () => {
    for (const id of GDPU_PROGRAM_IDS) {
      const cycle = historicalCycle(id)
      expect(cycle.tuitionCny, id).toBeNull()
      expect(cycle.tuitionStatus, id).toBeNull()
      expect(cycle.applicationFeeCny, id).toBeNull()
      expect(cycle.factScope, id).toBe('dates-only')
      expect(cycle.notes?.en, id).toContain('does not state tuition or an application fee')
    }
  })

  it('publishes only the SZU spring 2027 future deadline without inventing an opening date', () => {
    const futureWaveCycles = published.admissionCycles.filter((cycle) => (
      WAVE_PROGRAM_ID_SET.has(cycle.programId)
    ))
    expect(futureWaveCycles).toHaveLength(1)

    const cycle = futureWaveCycles[0]
    expect(cycle.programId).toBe(ICLT_PROGRAM_ID)
    expect(cycle.academicYear).toBe('2026-2027')
    expect(cycle.intake).toBe('spring')
    expect(cycle.opensOn).toBeNull()
    expect(cycle.closesOn).toBe('2026-10-31')
    expect(cycle.tuitionCny).toBeNull()
    expect(cycle.applicationFeeCny).toBeNull()
    expect(getApplicationState(cycle, TODAY)).toBe('dates-published')
  })

  it('registers official HTTPS sources with honest mixed private-R2 audit states', () => {
    expect(ledger.checkedAt).toBe(TODAY)
    expect(ledger.sources).toHaveLength(20)

    const confirmed = ledger.sources.filter((source) => (
      source.snapshotStatus === 'confirmed_private_r2_readback'
    ))
    const quarantined = ledger.sources.filter((source) => (
      source.snapshotStatus === 'quarantined_local_bytes_missing'
    ))
    expect(confirmed).toHaveLength(20)
    expect(quarantined).toHaveLength(0)

    for (const captured of ledger.sources) {
      expect(new URL(captured.officialUrl).protocol, captured.sourceId).toBe('https:')
      expect(captured.snapshotStatus, captured.sourceId).toBe('confirmed_private_r2_readback')
      expect(captured.contentSha256, captured.sourceId).toMatch(/^[a-f0-9]{64}$/)
      expect(captured.r2ObjectKey, captured.sourceId).toContain(captured.contentSha256)
      expect(captured.snapshotSizeBytes, captured.sourceId).toBeGreaterThan(0)

      const source = sourceById.get(captured.sourceId)
      expect(source, captured.sourceId).toBeDefined()
      expect(source?.official, captured.sourceId).toBe(true)
      expect(source?.accessedAt, captured.sourceId).toBe(TODAY)
      expect(source?.url, captured.sourceId).toBe(captured.officialUrl)
    }

    expect(r2AuditReceipt.summary).toEqual({
      expectedAssets: 20,
      localBytesVerified: 20,
      localBytesMissing: 0,
      evidenceValidatedAssets: 20,
      r2ObjectsProbed: 20,
      uploadAttempted: 19,
      objectsUploaded: 19,
      existingObjectsReused: 1,
      remoteReadbackVerified: 20,
      confirmedAssets: 20,
      quarantinedAssets: 0,
      contentChangedAndRekeyedAssets: 2,
    })
    expect(r2AuditReceipt.assets.filter((asset) => (
      asset.finalStatus === 'confirmed_private_r2_readback'
        && asset.readbackStatus === 'sha256_and_size_verified'
    ))).toHaveLength(20)
    expect(r2AuditReceipt.sanitization).toEqual({
      localAbsolutePathsIncluded: false,
      credentialsIncluded: false,
    })
    expect(r2AuditReceiptRaw).not.toMatch(/[A-Za-z]:[\\/]/u)
    expect(r2AuditReceiptRaw).not.toContain('"localPath"')
    expect(r2AuditReceiptRaw).not.toMatch(/CLOUDFLARE_API_TOKEN|Authorization|Bearer\s/u)
    const coveredProgramIds = ledger.programCoverage.flatMap((group) => group.programIds)
    expect(new Set(coveredProgramIds).size).toBe(37)
    expect([...coveredProgramIds].sort()).toEqual([...WAVE_PROGRAM_IDS].sort())
    expect(ledger.quarantine.some((item) => item.institutionId === 'uni-guangzhou-university')).toBe(true)
    expect(ledger.quarantine.some((item) => item.institutionId === 'uni-guangdong-pharmaceutical-university')).toBe(true)
    expect(ledger.publicationDecisions.join(' ')).toContain('previous-cycle')
  })
})

describe('Guangdong official depth wave 3 importer', () => {
  let tempDir = ''

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'studyinchina-guangdong-wave3-'))
    mkdirSync(tempDir, { recursive: true })
    for (const file of [
      'sources.json',
      'programs.json',
      'admission-cycles.json',
      'scholarships.json',
    ]) {
      copyFileSync(join(DATA_DIR, file), join(tempDir, file))
    }
  })

  afterAll(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  })

  it('is byte-for-byte idempotent across repeated runs', () => {
    const run = () => execFileSync(process.execPath, [IMPORTER], {
      cwd: ROOT,
      env: { ...process.env, STUDYINCHINA_DATA_DIR: tempDir },
      encoding: 'utf8',
    })
    const capture = () => Object.fromEntries([
      'sources.json',
      'programs.json',
      'admission-cycles.json',
      'scholarships.json',
    ].map((file) => [file, readFileSync(join(tempDir, file), 'utf8')]))

    const firstSummary = JSON.parse(run()) as { programsUpdated: number }
    const afterFirst = capture()
    const secondSummary = JSON.parse(run()) as { programsUpdated: number }
    const afterSecond = capture()

    expect(firstSummary.programsUpdated).toBe(37)
    expect(secondSummary.programsUpdated).toBe(37)
    expect(afterSecond).toEqual(afterFirst)
    expect(secondSummary).toMatchObject({
      dependencyGate: {
        programsBlocked: 0,
        cyclesBlocked: 0,
        scholarshipsBlocked: 0,
      },
    })
  })

  it('fails closed when every wave source loses confirmation', () => {
    const blockedLedger = JSON.parse(JSON.stringify(ledger)) as {
      sources: Array<{
        snapshotStatus: string
        snapshotAudit?: { confirmation: string }
      }>
    }
    for (const source of blockedLedger.sources) {
      source.snapshotStatus = 'quarantined_local_bytes_missing'
      source.snapshotAudit = { confirmation: 'quarantined' }
    }
    const blockedLedgerPath = join(tempDir, 'blocked-ledger.json')
    writeFileSync(blockedLedgerPath, JSON.stringify(blockedLedger), 'utf8')
    const summary = JSON.parse(execFileSync(process.execPath, [IMPORTER], {
      cwd: ROOT,
      env: {
        ...process.env,
        STUDYINCHINA_DATA_DIR: tempDir,
        STUDYINCHINA_GUANGDONG_LEDGER_PATH: blockedLedgerPath,
      },
      encoding: 'utf8',
    })) as { dependencyGate: Record<string, number> }
    expect(summary.dependencyGate).toMatchObject({
      programsBlocked: 37,
      cyclesBlocked: 37,
      scholarshipsBlocked: 2,
    })
    const blockedPrograms = JSON.parse(readFileSync(join(tempDir, 'programs.json'), 'utf8')) as Array<{ id: string; status: string }>
    for (const id of WAVE_PROGRAM_IDS) {
      expect(blockedPrograms.find((item) => item.id === id)?.status, id).toBe('stale')
    }
    const blockedCycles = JSON.parse(readFileSync(join(tempDir, 'admission-cycles.json'), 'utf8')) as Array<{ programId: string; status: string }>
    expect(blockedCycles.filter((cycle) => (
      WAVE_PROGRAM_ID_SET.has(cycle.programId) && cycle.status === 'verified'
    ))).toEqual([])
  })
})
