import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import beijing from '../../quality/official-gap-wave-2026-07-30/wave5-depth-beijing.json'
import eastSouth from '../../quality/official-gap-wave-2026-07-30/wave5-depth-east-south.json'
import west from '../../quality/official-gap-wave-2026-07-30/wave5-depth-west.json'
import mergedCandidates from '../../quality/official-gap-wave-2026-07-30/merged-candidates.json'
import { findSemanticProgramDuplicates } from '../../scripts/quality/check-program-coverage'
import {
  getApplicationState,
  selectAdmissionCycle,
} from '../../src/lib/data/admission'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle } from '../../src/lib/data/types'

const TODAY = '2026-07-31'

const REJECTED_CANDIDATE_IDS = [
  'wave5-depth-ucas-international-master-programs-2026',
  'wave5-depth-ucas-international-doctoral-programs-2026',
  'wave5-gzhu-international-master-degree',
  'wave5-gzhu-international-doctoral-degree',
] as const

const DEEPENED_TARGET_COUNTS = new Map([
  ['southwest-university', 4],
  ['shaanxi-normal-university', 4],
  ['guizhou-university', 4],
  ['xinjiang-university', 4],
  ['huaqiao-university', 4],
  ['ningbo-university', 3],
  ['fujian-normal-university', 4],
  ['capital-normal-university', 4],
  ['china-university-of-petroleum-beijing', 4],
  ['china-university-of-mining-and-technology-beijing', 4],
])

const REMAINING_TARGET_GAPS = new Map([
  ['guangzhou-university', 2],
])

type CandidateCycle = {
  academicYear?: string | null
  applicationDeadline?: string | null
  displayAsOpen?: boolean
  intake?: string | null
}

type Candidate = {
  candidateId: string
  name: Partial<Record<'en' | 'zh' | 'ru', string>>
  evidence: {
    checkedAt: string
    officialUrl: string
  }
  additionalEvidence?: Array<{
    officialUrl: string
  }>
  tuition?: {
    amount?: number | null
    status?: string
  }
  cycles?: CandidateCycle[]
}

type ScholarshipCandidate = Candidate & {
  programCandidateIds?: string[]
}

type Wave5Pack = {
  programCandidates: Candidate[]
  scholarshipCandidates: ScholarshipCandidate[]
}

type MergedCandidateFile = {
  programCandidates: Candidate[]
}

function loadDataBundle(): DataBundle {
  return bundleSchema.parse({
    admissionCycles,
    cities,
    programs,
    scholarships,
    sources,
    universities,
  })
}

function isTrilingual(value: Candidate['name']): boolean {
  return (['en', 'zh', 'ru'] as const).every((locale) =>
    Boolean(value[locale]?.trim()))
}

function isOfficialHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}

function formalProgramId(candidateId: string): string {
  return `prog-gap-${candidateId}`
}

function formalScholarshipId(candidateId: string): string {
  return `sch-gap-${candidateId}`
}

function normalizedAcademicYear(
  candidate: Candidate,
  cycle: CandidateCycle,
): string {
  if (cycle.academicYear && /^\d{4}-\d{4}$/.test(cycle.academicYear)) {
    return cycle.academicYear
  }
  const referenceDate = cycle.applicationDeadline ?? candidate.evidence.checkedAt
  const year = Number(referenceDate.slice(0, 4))
  return `${year}-${year + 1}`
}

function isMoreThanThirtyDaysBefore(date: string, today: string): boolean {
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  return (
    Date.parse(`${today}T00:00:00.000Z`)
    - Date.parse(`${date}T00:00:00.000Z`)
  ) / millisecondsPerDay > 30
}

const data = loadDataBundle()
const published = selectPublishedData(data, TODAY)
const wavePacks = [west, eastSouth, beijing] as unknown as Wave5Pack[]
const waveProgramCandidates = wavePacks.flatMap((pack) => pack.programCandidates)
const waveScholarshipCandidates = wavePacks.flatMap((pack) =>
  pack.scholarshipCandidates)
const allWaveCandidates: Candidate[] = [
  ...waveProgramCandidates,
  ...waveScholarshipCandidates,
]
const mergedProgramCandidates = (
  mergedCandidates as unknown as MergedCandidateFile
).programCandidates
const mergedProgramCandidateById = new Map(
  mergedProgramCandidates.map((candidate) => [candidate.candidateId, candidate]),
)

describe('official coverage wave 5 on 2026-07-31', () => {
  it('publishes ten safely deepened target schools at three to four programs', () => {
    expect(DEEPENED_TARGET_COUNTS.size).toBe(10)

    for (const [slug, count] of DEEPENED_TARGET_COUNTS) {
      expect(count, slug).toBeGreaterThanOrEqual(3)
      expect(count, slug).toBeLessThanOrEqual(4)
      const university = published.universities.find((item) => item.slug === slug)
      expect(university, slug).toBeDefined()
      expect(
        published.programs.filter((item) => item.universityId === university?.id),
        slug,
      ).toHaveLength(count)
    }
  })

  it('records Guangzhou University as the remaining Wave5 coverage gap', () => {
    expect([...REMAINING_TARGET_GAPS]).toEqual([
      ['guangzhou-university', 2],
        ])

    for (const [slug, count] of REMAINING_TARGET_GAPS) {
      const university = published.universities.find((item) => item.slug === slug)
      expect(university, slug).toBeDefined()
      expect(
        published.programs.filter((item) => item.universityId === university?.id),
        slug,
      ).toHaveLength(count)
    }
  })

  it('rejects all four portfolio-level master and doctoral placeholders', () => {
    const candidateIds = new Set(
      waveProgramCandidates.map((candidate) => candidate.candidateId),
    )
    const formalProgramIds = new Set(data.programs.map((program) => program.id))

    for (const candidateId of REJECTED_CANDIDATE_IDS) {
      expect(candidateIds.has(candidateId), candidateId).toBe(false)
      expect(formalProgramIds.has(formalProgramId(candidateId)), candidateId)
        .toBe(false)
    }
  })

  it('keeps every retained candidate trilingual with official HTTPS evidence', () => {
    expect(allWaveCandidates.length).toBeGreaterThan(0)

    for (const candidate of allWaveCandidates) {
      expect(isTrilingual(candidate.name), candidate.candidateId).toBe(true)
      expect(
        isOfficialHttpsUrl(candidate.evidence.officialUrl),
        `${candidate.candidateId}:${candidate.evidence.officialUrl}`,
      ).toBe(true)
      for (const evidence of candidate.additionalEvidence ?? []) {
        expect(
          isOfficialHttpsUrl(evidence.officialUrl),
          `${candidate.candidateId}:${evidence.officialUrl}`,
        ).toBe(true)
      }
    }
  })

  it('never presents a cycle due on or before the snapshot date as open', () => {
    const dueCycles = allWaveCandidates
      .flatMap((candidate) => candidate.cycles ?? [])
      .filter((cycle) =>
        cycle.applicationDeadline && cycle.applicationDeadline <= TODAY)

    expect(dueCycles.length).toBeGreaterThan(0)
    for (const cycle of dueCycles) {
      expect(cycle.displayAsOpen, cycle.applicationDeadline ?? undefined)
        .not.toBe(true)
    }
  })

  it('publishes all eighteen known fees only through non-open reference cycles', () => {
    const tuitionKnownCandidates = waveProgramCandidates.filter((candidate) =>
      candidate.tuition?.status === 'known'
      && candidate.tuition.amount !== null
      && candidate.tuition.amount !== undefined)

    expect(tuitionKnownCandidates).toHaveLength(18)

    for (const candidate of tuitionKnownCandidates) {
      const programId = formalProgramId(candidate.candidateId)
      expect(
        published.programs.some((program) => program.id === programId),
        candidate.candidateId,
      ).toBe(true)

      const selectedCycle = selectAdmissionCycle(
        published.admissionCycles,
        programId,
        TODAY,
      )
      expect(selectedCycle, candidate.candidateId).toBeDefined()
      expect(selectedCycle?.id, candidate.candidateId).toContain('fee-reference')
      expect(selectedCycle?.tuitionCny, candidate.candidateId).not.toBeNull()
      expect(selectedCycle?.opensOn, candidate.candidateId).toBeNull()
      expect(selectedCycle?.closesOn, candidate.candidateId).toBeNull()
      expect(
        ['open', 'rolling'],
        candidate.candidateId,
      ).not.toContain(getApplicationState(selectedCycle, TODAY))

      for (const cycle of candidate.cycles ?? []) {
        const deadline = cycle.applicationDeadline
        if (deadline && isMoreThanThirtyDaysBefore(deadline, TODAY)) {
          expect(selectedCycle?.closesOn, `${candidate.candidateId}:${deadline}`)
            .not.toBe(deadline)
        }
      }
    }
  })

  it('sanitizes every fee-reference cycle and removes superseded deadlines', () => {
    const feeReferenceCycles = data.admissionCycles.filter((cycle) =>
      cycle.id.includes('fee-reference'))
    let supersededDeadlineCount = 0

    expect(feeReferenceCycles.length).toBeGreaterThan(0)
    for (const cycle of feeReferenceCycles) {
      expect(cycle.opensOn, cycle.id).toBeNull()
      expect(cycle.closesOn, cycle.id).toBeNull()
      expect(cycle.dateStatus, cycle.id).toBe('not-announced')
      expect(cycle.tuitionCny, cycle.id).not.toBeNull()
      expect(cycle.tuitionStatus, cycle.id).toBe('reference')
      expect(cycle, cycle.id).not.toHaveProperty('notes')

      if (!cycle.programId.startsWith('prog-gap-')) continue

      const candidateId = cycle.programId.replace(/^prog-gap-/, '')
      const rawCandidate = mergedProgramCandidateById.get(candidateId)
      expect(rawCandidate, candidateId).toBeDefined()
      if (!rawCandidate) throw new Error(`Missing raw candidate: ${candidateId}`)

      const serializedCycle = JSON.stringify(cycle)
      for (const rawCycle of rawCandidate.cycles ?? []) {
        const deadline = rawCycle.applicationDeadline
        if (deadline && isMoreThanThirtyDaysBefore(deadline, TODAY)) {
          supersededDeadlineCount += 1
          expect(serializedCycle, `${cycle.id}:${deadline}`).not.toContain(deadline)
        }
      }
    }
    expect(supersededDeadlineCount).toBeGreaterThan(0)
  })

  it('keeps day-31 Wave5 and legacy tuition references in published data', () => {
    const candidateId = 'wave5-depth-cupb-chinese-language-one-year-2026'
    const candidate = waveProgramCandidates.find((item) =>
      item.candidateId === candidateId)
    expect(candidate, candidateId).toBeDefined()
    if (!candidate) throw new Error(`Missing Wave5 candidate: ${candidateId}`)

    const rawCycle = candidate.cycles?.find((cycle) =>
      cycle.applicationDeadline === '2026-06-30')
    expect(rawCycle, candidateId).toBeDefined()
    expect(candidate.evidence.checkedAt).toBe(TODAY)
    expect(
      (
        Date.parse(`${TODAY}T00:00:00.000Z`)
        - Date.parse(`${rawCycle?.applicationDeadline}T00:00:00.000Z`)
      ) / (24 * 60 * 60 * 1000),
    ).toBe(31)

    const selectedCycle = selectAdmissionCycle(
      published.admissionCycles,
      formalProgramId(candidateId),
      TODAY,
    )
    expect(selectedCycle, candidateId).toBeDefined()
    expect(selectedCycle?.id).toContain('fee-reference')
    expect(selectedCycle?.tuitionCny).toBe(21000)
    expect(selectedCycle?.tuitionStatus).toBe('reference')
    expect(selectedCycle?.opensOn).toBeNull()
    expect(selectedCycle?.closesOn).toBeNull()

    const legacy = published.admissionCycles.find((cycle) =>
      cycle.id === 'cycle-2026-sjtu-long-term-chinese-autumn-fee-reference')
    expect(legacy).toBeDefined()
    expect(legacy?.tuitionCny).toBe(10500)
    expect(legacy?.tuitionStatus).toBe('reference')
    expect(legacy?.opensOn).toBeNull()
    expect(legacy?.closesOn).toBeNull()
    expect(legacy).not.toHaveProperty('notes')
  })

  it('requires an explicit catalog date without a wall-clock fallback', () => {
    const importerSource = readFileSync(
      resolve(
        process.cwd(),
        'scripts/ingestion/apply-international-coverage-wave-2026-07-30.cjs',
      ),
      'utf8',
    )

    expect(importerSource).toMatch(
      /const CATALOG_AS_OF_DATE = isoDate\(\s*process\.env\.CATALOG_AS_OF_DATE,\s*'CATALOG_AS_OF_DATE'/,
    )
    expect(importerSource).not.toContain('new Date().toISOString()')
  })

  it('preserves the Wave5 level, discipline, and UCAS coverage semantics', () => {
    const cnuPreparatory = published.programs.find((program) =>
      program.id === formalProgramId('wave5-depth-cnu-preparatory-education'))
    expect(cnuPreparatory?.degreeLevel).toBe('foundation')

    const educationalTechnologyIds = [
      'wave5-west-swu-educational-technology-master-english',
      'wave5-west-snnu-educational-technology-doctorate-english',
    ]
    for (const candidateId of educationalTechnologyIds) {
      const program = published.programs.find((item) =>
        item.id === formalProgramId(candidateId))
      expect(program?.discipline, candidateId).toBe('humanities')
    }

    const ucas = published.scholarships.find((scholarship) =>
      scholarship.id
        === 'sch-gap-wave5-depth-ucas-international-student-scholarship-2026')
    expect(ucas).toBeDefined()
    expect(ucas?.providerType).toBe('university')
    expect(ucas?.programIds).toEqual([])
    expect(ucas?.coverage).toEqual({
      tuition: 'unknown',
      accommodation: 'unknown',
      insurance: 'unknown',
      stipendCnyPerMonth: null,
    })
  })

  it('preserves city and province ownership for local scholarships', () => {
    const expectedProviders = new Map([
      ['sch-szu-universiade-2026', 'city'],
      ['sch-ynnu-overseas-chinese-grant-2026', 'province'],
    ])

    for (const [candidateId, providerType] of expectedProviders) {
      const scholarship = data.scholarships.find((item) =>
        item.id === formalScholarshipId(candidateId))
      expect(scholarship, candidateId).toBeDefined()
      expect(scholarship?.providerType, candidateId).toBe(providerType)
    }
  })

  it('preserves explicit autumn and never infers spring from ambiguous raw intakes', () => {
    const allWaveCycles = allWaveCandidates.flatMap((candidate) =>
      candidate.cycles ?? [])
    expect(allWaveCycles).toHaveLength(22)
    expect(allWaveCycles.every((cycle) => cycle.intake === 'autumn')).toBe(true)

    const explicitAutumnCycles = waveProgramCandidates.flatMap((candidate) =>
      (candidate.cycles ?? [])
        .filter((cycle) => cycle.intake === 'autumn')
        .map((cycle) => ({ candidate, cycle })))

    expect(explicitAutumnCycles).toHaveLength(18)
    for (const { candidate, cycle } of explicitAutumnCycles) {
      const formalCycle = data.admissionCycles.find((item) =>
        item.programId === formalProgramId(candidate.candidateId)
        && item.academicYear === cycle.academicYear)
      expect(formalCycle, candidate.candidateId).toBeDefined()
      expect(formalCycle?.intake, candidate.candidateId).toBe('autumn')
    }

    const ambiguousIntakeCycles = mergedProgramCandidates.flatMap((candidate) =>
      (candidate.cycles ?? [])
        .filter((cycle) =>
          ['unknown', 'other'].includes(String(cycle.intake ?? '').toLowerCase()))
        .map((cycle) => ({ candidate, cycle })))
    expect(ambiguousIntakeCycles.length).toBeGreaterThan(0)
    expect(ambiguousIntakeCycles.some(({ cycle }) =>
      cycle.applicationDeadline === '2026-07-04')).toBe(true)
    expect(ambiguousIntakeCycles.some(({ cycle }) =>
      cycle.applicationDeadline === '2026-06-30')).toBe(true)

    for (const { candidate, cycle } of ambiguousIntakeCycles) {
      const academicYear = normalizedAcademicYear(candidate, cycle)
      const formalCycles = data.admissionCycles.filter((item) =>
        item.programId === formalProgramId(candidate.candidateId)
        && item.academicYear === academicYear
        && item.intake === 'other')
      const deadline = cycle.applicationDeadline
      const preservesAmbiguousIntake = deadline === null || deadline === undefined
        ? formalCycles.length > 0
        : formalCycles.some((item) =>
            item.closesOn === deadline
            || (
              isMoreThanThirtyDaysBefore(deadline, TODAY)
              && item.id.includes('fee-reference')
              && item.closesOn === null
            ))
      expect(
        preservesAmbiguousIntake,
        `${candidate.candidateId}:${deadline ?? 'no-deadline'}`,
      ).toBe(true)
    }

    const artificialIntelligence = published.programs.find((program) =>
      program.id
        === formalProgramId('wave5-depth-cumtb-artificial-intelligence-bachelor'))
    expect(artificialIntelligence?.discipline).toBe('engineering')
  })

  it('binds scholarships only to retained program candidates or to none', () => {
    const programCandidateIds = new Set(
      waveProgramCandidates.map((candidate) => candidate.candidateId),
    )

    for (const scholarship of waveScholarshipCandidates) {
      for (const programCandidateId of scholarship.programCandidateIds ?? []) {
        expect(
          programCandidateIds.has(programCandidateId),
          `${scholarship.candidateId}:${programCandidateId}`,
        ).toBe(true)
      }
    }

    const ucas = waveScholarshipCandidates.find((candidate) =>
      candidate.candidateId
        === 'wave5-depth-ucas-international-student-scholarship-2026')
    expect(ucas?.programCandidateIds).toEqual([])
  })

  it('keeps the formal catalog free of same-school semantic duplicates', () => {
    const publishedProgramIds = new Set(
      published.programs.map((program) => program.id),
    )

    expect(
      findSemanticProgramDuplicates(data.programs, publishedProgramIds),
    ).toEqual([])
  })
})
