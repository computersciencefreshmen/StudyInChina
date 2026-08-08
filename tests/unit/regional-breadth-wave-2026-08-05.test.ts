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

const TODAY = '2026-08-08'
const CHECKED_AT = '2026-08-05'
const packDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../quality/multiversity-expansion-wave-2026-08-05',
)
const packNames = [
  'east-coast-medical-art.json',
  'north-northeast-west.json',
  'south-central-west.json',
]
const locales = ['en', 'zh', 'ru'] as const
const allowedApplicationHosts = new Set(['njfu.17gz.org'])

type LocalizedText = Partial<Record<typeof locales[number], string>>

type CandidateCycle = {
  applicationDeadline?: string | null
  displayAsOpen?: boolean
  statusAsOfCheckedAt?: string
}

type CandidateBase = {
  applicationUrl?: string | null
  candidateId: string
  candidateIds?: string[]
  cycles?: CandidateCycle[]
  evidence: {
    checkedAt: string
    officialUrl: string
    summary?: LocalizedText
  }
  additionalEvidence?: Array<{ officialUrl: string }>
  institutionSlug: string
  name: LocalizedText
  riskFlags?: string[]
}

type ScholarshipCandidate = CandidateBase & {
  programCandidateIds?: string[]
}

type CandidateUniversity = {
  admissionsUrl: string
  cityId: string
  id: string
  name: LocalizedText
  officialUrl: string
  slug: string
}

type CandidateCity = {
  id: string
  name: LocalizedText
  slug: string
}

type Pack = {
  cities?: CandidateCity[]
  programCandidates?: CandidateBase[]
  scholarshipCandidates?: ScholarshipCandidate[]
  universities?: CandidateUniversity[]
}

const packs = packNames.map((fileName) => (
  JSON.parse(fs.readFileSync(path.join(packDirectory, fileName), 'utf8')) as Pack
))
const candidatePrograms = packs.flatMap((pack) => pack.programCandidates ?? [])
const candidateScholarships = packs.flatMap((pack) => pack.scholarshipCandidates ?? [])
const candidateUniversities = packs.flatMap((pack) => pack.universities ?? [])
const candidateCities = packs.flatMap((pack) => pack.cities ?? [])
const allCandidates: CandidateBase[] = [...candidatePrograms, ...candidateScholarships]
const candidateProgramById = new Map<string, CandidateBase>()
for (const candidate of candidatePrograms) {
  for (const id of [candidate.candidateId, ...(candidate.candidateIds ?? [])]) {
    candidateProgramById.set(id, candidate)
  }
}

const data = bundleSchema.parse({ admissionCycles, cities, programs, scholarships, sources, universities })
const published = selectPublishedData(data, TODAY)

function isOfficialUniversityHttps(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.endsWith('.edu.cn')
  } catch {
    return false
  }
}

function isPermittedApplicationHttps(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (
      url.hostname.endsWith('.edu.cn') || allowedApplicationHosts.has(url.hostname)
    )
  } catch {
    return false
  }
}

function hasPlaceholder(value: string): boolean {
  return /\u5f85\u7ffb\u8bd1|\u7ffb\u8bd1\u5f85\u8865\u5145|translation pending|\u043f\u0435\u0440\u0435\u0432\u043e\u0434 \u043e\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044f|\b(?:todo|tbd)\b|\?{2,}/i.test(value)
}

function expectCompleteText(value: LocalizedText, label: string): void {
  for (const locale of locales) {
    const text = value[locale]?.trim() ?? ''
    expect(text, `${label}:${locale}`).not.toBe('')
    expect(hasPlaceholder(text), `${label}:${locale}`).toBe(false)
  }
}

describe('verified regional breadth expansion on 2026-08-05', () => {
  it('locks a balanced official expansion across three independently collected packs', () => {
    expect(candidatePrograms).toHaveLength(61)
    expect(candidateScholarships).toHaveLength(23)
    expect(candidateUniversities).toHaveLength(9)
    expect(candidateCities).toHaveLength(2)
    expect(new Set(allCandidates.map((candidate) => candidate.institutionSlug)).size).toBe(23)
    expect(new Set(allCandidates.map((candidate) => candidate.candidateId)).size)
      .toBe(allCandidates.length)
  })

  it('keeps every candidate trilingual and grounded in official university evidence', () => {
    for (const candidate of allCandidates) {
      expectCompleteText(candidate.name, `${candidate.candidateId}:name`)
      expectCompleteText(candidate.evidence.summary ?? {}, `${candidate.candidateId}:summary`)
      expect(candidate.evidence.checkedAt, candidate.candidateId).toBe(CHECKED_AT)
      expect(isOfficialUniversityHttps(candidate.evidence.officialUrl), candidate.candidateId)
        .toBe(true)
      for (const evidence of candidate.additionalEvidence ?? []) {
        expect(isOfficialUniversityHttps(evidence.officialUrl), candidate.candidateId)
          .toBe(true)
      }
      if (candidate.applicationUrl) {
        expect(isPermittedApplicationHttps(candidate.applicationUrl), candidate.candidateId)
          .toBe(true)
      }
    }
  })

  it('keeps scholarship-to-program links inside the same institution', () => {
    for (const scholarship of candidateScholarships) {
      for (const programId of scholarship.programCandidateIds ?? []) {
        const program = candidateProgramById.get(programId)
        expect(program, `${scholarship.candidateId}:${programId}`).toBeDefined()
        expect(program?.institutionSlug, `${scholarship.candidateId}:${programId}`)
          .toBe(scholarship.institutionSlug)
      }
    }
  })

  it('quarantines the two future routes because their only open path is group-only', () => {
    const openCycles = allCandidates.flatMap((candidate) => (
      (candidate.cycles ?? [])
        .filter((cycle) => cycle.displayAsOpen)
        .map((cycle) => ({
          candidateId: candidate.candidateId,
          deadline: cycle.applicationDeadline,
        }))
    )).sort((left, right) => left.candidateId.localeCompare(right.candidateId))

    expect(openCycles).toEqual([
      {
        candidateId: 'prog-mew-nnw-hebtu-four-week-chinese-study',
        deadline: '2026-09-15',
      },
      {
        candidateId: 'sch-mew-nnw-hebtu-international-chinese-language-teachers',
        deadline: '2026-09-15',
      },
    ])

    const groupProgramId = 'prog-gap-prog-mew-nnw-hebtu-four-week-chinese-study'
    expect(data.programs.some((program) => program.id === groupProgramId)).toBe(false)
    expect(data.admissionCycles.some((cycle) => cycle.programId === groupProgramId)).toBe(false)
    expect(
      data.programs.some(
        (program) => program.id === 'prog-gap-clw-sw-gdufs-chinese-four-week-december',
      ),
    ).toBe(false)

    const hebtuScholarship = data.scholarships.find(
      (scholarship) => (
        scholarship.id
          === 'sch-gap-sch-mew-nnw-hebtu-international-chinese-language-teachers'
      ),
    )
    expect(hebtuScholarship).toBeDefined()
    expect(hebtuScholarship?.deadline).toBeNull()
    expect(hebtuScholarship?.programIds).not.toContain(groupProgramId)
    expect(hebtuScholarship?.programIds).toHaveLength(3)

    for (const candidate of allCandidates) {
      for (const cycle of candidate.cycles ?? []) {
        if (cycle.displayAsOpen) {
          expect(cycle.statusAsOfCheckedAt, candidate.candidateId).toBe('open')
          expect((cycle.applicationDeadline ?? '') > TODAY, candidate.candidateId).toBe(true)
        }
        if (cycle.applicationDeadline && cycle.applicationDeadline <= TODAY) {
          expect(cycle.displayAsOpen, candidate.candidateId).not.toBe(true)
        }
      }
    }
  })

  it('materializes every individually applicable program and scholarship exactly once', () => {
    for (const candidate of candidatePrograms) {
      const materialized = data.programs.filter((program) => (
        program.sourceIds.includes(`src-gap-program-${candidate.candidateId}`)
      ))
      expect(materialized, candidate.candidateId).toHaveLength(
        candidate.riskFlags?.includes('group_application_only') ? 0 : 1,
      )
      expect(
        materialized.every((program) => program.status !== 'draft'),
        candidate.candidateId,
      ).toBe(true)
    }

    for (const candidate of candidateScholarships) {
      expect(
        data.scholarships.filter((scholarship) => (
          scholarship.sourceIds.includes(`src-gap-scholarship-${candidate.candidateId}`)
        )),
        candidate.candidateId,
      ).toHaveLength(1)
    }
  })

  it('withholds historical 2021 dynamic facts while retaining verified identities', () => {
    const historicalProgramIds = [
      'mew-0805-scw-gdou-marine-biology-master',
      'mew-0805-scw-gdou-aquaculture-doctorate',
      'mew-0805-scw-gdou-chinese-language-year',
    ]
    for (const candidateId of historicalProgramIds) {
      const programId = `prog-gap-${candidateId}`
      const program = data.programs.find((item) => item.id === programId)
      expect(program, candidateId).toBeDefined()
      expect(program?.verificationScope, candidateId).toBe('identity')
      expect(program?.teachingLanguages, candidateId).toEqual([])
      expect(program?.durationMonths, candidateId).toBeNull()
      expect(
        data.admissionCycles.filter((cycle) => cycle.programId === programId),
        candidateId,
      ).toEqual([])
    }

    const historicalScholarshipIds = [
      'mew-0805-scw-gdou-outstanding-new-students-scholarship',
      'mew-0805-scw-gdou-provincial-new-students-scholarship',
    ]
    for (const candidateId of historicalScholarshipIds) {
      const scholarship = data.scholarships.find(
        (item) => item.id === `sch-gap-${candidateId}`,
      )
      expect(scholarship, candidateId).toBeDefined()
      expect(scholarship?.deadline, candidateId).toBeNull()
      expect(scholarship?.coverage, candidateId).toEqual({
        tuition: 'unknown',
        accommodation: 'unknown',
        insurance: 'unknown',
        stipendCnyPerMonth: null,
      })
    }
  })

  it('raises the public breadth floor while preserving Tibet University as an explicit limited case', () => {
    expect(published.universities.length).toBeGreaterThanOrEqual(266)
    expect(published.programs.length).toBeGreaterThanOrEqual(1_211)
    expect(published.scholarships.length).toBeGreaterThanOrEqual(355)

    const counts = new Map<string, number>()
    for (const program of published.programs) {
      counts.set(program.universityId, (counts.get(program.universityId) ?? 0) + 1)
    }
    const bySlug = new Map(published.universities.map((university) => [university.slug, university]))
    for (const [slug, minimum] of new Map([
      ['guangxi-minzu-university', 3],
      ['liaoning-normal-university', 5],
      ['nanjing-agricultural-university', 4],
      ['northwest-university-of-political-science-and-law', 5],
    ])) {
      const university = bySlug.get(slug)
      expect(university, slug).toBeDefined()
      expect(counts.get(university?.id ?? ''), slug).toBeGreaterThanOrEqual(minimum)
    }

    for (const university of candidateUniversities) {
      const materialized = bySlug.get(university.slug)
      expect(materialized, university.slug).toBeDefined()
      expect(counts.get(materialized?.id ?? ''), university.slug).toBeGreaterThanOrEqual(3)
    }

    const tibet = bySlug.get('tibet-university')
    expect(tibet).toBeDefined()
    expect(counts.get(tibet?.id ?? '')).toBe(1)
  })
})
