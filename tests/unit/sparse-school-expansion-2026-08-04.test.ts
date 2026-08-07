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

const TODAY = '2026-08-04'
const packDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../quality/multiversity-expansion-wave-2026-08-04',
)
const packNames = [
  'north-specialty-sparse.json',
  'east-coast-sparse.json',
  'south-central-west-sparse.json',
]
const locales = ['en', 'zh', 'ru'] as const
const validFactStatuses = new Set([
  'known',
  'officially_not_announced',
  'not_applicable',
  'source_unavailable',
  'conflict',
  'stale',
])
const validRegions = new Set([
  'north',
  'northeast',
  'east',
  'south',
  'central',
  'southwest',
  'northwest',
])
const approvedHostedApplicationDomains = new Set([
  'jxnu.17gz.org',
  'njtech.17gz.org',
])

type Locale = typeof locales[number]
type LocalizedText = Partial<Record<Locale, string>>

type CandidateCycle = {
  applicationDeadline?: string | null
  displayAsOpen?: boolean
  intake?: string
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
}

type FactValue = {
  amount?: number | null
  status: string
  value?: string | null
}

type ProgramCandidate = CandidateBase & {
  duration: FactValue
  level: string
  programType: string
  teachingLanguage: FactValue
  tuition: FactValue
}

type ScholarshipCandidate = CandidateBase & {
  funding: {
    status: string
    tiers?: string[]
  }
  programCandidateIds?: string[]
}

type CandidateUniversity = {
  admissionsUrl: string
  cityId: string
  id: string
  name: LocalizedText
  officialUrl: string
  region: string
  slug: string
  sourceIds: string[]
  status: string
  summary: LocalizedText
  verifiedAt: string
}

type CandidateCity = {
  id: string
  name: LocalizedText
  province: LocalizedText
  slug: string
  sourceIds: string[]
  region: string
  status: string
  verifiedAt: string
}

type Pack = {
  cities?: CandidateCity[]
  programCandidates?: ProgramCandidate[]
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
const candidateProgramById = new Map<string, ProgramCandidate>()
for (const candidate of candidatePrograms) {
  for (const id of [candidate.candidateId, ...(candidate.candidateIds ?? [])]) {
    candidateProgramById.set(id, candidate)
  }
}

const data = bundleSchema.parse({ admissionCycles, cities, programs, scholarships, sources, universities })
const published = selectPublishedData(data, TODAY)

function parseHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function isOfficialUniversityHttps(value: string): boolean {
  const url = parseHttpsUrl(value)
  return url !== null && url.hostname.endsWith('.edu.cn')
}

function isOfficialApplicationHttps(value: string): boolean {
  const url = parseHttpsUrl(value)
  return url !== null && (
    url.hostname.endsWith('.edu.cn')
    || approvedHostedApplicationDomains.has(url.hostname)
  )
}

function hasPlaceholder(value: string): boolean {
  return /待翻译|翻译待补充|translation pending|перевод ожидается|\b(?:todo|tbd)\b|\?{2,}/i.test(value)
}

function normalizedIdentity(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function expectCompleteLocalizedText(value: LocalizedText, label: string): void {
  for (const locale of locales) {
    const text = value[locale]?.trim() ?? ''
    expect(text, `${label}:${locale}`).not.toBe('')
    expect(hasPlaceholder(text), `${label}:${locale}`).toBe(false)
  }
}

describe('sparse-school and regional university expansion on 2026-08-04', () => {
  it('locks the balanced candidate totals and unique identities across all three packs', () => {
    expect(candidatePrograms).toHaveLength(129)
    expect(candidateScholarships).toHaveLength(53)
    expect(candidateUniversities).toHaveLength(9)
    expect(new Set(allCandidates.map((candidate) => candidate.institutionSlug)).size).toBe(42)
    expect(new Set(allCandidates.map((candidate) => candidate.candidateId)).size)
      .toBe(allCandidates.length)

    const identityOwners = new Map<string, string>()
    for (const candidate of allCandidates) {
      for (const id of new Set([candidate.candidateId, ...(candidate.candidateIds ?? [])])) {
        const owner = identityOwners.get(id)
        expect(owner, `${id} is shared by ${owner} and ${candidate.candidateId}`)
          .toBeUndefined()
        identityOwners.set(id, candidate.candidateId)
      }
    }
  })

  it('keeps names and evidence trilingual, current and grounded in official HTTPS sources', () => {
    for (const candidate of allCandidates) {
      expectCompleteLocalizedText(candidate.name, `${candidate.candidateId}:name`)
      expectCompleteLocalizedText(candidate.evidence.summary ?? {}, `${candidate.candidateId}:summary`)
      expect(candidate.evidence.checkedAt, candidate.candidateId).toBe(TODAY)
      expect(isOfficialUniversityHttps(candidate.evidence.officialUrl), candidate.candidateId).toBe(true)
      for (const evidence of candidate.additionalEvidence ?? []) {
        expect(isOfficialUniversityHttps(evidence.officialUrl), candidate.candidateId).toBe(true)
      }
      if (candidate.applicationUrl) {
        expect(isOfficialApplicationHttps(candidate.applicationUrl), candidate.candidateId).toBe(true)
      }
    }
  })

  it('uses explicit fact states and never disguises unavailable facts as known values', () => {
    for (const program of candidatePrograms) {
      for (const [fieldName, fact] of [
        ['teachingLanguage', program.teachingLanguage],
        ['duration', program.duration],
        ['tuition', program.tuition],
      ] as const) {
        expect(validFactStatuses.has(fact.status), `${program.candidateId}:${fieldName}`).toBe(true)
        if (fact.status === 'known' && fieldName === 'tuition') {
          expect(fact.amount, `${program.candidateId}:${fieldName}`).toBeTypeOf('number')
          expect(fact.amount, `${program.candidateId}:${fieldName}`).toBeGreaterThan(0)
        } else if (fact.status === 'known') {
          expect(fact.value?.trim() ?? '', `${program.candidateId}:${fieldName}`).not.toBe('')
        } else if (fieldName === 'tuition') {
          expect(fact.amount, `${program.candidateId}:${fieldName}`).toBeNull()
        } else {
          expect(fact.value, `${program.candidateId}:${fieldName}`).toBeNull()
        }
      }
    }

    for (const scholarship of candidateScholarships) {
      expect(validFactStatuses.has(scholarship.funding.status), scholarship.candidateId).toBe(true)
      if (scholarship.funding.status === 'known') {
        expect(scholarship.funding.tiers?.length ?? 0, scholarship.candidateId).toBeGreaterThan(0)
      }
    }
  })

  it('keeps every scholarship-to-program reference inside the same verified institution', () => {
    for (const scholarship of candidateScholarships) {
      for (const programId of scholarship.programCandidateIds ?? []) {
        const program = candidateProgramById.get(programId)
        expect(program, `${scholarship.candidateId}:${programId}`).toBeDefined()
        expect(program?.institutionSlug, `${scholarship.candidateId}:${programId}`)
          .toBe(scholarship.institutionSlug)
      }
    }
  })

  it('publishes only the eight text-verified future cycles and never reopens expired dates', () => {
    const openCycles = allCandidates.flatMap((candidate) => (
      (candidate.cycles ?? [])
        .filter((cycle) => cycle.displayAsOpen)
        .map((cycle) => ({
          candidateId: candidate.candidateId,
          deadline: cycle.applicationDeadline,
        }))
    )).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    const expectedOpenCycles = [
      { candidateId: 'mew-scws-hainnu-iclt-scholarship-2026', deadline: '2026-10-31' },
      { candidateId: 'mve-ecs-ecupl-business-chinese-bachelor', deadline: '2026-09-30' },
      { candidateId: 'mve-ecs-ecupl-economic-investigation-bachelor', deadline: '2026-09-30' },
      { candidateId: 'mve-ecs-ecupl-politics-administration-bachelor', deadline: '2026-09-30' },
      { candidateId: 'prog-mew-nss-synu-four-week-chinese-study', deadline: '2026-09-15' },
      { candidateId: 'sch-mew-nss-dut-iclts', deadline: '2026-09-15' },
      { candidateId: 'sch-mew-nss-dut-iclts', deadline: '2026-10-31' },
      { candidateId: 'sch-mew-nss-synu-iclts', deadline: '2026-09-15' },
    ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))

    expect(openCycles).toEqual(expectedOpenCycles)
    for (const candidate of allCandidates) {
      for (const cycle of candidate.cycles ?? []) {
        if (cycle.displayAsOpen) {
          expect(cycle.statusAsOfCheckedAt, candidate.candidateId).toBe('open')
          expect(cycle.applicationDeadline, candidate.candidateId).not.toBeNull()
          expect((cycle.applicationDeadline ?? '') >= TODAY, candidate.candidateId)
            .toBe(true)
        }
        if (cycle.applicationDeadline && cycle.applicationDeadline < TODAY) {
          expect(cycle.displayAsOpen, candidate.candidateId).not.toBe(true)
        }
      }
    }

    const shenyangScholarship = candidateScholarships.find(
      (candidate) => candidate.candidateId === 'sch-mew-nss-synu-iclts',
    )
    expect(shenyangScholarship).toBeDefined()
    expect(shenyangScholarship?.cycles?.some(
      (cycle) => cycle.intake === 'spring' && cycle.displayAsOpen,
    )).toBe(false)
  })

  it('defines nine structurally complete regional universities and their required city links', () => {
    const expectedUniversitySlugs = [
      'guangxi-minzu-university',
      'hainan-normal-university',
      'henan-normal-university',
      'jiangxi-normal-university',
      'liaoning-normal-university',
      'nanjing-tech-university',
      'northwest-normal-university',
      'shenyang-normal-university',
      'xinjiang-normal-university',
    ]
    expect(candidateUniversities.map((university) => university.slug).sort())
      .toEqual(expectedUniversitySlugs)
    expect(new Set(candidateUniversities.map((university) => university.id)).size).toBe(9)
    expect(new Set(candidateUniversities.map((university) => university.slug)).size).toBe(9)

    const knownCityIds = new Set([
      ...cities.map((city) => city.id),
      ...candidateCities.map((city) => city.id),
    ])
    for (const university of candidateUniversities) {
      expect(university.id, university.slug).toBe(`uni-${university.slug}`)
      expect(university.status, university.slug).toBe('verified')
      expect(validRegions.has(university.region), university.slug).toBe(true)
      expect(university.verifiedAt, university.slug).toBe(TODAY)
      expect(university.sourceIds.length, university.slug).toBeGreaterThan(0)
      expect(knownCityIds.has(university.cityId), university.slug).toBe(true)
      expect(isOfficialUniversityHttps(university.officialUrl), university.slug).toBe(true)
      expect(isOfficialUniversityHttps(university.admissionsUrl), university.slug).toBe(true)
      expectCompleteLocalizedText(university.name, `${university.slug}:name`)
      expectCompleteLocalizedText(university.summary, `${university.slug}:summary`)
      expect(
        candidatePrograms.some((program) => program.institutionSlug === university.slug),
        university.slug,
      ).toBe(true)
    }

    expect(candidateCities).toHaveLength(1)
    expect(candidateCities[0]?.slug).toBe('xinxiang')
    expect(candidateCities[0]?.status).toBe('verified')
    expect(candidateCities[0]?.verifiedAt).toBe(TODAY)
    expect(validRegions.has(candidateCities[0]?.region ?? '')).toBe(true)
    expect(candidateCities[0]?.sourceIds.length ?? 0).toBeGreaterThan(0)
    expectCompleteLocalizedText(candidateCities[0]?.name ?? {}, 'xinxiang:name')
    expectCompleteLocalizedText(candidateCities[0]?.province ?? {}, 'xinxiang:province')
  })

  it('emits no same-school, same-level normalized candidate program identity twice', () => {
    for (const locale of ['en', 'zh'] as const) {
      const identities = candidatePrograms.map((program) => [
        program.institutionSlug,
        program.level,
        program.programType,
        normalizedIdentity(program.name[locale] ?? ''),
      ].join('|'))
      expect(new Set(identities).size, `${locale} semantic identities`)
        .toBe(candidatePrograms.length)
    }
  })


  it('materializes every candidate ID into exactly one formal record at the same institution', () => {
    const universityBySlug = new Map(
      data.universities.map((university) => [university.slug, university]),
    )

    for (const candidate of candidatePrograms) {
      const sourceId = `src-gap-program-${candidate.candidateId}`
      const materialized = data.programs.filter((program) => program.sourceIds.includes(sourceId))
      const university = universityBySlug.get(candidate.institutionSlug)
      expect(university, candidate.institutionSlug).toBeDefined()
      expect(materialized, candidate.candidateId).toHaveLength(1)
      expect(materialized[0]?.id, candidate.candidateId).not.toBe('')
      expect(materialized[0]?.universityId, candidate.candidateId).toBe(university?.id)
    }

    for (const candidate of candidateScholarships) {
      const sourceId = `src-gap-scholarship-${candidate.candidateId}`
      const materialized = data.scholarships.filter(
        (scholarship) => scholarship.sourceIds.includes(sourceId),
      )
      const university = universityBySlug.get(candidate.institutionSlug)
      expect(university, candidate.institutionSlug).toBeDefined()
      expect(materialized, candidate.candidateId).toHaveLength(1)
      expect(materialized[0]?.id, candidate.candidateId).not.toBe('')
      expect(materialized[0]?.universityIds, candidate.candidateId)
        .toContain(university?.id)
    }
  })
  it('preserves catalog identity floors and imports every new university with a program identity', () => {
    expect(data.universities.length).toBeGreaterThanOrEqual(263)
    expect(data.programs.length).toBeGreaterThanOrEqual(1_173)
    expect(data.scholarships.length).toBeGreaterThanOrEqual(358)

    const universityBySlug = new Map(
      data.universities.map((university) => [university.slug, university]),
    )
    const programCounts = new Map<string, number>()
    for (const program of data.programs) {
      programCounts.set(program.universityId, (programCounts.get(program.universityId) ?? 0) + 1)
    }
    expect(published.universities.every(
      (university) => (programCounts.get(university.id) ?? 0) >= 1,
    )).toBe(true)
    expect([...programCounts.values()].filter((count) => count >= 3).length)
      .toBeGreaterThanOrEqual(225)

    for (const candidateUniversity of candidateUniversities) {
      const university = universityBySlug.get(candidateUniversity.slug)
      expect(university, `${candidateUniversity.slug} was not imported`).toBeDefined()
      expect(programCounts.get(university?.id ?? '') ?? 0, candidateUniversity.slug)
        .toBeGreaterThanOrEqual(1)
    }
    expect(published.scholarships.every(
      (scholarship) => scholarship.status === 'verified' && scholarship.reviewAfter >= TODAY,
    )).toBe(true)
  })

  it('never leaves an overdue formal record marked as verified', () => {
    const formalRecords = [
      ...data.sources,
      ...data.cities,
      ...data.universities,
      ...data.programs,
      ...data.admissionCycles,
      ...data.scholarships,
    ]
    const overdueVerifiedRecords = formalRecords.filter(
      (record): record is (typeof formalRecords)[number] & { status: 'verified'; reviewAfter: string } => (
        'status' in record
        && record.status === 'verified'
        && record.reviewAfter < TODAY
      ),
    )

    expect(overdueVerifiedRecords.map((record) => ({
      id: record.id,
      reviewAfter: record.reviewAfter,
    }))).toEqual([])
  })

  it('keeps the current NJU Chinese Language Program details while quarantining its stale cycle', () => {
    const programId = 'program-nanjing-university-chinese-language-program-language'
    const program = data.programs.find((candidate) => candidate.id === programId)
    const publishedProgram = published.programs.find((candidate) => candidate.id === programId)
    const relatedCycles = data.admissionCycles.filter((cycle) => cycle.programId === programId)

    expect(program).toBeDefined()
    expect(program?.status).toBe('verified')
    expect((program?.reviewAfter ?? '') >= TODAY).toBe(true)
    expect(program?.verificationScope).toBe('complete')
    expect(program?.details).toBeDefined()
    expect(publishedProgram).toBeDefined()
    expect(publishedProgram?.status).toBe('verified')
    expect(publishedProgram?.verificationScope).toBe('complete')
    expect(publishedProgram?.details).toBeDefined()

    expect(relatedCycles.length).toBeGreaterThan(0)
    expect(relatedCycles.some((cycle) => cycle.status === 'verified')).toBe(false)
    expect(relatedCycles.every((cycle) => (
      cycle.reviewAfter < TODAY && cycle.status === 'stale'
    ))).toBe(true)
    expect(published.admissionCycles.some((cycle) => cycle.programId === programId))
      .toBe(false)
  })
})
