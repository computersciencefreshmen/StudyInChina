import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import { findSemanticProgramDuplicates } from '../../scripts/quality/check-program-coverage'
import { isWithinPostDeadlineGrace } from '../../src/lib/data/freshness'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'

const TODAY = '2026-08-02'
const CURRENT_PUBLICATION_DATE = '2026-08-10'
const packDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../quality/official-gap-wave-2026-08-02',
)

type Candidate = {
  candidateId: string
  name: Partial<Record<'en' | 'zh' | 'ru', string>>
  evidence: { checkedAt: string; officialUrl: string }
  additionalEvidence?: Array<{ officialUrl: string }>
  cycles?: Array<{ applicationDeadline?: string | null; displayAsOpen?: boolean }>
}

type Pack = {
  universities?: Array<{ id: string; slug: string }>
  programCandidates?: Candidate[]
  scholarshipCandidates?: Candidate[]
  exclusions?: unknown[]
}

const packs = fs.readdirSync(packDirectory)
  .filter((fileName) => fileName.startsWith('wave8-') && fileName.endsWith('.json'))
  .sort()
  .map((fileName) => JSON.parse(fs.readFileSync(path.join(packDirectory, fileName), 'utf8')) as Pack)

const data = bundleSchema.parse({ admissionCycles, cities, programs, scholarships, sources, universities })
const published = selectPublishedData(data, TODAY)
const programCandidates = packs.flatMap((pack) => pack.programCandidates ?? [])
const scholarshipCandidates = packs.flatMap((pack) => pack.scholarshipCandidates ?? [])
const allCandidates = [...programCandidates, ...scholarshipCandidates]

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

describe('official catalog expansion wave 8 on 2026-08-02', () => {
  it('ships a material expansion of verified programs and scholarships', () => {
    expect(programCandidates.length).toBeGreaterThanOrEqual(109)
    expect(scholarshipCandidates.length).toBeGreaterThanOrEqual(57)
    expect(published.universities.length).toBeGreaterThanOrEqual(247)
    expect(published.programs.length).toBeGreaterThanOrEqual(845)
  })

  it('materializes every non-duplicate candidate and safely redacts stale scholarship identities', () => {
    const programIds = new Set(data.programs.map((item) => item.id))
    const scholarshipById = new Map(data.scholarships.map((item) => [item.id, item]))
    const currentScholarshipById = new Map(
      selectPublishedData(data, CURRENT_PUBLICATION_DATE).scholarships.map((item) => [item.id, item]),
    )

    for (const candidate of programCandidates) {
      expect(programIds.has(`prog-gap-${candidate.candidateId}`), candidate.candidateId).toBe(true)
    }
    for (const candidate of scholarshipCandidates) {
      const scholarshipId = `sch-gap-${candidate.candidateId}`
      const scholarship = scholarshipById.get(scholarshipId)
      expect(scholarship, candidate.candidateId).toBeDefined()
      if (!scholarship) continue

      const publishedScholarship = currentScholarshipById.get(scholarshipId)
      if (!isWithinPostDeadlineGrace(scholarship.deadline, CURRENT_PUBLICATION_DATE)) {
        expect(publishedScholarship, candidate.candidateId).toBeUndefined()
        continue
      }

      expect(publishedScholarship, candidate.candidateId).toBeDefined()
      if (scholarship.status === 'stale' || scholarship.reviewAfter < CURRENT_PUBLICATION_DATE) {
        expect(publishedScholarship, candidate.candidateId).toMatchObject({
          status: 'stale',
          coverage: {
            tuition: 'unknown',
            accommodation: 'unknown',
            insurance: 'unknown',
            stipendCnyPerMonth: null,
          },
          deadline: null,
          applicationUrl: null,
          summary: null,
        })
        expect(publishedScholarship?.name, candidate.candidateId).toEqual(scholarship.name)
        expect(publishedScholarship?.sourceIds, candidate.candidateId).toEqual(scholarship.sourceIds)
      } else {
        expect(publishedScholarship?.status, candidate.candidateId).toBe('verified')
        expect(
          (publishedScholarship?.reviewAfter ?? '')
            .localeCompare(CURRENT_PUBLICATION_DATE) >= 0,
          candidate.candidateId,
        ).toBe(true)
      }
    }
  })

  it('keeps names trilingual and evidence on official HTTPS pages', () => {
    for (const candidate of allCandidates) {
      for (const locale of ['en', 'zh', 'ru'] as const) {
        expect(candidate.name[locale]?.trim(), `${candidate.candidateId}:${locale}`).toBeTruthy()
      }
      expect(candidate.evidence.checkedAt, candidate.candidateId).toBe(TODAY)
      expect(isHttps(candidate.evidence.officialUrl), candidate.candidateId).toBe(true)
      for (const evidence of candidate.additionalEvidence ?? []) {
        expect(isHttps(evidence.officialUrl), candidate.candidateId).toBe(true)
      }
    }
  })

  it('never exposes an expired deadline as open', () => {
    for (const candidate of allCandidates) {
      for (const cycle of candidate.cycles ?? []) {
        if (!cycle.applicationDeadline || cycle.applicationDeadline > TODAY) continue
        expect(cycle.displayAsOpen, candidate.candidateId).not.toBe(true)
      }
    }
  })

  it('adds every wave 8 university with at least two public programs', () => {
    for (const institution of packs.flatMap((pack) => pack.universities ?? [])) {
      const university = published.universities.find((item) => item.id === institution.id)
      expect(university, institution.slug).toBeDefined()
      expect(
        published.programs.filter((program) => program.universityId === institution.id).length,
        institution.slug,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it('reduces the public single-program tail to four or fewer institutions', () => {
    const counts = new Map<string, number>()
    for (const program of published.programs) {
      counts.set(program.universityId, (counts.get(program.universityId) ?? 0) + 1)
    }
    expect(published.universities.filter((university) => (counts.get(university.id) ?? 0) === 1).length)
      .toBeLessThanOrEqual(2)
  })

  it('keeps the published catalog free of semantic program duplicates', () => {
    const publishedProgramIds = new Set(published.programs.map((program) => program.id))
    expect(findSemanticProgramDuplicates(data.programs, publishedProgramIds)).toEqual([])
  })
})
