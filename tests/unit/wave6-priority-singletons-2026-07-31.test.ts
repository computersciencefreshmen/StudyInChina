import { describe, expect, it } from 'vitest'

import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import wave6 from '../../quality/official-gap-wave-2026-07-30/wave6-priority-singletons.json'
import { findSemanticProgramDuplicates } from '../../scripts/quality/check-program-coverage'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'

const TODAY = '2026-07-31'

const EXPECTED_COUNTS = new Map([
  ['university-of-chinese-academy-of-sciences', 4],
  ['capital-university-of-economics-and-business', 4],
  ['china-jiliang-university', 3],
  ['shanghai-university-of-international-business-and-economics', 4],
  ['northwest-university', 3],
  ['southern-medical-university', 3],
])

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
  cycles?: Array<{
    applicationDeadline?: string | null
    displayAsOpen?: boolean
  }>
}

type Wave6Pack = {
  programCandidates: Candidate[]
  scholarshipCandidates: Candidate[]
}

const data = bundleSchema.parse({
  admissionCycles,
  cities,
  programs,
  scholarships,
  sources,
  universities,
})
const published = selectPublishedData(data, TODAY)
const pack = wave6 as unknown as Wave6Pack
const allCandidates = [
  ...pack.programCandidates,
  ...pack.scholarshipCandidates,
]

function programId(candidateId: string): string {
  return `prog-gap-${candidateId}`
}

function scholarshipId(candidateId: string): string {
  return `sch-gap-${candidateId}`
}

function isOfficialHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}

describe('priority singleton coverage wave 6 on 2026-07-31', () => {
  it('raises six priority schools to three or four published programs', () => {
    expect(EXPECTED_COUNTS.size).toBe(6)

    for (const [slug, expectedCount] of EXPECTED_COUNTS) {
      const university = published.universities.find((item) => item.slug === slug)
      expect(university, slug).toBeDefined()
      expect(
        published.programs.filter((item) => item.universityId === university?.id),
        slug,
      ).toHaveLength(expectedCount)
    }
  })

  it('publishes all fifteen concrete program candidates', () => {
    expect(pack.programCandidates).toHaveLength(15)

    const publishedIds = new Set(published.programs.map((item) => item.id))
    for (const candidate of pack.programCandidates) {
      expect(
        publishedIds.has(programId(candidate.candidateId)),
        candidate.candidateId,
      ).toBe(true)
    }
  })

  it('keeps every Wave6 candidate trilingual and tied to official HTTPS evidence', () => {
    expect(allCandidates).toHaveLength(17)

    for (const candidate of allCandidates) {
      for (const locale of ['en', 'zh', 'ru'] as const) {
        expect(
          candidate.name[locale]?.trim(),
          `${candidate.candidateId}:${locale}`,
        ).toBeTruthy()
      }
      expect(
        isOfficialHttpsUrl(candidate.evidence.officialUrl),
        candidate.candidateId,
      ).toBe(true)
      expect(candidate.evidence.checkedAt, candidate.candidateId).toBe(TODAY)

      for (const evidence of candidate.additionalEvidence ?? []) {
        expect(
          isOfficialHttpsUrl(evidence.officialUrl),
          `${candidate.candidateId}:${evidence.officialUrl}`,
        ).toBe(true)
      }
    }
  })

  it('keeps expired 2026 cycles closed and strips them from public fee references', () => {
    const datedCandidates = allCandidates.filter((candidate) =>
      candidate.cycles?.some((cycle) => cycle.applicationDeadline))
    expect(datedCandidates).toHaveLength(4)

    for (const candidate of datedCandidates) {
      for (const cycle of candidate.cycles ?? []) {
        if (!cycle.applicationDeadline) continue
        expect(cycle.applicationDeadline <= TODAY).toBe(true)
        expect(cycle.displayAsOpen).not.toBe(true)
      }
    }

    for (const candidateId of [
      'wave6-ucas-biology-master',
      'wave6-ucas-computer-science-engineering-master',
      'wave6-ucas-environmental-science-engineering-master',
    ]) {
      const formalProgramId = programId(candidateId)
      const stored = data.admissionCycles.find(
        (cycle) => (
          cycle.programId === formalProgramId && cycle.id.includes('fee-reference')
        ),
      )
      expect(stored, candidateId).toBeDefined()
      expect(stored?.status, candidateId).toBe('stale')
      expect(stored?.tuitionCny, candidateId).toBe(30000)
      expect(stored?.opensOn, candidateId).toBeNull()
      expect(stored?.closesOn, candidateId).toBeNull()
      expect(stored?.dateStatus, candidateId).toBe('not-announced')
      expect(stored?.tuitionStatus, candidateId).toBe('reference')
      expect(published.admissionCycles.some(
        (cycle) => cycle.programId === formalProgramId,
      ), candidateId).toBe(false)
    }
  })

  it('preserves verified level, language, duration and discipline mappings', () => {
    const expected = new Map([
      ['wave6-ucas-biology-master', ['master', 'science', 36, ['English']]],
      [
        'wave6-cjlu-mechatronic-engineering-bachelor',
        ['bachelor', 'engineering', 48, ['English']],
      ],
      [
        'wave6-suibe-international-finance-master',
        ['master', 'business', 30, ['English']],
      ],
      [
        'wave6-nwu-archaeology-doctorate',
        ['doctorate', 'other', 36, ['Chinese', 'English']],
      ],
      [
        'wave6-smu-public-health-master',
        ['master', 'medicine', null, ['Chinese', 'English']],
      ],
    ])

    for (const [candidateId, values] of expected) {
      const program = published.programs.find((item) =>
        item.id === programId(candidateId))
      expect(program, candidateId).toBeDefined()
      expect(program?.degreeLevel, candidateId).toBe(values[0])
      expect(program?.discipline, candidateId).toBe(values[1])
      expect(program?.durationMonths, candidateId).toBe(values[2])
      expect(program?.teachingLanguages, candidateId).toEqual(values[3])
    }
  })

  it('adds the Guangzhou University and CUEB scholarships without fake program binding', () => {
    const expectedIds = [
      'wave6-gzhu-international-student-scholarship-2026',
      'wave6-cueb-new-foreign-student-scholarship',
    ]

    for (const candidateId of expectedIds) {
      const scholarship = published.scholarships.find((item) =>
        item.id === scholarshipId(candidateId))
      expect(scholarship, candidateId).toBeDefined()
      expect(scholarship?.providerType, candidateId).toBe('university')
      expect(scholarship?.programIds, candidateId).toEqual([])
    }
  })

  it('keeps the published catalog free of same-school semantic duplicates', () => {
    const publishedProgramIds = new Set(
      published.programs.map((program) => program.id),
    )

    expect(
      findSemanticProgramDuplicates(data.programs, publishedProgramIds),
    ).toEqual([])
  })
})
