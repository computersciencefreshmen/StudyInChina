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
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'

const TODAY = '2026-08-02'
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
const published = selectPublishedData(data, '2026-10-19')
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
  it('retains the material historical program and scholarship expansion', () => {
    expect(programCandidates.length).toBeGreaterThanOrEqual(109)
    expect(scholarshipCandidates.length).toBeGreaterThanOrEqual(57)
    expect(data.universities.length).toBeGreaterThanOrEqual(247)
    expect(data.programs.length).toBeGreaterThanOrEqual(845)
  })

  it('materializes every candidate while keeping expired scholarships out of the current catalog', () => {
    const programIds = new Set(data.programs.map(item => item.id))
    for (const candidate of programCandidates) {
      expect(programIds.has(`prog-gap-${candidate.candidateId}`), candidate.candidateId).toBe(true)
    }
    for (const candidate of scholarshipCandidates) {
      const id = `sch-gap-${candidate.candidateId}`
      const scholarship = data.scholarships.find(item => item.id === id)
      expect(scholarship, id).toBeDefined()
      expect(scholarship?.status, id).toBe('stale')
      expect(published.scholarships.some(item => item.id === id), id).toBe(false)
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

  it('retains every wave 8 university and its historical two-program inventory', () => {
    for (const institution of packs.flatMap((pack) => pack.universities ?? [])) {
      const university = data.universities.find((item) => item.id === institution.id)
      expect(university, institution.slug).toBeDefined()
      expect(
        data.programs.filter((program) => program.universityId === institution.id).length,
        institution.slug,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it('retains the historical inventory singleton bound without claiming present coverage', () => {
    const counts = new Map<string, number>()
    for (const program of data.programs) {
      counts.set(program.universityId, (counts.get(program.universityId) ?? 0) + 1)
    }
    expect(data.universities.filter((university) => (counts.get(university.id) ?? 0) === 1).length)
      .toBeLessThanOrEqual(2)
  })

  it('keeps this historical wave free of semantic program duplicates', () => {
    const cohortIds = new Set(programCandidates.map(candidate => `prog-gap-${candidate.candidateId}`))
    const cohortPrograms = data.programs.filter(program => cohortIds.has(program.id))
    expect(cohortPrograms.length).toBeGreaterThan(0)
    expect(findSemanticProgramDuplicates(cohortPrograms)).toEqual([])
  })
})
