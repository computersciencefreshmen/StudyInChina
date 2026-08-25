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
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'

const TODAY = '2026-08-05'
const packPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../quality/multiversity-expansion-wave-2026-08-05/root-specialty-arts.json',
)
const locales = ['en', 'zh', 'ru'] as const

type LocalizedText = Partial<Record<typeof locales[number], string>>
type CandidateCycle = {
  applicationDeadline?: string | null
  displayAsOpen?: boolean
  statusAsOfCheckedAt?: string
}
type Candidate = {
  candidateId: string
  candidateIds?: string[]
  cycles?: CandidateCycle[]
  evidence: { checkedAt: string; officialUrl: string; summary: LocalizedText }
  institutionSlug: string
  name: LocalizedText
}
type ProgramCandidate = Candidate & {
  duration: { status: string; value: string | null }
  level: string
  programType: string
}
type ScholarshipCandidate = Candidate & { programCandidateIds?: string[] }
type CandidateUniversity = {
  admissionsUrl: string
  id: string
  name: LocalizedText
  officialUrl: string
  slug: string
  summary: LocalizedText
}
type Pack = {
  programCandidates: ProgramCandidate[]
  scholarshipCandidates: ScholarshipCandidate[]
  universities: CandidateUniversity[]
}

const pack = JSON.parse(fs.readFileSync(packPath, 'utf8')) as Pack
const candidates: Candidate[] = [...pack.programCandidates, ...pack.scholarshipCandidates]
const data = bundleSchema.parse({ admissionCycles, cities, programs, scholarships, sources, universities })
const published = selectPublishedData(data, TODAY)

function expectLocalized(value: LocalizedText, label: string): void {
  for (const locale of locales) {
    const text = value[locale]?.trim() ?? ''
    expect(text, `${label}:${locale}`).not.toBe('')
    expect(text, `${label}:${locale}`).not.toMatch(
      /待翻译|翻译待补充|translation pending|перевод ожидается|\b(?:todo|tbd)\b|\?{2,}/i,
    )
  }
}

describe('regional depth wave on 2026-08-05', () => {
  it('locks the reviewed Shanghai Theatre Academy candidate set', () => {
    expect(pack.universities).toHaveLength(1)
    expect(pack.universities[0]?.slug).toBe('shanghai-theatre-academy')
    expect(pack.programCandidates).toHaveLength(6)
    expect(pack.scholarshipCandidates).toHaveLength(1)
    expect(new Set(candidates.map((candidate) => candidate.candidateId)).size)
      .toBe(candidates.length)

    const intercultural = pack.programCandidates.find(
      (candidate) => candidate.candidateId === 'mve-root-sta-intercultural-communication-master',
    )
    expect(intercultural?.duration).toEqual({
      value: '2 years (maximum 4 years)',
      status: 'known',
    })
    expect(intercultural?.cycles).toEqual([
      expect.objectContaining({
        applicationDeadline: '2026-05-15',
        displayAsOpen: false,
        statusAsOfCheckedAt: 'closed',
      }),
    ])
  })

  it('keeps every published claim trilingual and grounded in official HTTPS evidence', () => {
    for (const university of pack.universities) {
      expectLocalized(university.name, `${university.slug}:name`)
      expectLocalized(university.summary, `${university.slug}:summary`)
      expect(university.id).toBe(`uni-${university.slug}`)
      expect(new URL(university.officialUrl).protocol).toBe('https:')
      expect(new URL(university.admissionsUrl).hostname).toMatch(/\.edu\.cn$/)
    }

    for (const candidate of candidates) {
      expectLocalized(candidate.name, `${candidate.candidateId}:name`)
      expectLocalized(candidate.evidence.summary, `${candidate.candidateId}:summary`)
      expect(candidate.evidence.checkedAt).toBe(TODAY)
      const evidenceUrl = new URL(candidate.evidence.officialUrl)
      expect(evidenceUrl.protocol).toBe('https:')
      expect(evidenceUrl.hostname).toMatch(/\.edu\.cn$/)
      for (const cycle of candidate.cycles ?? []) {
        if (cycle.applicationDeadline && cycle.applicationDeadline < TODAY) {
          expect(cycle.displayAsOpen, candidate.candidateId).toBe(false)
          expect(cycle.statusAsOfCheckedAt, candidate.candidateId).toBe('closed')
        }
      }
    }
    expect(candidates.flatMap((candidate) => candidate.cycles ?? []).some(
      (cycle) => cycle.displayAsOpen,
    )).toBe(false)
  })

  it('materializes every reviewed candidate exactly once at the same university', () => {
    const university = data.universities.find(
      (candidate) => candidate.slug === 'shanghai-theatre-academy',
    )
    expect(university).toBeDefined()

    for (const candidate of pack.programCandidates) {
      const materialized = data.programs.filter((program) => (
        program.sourceIds.includes(`src-gap-program-${candidate.candidateId}`)
      ))
      expect(materialized, candidate.candidateId).toHaveLength(1)
      expect(materialized[0]?.universityId, candidate.candidateId).toBe(university?.id)
    }
    for (const candidate of pack.scholarshipCandidates) {
      const materialized = data.scholarships.filter((scholarship) => (
        scholarship.sourceIds.includes(`src-gap-scholarship-${candidate.candidateId}`)
      ))
      expect(materialized, candidate.candidateId).toHaveLength(1)
      expect(materialized[0]?.universityIds, candidate.candidateId).toContain(university?.id)
    }
  })

  it('preserves catalog identity floors and leaves no university without a program identity', () => {
    expect(data.universities.length).toBeGreaterThanOrEqual(263)
    expect(data.programs.length).toBeGreaterThanOrEqual(1_173)
    expect(data.scholarships.length).toBeGreaterThanOrEqual(358)

    const programCounts = new Map<string, number>()
    for (const program of data.programs) {
      programCounts.set(program.universityId, (programCounts.get(program.universityId) ?? 0) + 1)
    }
    expect(published.universities.every(
      (university) => (programCounts.get(university.id) ?? 0) >= 1,
    )).toBe(true)
    const staleScholarships = published.scholarships.filter(
      (scholarship) => scholarship.status === 'stale',
    )
    expect(staleScholarships.length).toBeGreaterThan(0)
    for (const scholarship of published.scholarships) {
      if (scholarship.status === 'verified') {
        expect(
          (scholarship.reviewAfter ?? '').localeCompare(TODAY) >= 0,
          scholarship.id,
        ).toBe(true)
        continue
      }

      expect(scholarship.status, scholarship.id).toBe('stale')
      expect(scholarship.name.en, scholarship.id).toBeTruthy()
      expect(scholarship.sourceIds.length, scholarship.id).toBeGreaterThan(0)
      expect(scholarship.coverage, scholarship.id).toEqual({
        tuition: 'unknown',
        accommodation: 'unknown',
        insurance: 'unknown',
        stipendCnyPerMonth: null,
      })
      expect(scholarship.deadline, scholarship.id).toBeNull()
      expect(scholarship.applicationUrl, scholarship.id).toBeNull()
      expect(scholarship.summary, scholarship.id).toBeNull()
    }
  })
})
