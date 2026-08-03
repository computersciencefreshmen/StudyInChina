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
import { classifyProgramField } from '../../src/lib/data/fields'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'

const TODAY = '2026-08-03'
const packDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../quality/multiversity-expansion-wave-2026-08-03',
)
const packNames = ['north-east.json', 'jiangzhehu.json', 'central-south-west.json']
const blockedEvidenceHosts = [
  'china-admissions.com',
  'cucas.cn',
  'mastersportal.com',
  'studyinchina.com',
]

type CandidateCycle = {
  applicationDeadline?: string | null
  displayAsOpen?: boolean
}

type Candidate = {
  candidateId: string
  candidateIds?: string[]
  institutionSlug: string
  name: Partial<Record<'en' | 'zh' | 'ru', string>>
  evidence: {
    checkedAt: string
    officialUrl: string
    summary?: Partial<Record<'en' | 'zh' | 'ru', string>>
  }
  additionalEvidence?: Array<{ officialUrl: string }>
  applicationUrl?: string | null
  cycles?: CandidateCycle[]
  programCandidateIds?: string[]
}

type Pack = {
  programCandidates?: Candidate[]
  scholarshipCandidates?: Candidate[]
}

const packs = packNames.map((fileName) => (
  JSON.parse(fs.readFileSync(path.join(packDirectory, fileName), 'utf8')) as Pack
))
const candidatePrograms = packs.flatMap((pack) => pack.programCandidates ?? [])
const candidateScholarships = packs.flatMap((pack) => pack.scholarshipCandidates ?? [])
const allCandidates = [...candidatePrograms, ...candidateScholarships]
const candidateProgramById = new Map<string, Candidate>()
for (const candidate of candidatePrograms) {
  for (const id of [candidate.candidateId, ...(candidate.candidateIds ?? [])]) {
    candidateProgramById.set(id, candidate)
  }
}

const data = bundleSchema.parse({ admissionCycles, cities, programs, scholarships, sources, universities })
const published = selectPublishedData(data, TODAY)

function isPermittedHttps(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && !blockedEvidenceHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}

function hasPlaceholder(value: string): boolean {
  return /待翻译|翻译待补充|translation pending|перевод ожидается|\?{2,}/i.test(value)
}

describe('verified multi-university expansion on 2026-08-03', () => {
  it('adds a balanced regional cohort instead of concentrating on one university', () => {
    expect(candidatePrograms).toHaveLength(114)
    expect(candidateScholarships).toHaveLength(44)
    expect(new Set(allCandidates.map((candidate) => candidate.institutionSlug)).size).toBe(33)
    expect(new Set(allCandidates.map((candidate) => candidate.candidateId)).size).toBe(allCandidates.length)
  })

  it('keeps every candidate trilingual and grounded in permitted official HTTPS evidence', () => {
    for (const candidate of allCandidates) {
      for (const locale of ['en', 'zh', 'ru'] as const) {
        const name = candidate.name[locale]?.trim() ?? ''
        const summary = candidate.evidence.summary?.[locale]?.trim() ?? ''
        expect(name, `${candidate.candidateId}:name:${locale}`).not.toBe('')
        expect(summary, `${candidate.candidateId}:summary:${locale}`).not.toBe('')
        expect(hasPlaceholder(name), `${candidate.candidateId}:name:${locale}`).toBe(false)
        expect(hasPlaceholder(summary), `${candidate.candidateId}:summary:${locale}`).toBe(false)
      }
      expect(candidate.evidence.checkedAt, candidate.candidateId).toBe(TODAY)
      expect(isPermittedHttps(candidate.evidence.officialUrl), candidate.candidateId).toBe(true)
      for (const evidence of candidate.additionalEvidence ?? []) {
        expect(isPermittedHttps(evidence.officialUrl), candidate.candidateId).toBe(true)
      }
      if (candidate.applicationUrl) {
        expect(isPermittedHttps(candidate.applicationUrl), candidate.candidateId).toBe(true)
      }
    }
  })

  it('keeps scholarship-to-program links inside the same verified institution', () => {
    for (const scholarship of candidateScholarships) {
      for (const programId of scholarship.programCandidateIds ?? []) {
        const program = candidateProgramById.get(programId)
        expect(program, `${scholarship.candidateId}:${programId}`).toBeDefined()
        expect(program?.institutionSlug, `${scholarship.candidateId}:${programId}`)
          .toBe(scholarship.institutionSlug)
      }
    }
  })

  it('never exposes an expired deadline as open and retains verified future routes', () => {
    const openCycles = allCandidates.flatMap((candidate) => (
      (candidate.cycles ?? [])
        .filter((cycle) => cycle.displayAsOpen)
        .map((cycle) => ({ candidateId: candidate.candidateId, deadline: cycle.applicationDeadline }))
    ))
    expect(openCycles.length).toBeGreaterThanOrEqual(12)
    for (const candidate of allCandidates) {
      for (const cycle of candidate.cycles ?? []) {
        if (!cycle.applicationDeadline || cycle.applicationDeadline >= TODAY) continue
        expect(cycle.displayAsOpen, candidate.candidateId).not.toBe(true)
      }
    }
    expect(openCycles).toEqual(expect.arrayContaining([
      { candidateId: 'mew-csw-ccnu-iclt-scholarship-2026', deadline: '2026-09-15' },
      { candidateId: 'mew-csw-ccnu-iclt-scholarship-2026', deadline: '2026-10-31' },
      { candidateId: 'mve-jzh-suda-iclt-scholarship', deadline: '2026-10-31' },
    ]))
  })

  it('quarantines catalog-level guesses and publishes a broad formal catalog', () => {
    const programIds = new Set(programs.map((program) => program.id))
    expect(programIds.has('prog-gap-prog-mew-ne-nefu-doctoral-programs')).toBe(false)
    expect(programIds.has('prog-gap-prog-mew-ne-sdjzu-chinese-taught-master-entry')).toBe(false)

    expect(published.universities.length).toBeGreaterThanOrEqual(245)
    expect(published.programs.length).toBeGreaterThanOrEqual(1_010)
    expect(published.scholarships.length).toBeGreaterThanOrEqual(275)

    const programCounts = new Map<string, number>()
    for (const program of published.programs) {
      programCounts.set(program.universityId, (programCounts.get(program.universityId) ?? 0) + 1)
    }
    expect(published.universities.every((university) => (programCounts.get(university.id) ?? 0) >= 1)).toBe(true)
    expect([...programCounts.values()].filter((count) => count >= 3).length).toBeGreaterThanOrEqual(185)
  })

  it('makes the expanded fields discoverable through applicant-facing filters', () => {
    const fieldCounts = new Map<string, number>()
    for (const program of published.programs) {
      const field = classifyProgramField(program)
      fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1)
    }
    expect(fieldCounts.get('chinese-language')).toBeGreaterThanOrEqual(300)
    expect(fieldCounts.get('computing-data')).toBeGreaterThanOrEqual(50)
    expect(fieldCounts.get('agriculture-veterinary')).toBeGreaterThanOrEqual(12)
    expect(fieldCounts.get('environment-earth')).toBeGreaterThanOrEqual(10)
  })
})
