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

const TODAY = '2026-08-02'
const packDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../quality/chinese-language-wave-2026-08-02',
)
const packNames = ['core-degree-pack.json', 'north-east.json', 'south-west.json']

type Candidate = {
  candidateId: string
  name: Partial<Record<'en' | 'zh' | 'ru', string>>
  evidence: { checkedAt: string; officialUrl: string }
  additionalEvidence?: Array<{ officialUrl: string }>
  cycles?: Array<{ applicationDeadline?: string | null; displayAsOpen?: boolean }>
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

const data = bundleSchema.parse({ admissionCycles, cities, programs, scholarships, sources, universities })
const published = selectPublishedData(data, TODAY)
const chinesePrograms = published.programs.filter((program) => (
  classifyProgramField(program) === 'chinese-language'
))

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

describe('Chinese-language degree and scholarship expansion on 2026-08-02', () => {
  it('adds a broad, degree-aware official-source cohort', () => {
    expect(candidatePrograms.length).toBeGreaterThanOrEqual(70)
    expect(candidateScholarships.length).toBeGreaterThanOrEqual(14)

    const counts = new Map<string, number>()
    for (const program of chinesePrograms) {
      counts.set(program.degreeLevel, (counts.get(program.degreeLevel) ?? 0) + 1)
    }
    expect(counts.get('bachelor')).toBeGreaterThanOrEqual(50)
    expect(counts.get('master')).toBeGreaterThanOrEqual(30)
    expect(counts.get('doctorate')).toBeGreaterThanOrEqual(6)
    expect(counts.get('language')).toBeGreaterThanOrEqual(130)
  })

  it('classifies Chinese composite degrees by their study subject and keeps one SCNU bachelor identity', () => {
    const chineseProgramIds = new Set(chinesePrograms.map((program) => program.id))
    for (const programId of [
      'prog-gap-chinese-degree-ecnu-business-chinese-bachelor',
      'prog-gap-chinese-degree-tju-chinese-cross-border-ecommerce-bachelor',
      'prog-gap-clw-sw-xmu-chinese-business-bachelor',
    ]) {
      expect(chineseProgramIds.has(programId), programId).toBe(true)
    }

    const scnu = published.universities.find((item) => item.slug === 'south-china-normal-university')
    expect(chinesePrograms.filter((program) => (
      program.universityId === scnu?.id
        && program.degreeLevel === 'bachelor'
        && /Chinese Language(?: \(Bachelor\))?$/i.test(program.name.en ?? '')
    ))).toHaveLength(1)
  })

  it('publishes the verified Guangzhou University master with its degree facts and scholarship link', () => {
    const university = published.universities.find((item) => item.slug === 'guangzhou-university')
    expect(university).toBeDefined()
    const program = chinesePrograms.find((item) => (
      item.universityId === university?.id
        && item.degreeLevel === 'master'
        && item.name.zh === '国际中文教育硕士'
    ))
    expect(program?.durationMonths).toBe(36)
    expect(program?.teachingLanguages).toEqual(expect.arrayContaining(['Chinese', 'English']))

    const scholarship = published.scholarships.find((item) => (
      item.id === 'sch-gap-clw-sw-gzhu-belt-road-scholarship'
    ))
    expect(scholarship?.universityIds).toContain(university?.id)
    expect(scholarship?.programIds).toContain(program?.id)
  })

  it('keeps every candidate trilingual and grounded in official HTTPS evidence', () => {
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

  it('never exposes an expired candidate deadline as open', () => {
    for (const candidate of allCandidates) {
      for (const cycle of candidate.cycles ?? []) {
        if (!cycle.applicationDeadline || cycle.applicationDeadline >= TODAY) continue
        expect(cycle.displayAsOpen, candidate.candidateId).not.toBe(true)
      }
    }
  })

  it('retains only the individually applicable future Chinese-study cycle', () => {
    const expectedProgramIds = new Set([
      'prog-gap-clw-sw-hainanu-chinese-culture-semester',
    ])
    const groupOnlyProgramId = 'prog-gap-clw-sw-gdufs-chinese-four-week-december'
    const futureCycles = published.admissionCycles.filter((cycle) => (
      expectedProgramIds.has(cycle.programId)
        && cycle.closesOn !== null
        && cycle.closesOn >= TODAY
    ))
    expect(new Set(futureCycles.map((cycle) => cycle.programId))).toEqual(expectedProgramIds)
    expect(published.programs.some((program) => program.id === groupOnlyProgramId)).toBe(false)
    expect(published.admissionCycles.some((cycle) => cycle.programId === groupOnlyProgramId)).toBe(false)
  })
})
