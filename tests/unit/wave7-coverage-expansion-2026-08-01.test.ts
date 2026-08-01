import { describe, expect, it } from 'vitest'

import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import northWest from '../../quality/official-gap-wave-2026-08-01/wave7-north-west.json'
import southEast from '../../quality/official-gap-wave-2026-08-01/wave7-south-east.json'
import special from '../../quality/official-gap-wave-2026-08-01/wave7-special-scholarships.json'
import { findSemanticProgramDuplicates } from '../../scripts/quality/check-program-coverage'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'

const TODAY = '2026-08-01'

type Candidate = {
  candidateId: string
  name: Partial<Record<'en' | 'zh' | 'ru', string>>
  evidence: { checkedAt: string; officialUrl: string }
  additionalEvidence?: Array<{ officialUrl: string }>
  cycles?: Array<{ applicationDeadline?: string | null; displayAsOpen?: boolean }>
}

type Pack = {
  programCandidates: Candidate[]
  scholarshipCandidates: Candidate[]
  exclusions?: unknown[]
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
const packs = [northWest, southEast, special] as unknown as Pack[]
const programCandidates = packs.flatMap((pack) => pack.programCandidates)
const scholarshipCandidates = packs.flatMap((pack) => pack.scholarshipCandidates)
const allCandidates = [...programCandidates, ...scholarshipCandidates]

const EXPECTED_PROGRAM_COUNTS = new Map([
  ['beijing-institute-of-petrochemical-technology', 4],
  ['inner-mongolia-normal-university', 4],
  ['hebei-university', 3],
  ['tianjin-university-of-finance-and-economics', 4],
  ['hangzhou-normal-university', 3],
  ['zhejiang-university-of-finance-and-economics', 4],
  ['zhejiang-af-university', 4],
  ['yunnan-university-of-finance-and-economics', 3],
  ['central-academy-of-fine-arts', 3],
  ['central-academy-of-drama', 2],
])

function isOfficialHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

describe('official coverage expansion wave 7 on 2026-08-01', () => {
  it('publishes all 24 verified program candidates and seven scholarships', () => {
    expect(programCandidates).toHaveLength(24)
    expect(scholarshipCandidates).toHaveLength(7)

    const programIds = new Set(published.programs.map((item) => item.id))
    const scholarshipIds = new Set(published.scholarships.map((item) => item.id))

    for (const candidate of programCandidates) {
      expect(
        programIds.has(`prog-gap-${candidate.candidateId}`),
        candidate.candidateId,
      ).toBe(true)
    }
    for (const candidate of scholarshipCandidates) {
      expect(
        scholarshipIds.has(`sch-gap-${candidate.candidateId}`),
        candidate.candidateId,
      ).toBe(true)
    }
  })

  it('keeps every published candidate trilingual and backed by official HTTPS evidence', () => {
    for (const candidate of allCandidates) {
      for (const locale of ['en', 'zh', 'ru'] as const) {
        expect(candidate.name[locale]?.trim(), `${candidate.candidateId}:${locale}`).toBeTruthy()
      }
      expect(isOfficialHttpsUrl(candidate.evidence.officialUrl), candidate.candidateId).toBe(true)
      expect(candidate.evidence.checkedAt, candidate.candidateId).toBe(TODAY)
      for (const evidence of candidate.additionalEvidence ?? []) {
        expect(isOfficialHttpsUrl(evidence.officialUrl), candidate.candidateId).toBe(true)
      }
    }
  })

  it('raises ten formerly shallow institutions to two through four programs', () => {
    for (const [slug, expectedCount] of EXPECTED_PROGRAM_COUNTS) {
      const university = published.universities.find((item) => item.slug === slug)
      expect(university, slug).toBeDefined()
      expect(
        published.programs.filter((item) => item.universityId === university?.id),
        slug,
      ).toHaveLength(expectedCount)
    }
  })

  it('never marks a deadline on or before the publication date as open', () => {
    for (const candidate of allCandidates) {
      for (const cycle of candidate.cycles ?? []) {
        if (!cycle.applicationDeadline || cycle.applicationDeadline > TODAY) continue
        expect(cycle.displayAsOpen, candidate.candidateId).not.toBe(true)
      }
    }
  })

  it('records exclusions instead of publishing weak homepage-only candidates', () => {
    expect(packs.reduce((sum, pack) => sum + (pack.exclusions?.length ?? 0), 0)).toBe(17)
  })

  it('keeps the published catalog free of same-school semantic duplicates', () => {
    const publishedProgramIds = new Set(published.programs.map((program) => program.id))
    expect(findSemanticProgramDuplicates(data.programs, publishedProgramIds)).toEqual([])
  })
})
