import { describe, expect, it } from 'vitest'

import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import mergedJson from '../../quality/official-gap-wave-2026-07-30/merged-candidates.json'
import packJson from '../../quality/multiversity-expansion-wave-2026-08-08/sparse-depth-and-scholarships.json'
import { selectPublishedData } from '../../src/lib/data/publication'
import { classifyProgramField } from '../../src/lib/data/fields'
import { bundleSchema } from '../../src/lib/data/schema'

const TODAY = '2026-08-08'
const PROGRAM_SOURCE_PREFIX = 'src-gap-program-'
const SCHOLARSHIP_SOURCE_PREFIX = 'src-gap-scholarship-'
const officialEvidenceHosts = new Set([
  'en.wust.edu.cn',
  'eweb.ouc.edu.cn',
  'fao.gzhmu.edu.cn',
  'gjjl.ccmusic.edu.cn',
  'gjxy.gxu.edu.cn',
  'gjxy.kust.edu.cn',
  'ies-en.zuel.edu.cn',
  'infoadmin.sustech.edu.cn',
  'international.zzu.edu.cn',
  'intl.csu.edu.cn',
  'sie.ouc.edu.cn',
])

type LocalizedText = Partial<Record<'en' | 'zh' | 'ru', string>>
type Evidence = {
  checkedAt: string
  locator?: string
  officialUrl: string
  quote?: string
  summary?: LocalizedText
}
type Candidate = {
  additionalEvidence?: Array<{ officialUrl: string }>
  applicationUrl?: string | null
  applicationRouteStatus?: string
  candidateId: string
  cycles?: unknown[]
  evidence: Evidence
  institutionSlug: string
  name: LocalizedText
  recommendedAction?: string
  riskFlags?: string[]
}
type WavePack = {
  programCandidates: Candidate[]
  scholarshipCandidates: Candidate[]
}

const pack = packJson as unknown as WavePack
const merged = mergedJson as unknown as WavePack
const allCandidates = [...pack.programCandidates, ...pack.scholarshipCandidates]
const data = bundleSchema.parse({ admissionCycles, cities, programs, scholarships, sources, universities })
const published = selectPublishedData(data, TODAY)
const universityBySlug = new Map(data.universities.map((item) => [item.slug, item]))

function materializedProgram(candidateId: string) {
  return data.programs.filter((program) => (
    program.sourceIds.includes(`${PROGRAM_SOURCE_PREFIX}${candidateId}`)
  ))
}

function materializedScholarship(candidateId: string) {
  return data.scholarships.filter((scholarship) => (
    scholarship.sourceIds.includes(`${SCHOLARSHIP_SOURCE_PREFIX}${candidateId}`)
  ))
}

function expectLocalized(value: LocalizedText, label: string): void {
  for (const locale of ['en', 'zh', 'ru'] as const) {
    const text = value[locale]?.trim() ?? ''
    expect(text, `${label}:${locale}`).not.toBe('')
    expect(
      /待翻译|翻译待补充|translation pending|перевод ожидается|\b(?:todo|tbd)\b|\?{2,}/iu.test(text),
      `${label}:${locale}`,
    ).toBe(false)
  }
}

describe('evidence-first sparse-school depth wave on 2026-08-08', () => {
  it('locks 23 program and 3 scholarship candidates across the intended schools', () => {
    expect(pack.programCandidates).toHaveLength(23)
    expect(pack.scholarshipCandidates).toHaveLength(3)
    expect(new Set(allCandidates.map((candidate) => candidate.candidateId)).size).toBe(26)

    for (const candidate of pack.programCandidates) {
      expect(merged.programCandidates.find((item) => item.candidateId === candidate.candidateId))
        .toEqual(candidate)
    }
    for (const candidate of pack.scholarshipCandidates) {
      expect(merged.scholarshipCandidates.find((item) => item.candidateId === candidate.candidateId))
        .toEqual(candidate)
    }

    const programDistribution = Object.fromEntries(
      [...new Set(pack.programCandidates.map((candidate) => candidate.institutionSlug))]
        .sort()
        .map((slug) => [
          slug,
          pack.programCandidates.filter((candidate) => candidate.institutionSlug === slug).length,
        ]),
    )
    expect(programDistribution).toEqual({
      'central-south-university': 3,
      'china-conservatory-of-music': 3,
      'guangxi-university': 2,
      'kunming-university-of-science-and-technology': 3,
      'ocean-university-of-china': 3,
      'southern-university-of-science-and-technology': 3,
      'wuhan-university-of-science-and-technology': 1,
      'zhengzhou-university': 2,
      'zhongnan-university-of-economics-and-law': 3,
    })
    expect(
      [...new Set(pack.scholarshipCandidates.map((candidate) => candidate.institutionSlug))].sort(),
    ).toEqual([
      'central-south-university',
      'guangzhou-medical-university',
      'zhengzhou-university',
    ])
    expect(new Set(allCandidates.map((candidate) => candidate.institutionSlug)).size).toBe(10)
  })

  it('keeps every claim trilingual and grounded in allowlisted official evidence', () => {
    for (const candidate of allCandidates) {
      expectLocalized(candidate.name, `${candidate.candidateId}:name`)
      expectLocalized(candidate.evidence.summary ?? {}, `${candidate.candidateId}:summary`)
      expect(candidate.evidence.checkedAt, candidate.candidateId).toBe(TODAY)
      expect(candidate.evidence.locator?.trim(), candidate.candidateId).toBeTruthy()
      expect(candidate.evidence.quote?.trim(), candidate.candidateId).toBeTruthy()

      for (const url of [
        candidate.evidence.officialUrl,
        ...(candidate.additionalEvidence ?? []).map((item) => item.officialUrl),
      ]) {
        const parsed = new URL(url)
        expect(parsed.protocol, `${candidate.candidateId}:${url}`).toBe('https:')
        expect(officialEvidenceHosts.has(parsed.hostname), `${candidate.candidateId}:${url}`).toBe(true)
      }

      const evidenceText = `${candidate.evidence.locator} ${candidate.evidence.quote}`
      expect(
        /official program page identifies|program length:|official scholarship page identifies/iu.test(evidenceText),
        candidate.candidateId,
      ).toBe(false)
      expect(candidate.cycles ?? [], candidate.candidateId).toEqual([])
      expect(candidate.riskFlags ?? [], candidate.candidateId).not.toContain('group_application_only')
      if (pack.programCandidates.includes(candidate)) {
        expect(candidate.recommendedAction, candidate.candidateId)
          .toBe('publish_program_identity_without_open_cycle')
      }
    }
  })

  it('distinguishes real official application routes from home and overview pages', () => {
    for (const candidateId of [
      'sparse-depth-0808-gxu-chinese-language-student',
      'sparse-depth-0808-gxu-chinese-language-major-bachelor',
      'sparse-depth-0808-zzu-architecture-master',
      'sparse-depth-0808-zzu-medical-foundation',
      'sparse-depth-0808-wust-international-business-administration-bachelor',
    ]) {
      expect(
        pack.programCandidates.find((candidate) => candidate.candidateId === candidateId)?.applicationUrl,
        candidateId,
      ).toBeNull()
    }

    const expectedRoutes = new Map([
      ['central-south-university', 'https://csu.17gz.org/'],
      ['kunming-university-of-science-and-technology', 'https://gjxy.kust.edu.cn/info/1337/1718.htm'],
      ['ocean-university-of-china', 'https://ouc.at0086.cn/'],
      ['southern-university-of-science-and-technology', 'https://sustech.at0086.cn/'],
    ])
    for (const [slug, route] of expectedRoutes) {
      const candidates = pack.programCandidates.filter((candidate) => candidate.institutionSlug === slug)
      expect(candidates.length, slug).toBeGreaterThan(0)
      expect(candidates.every((candidate) => candidate.applicationUrl === route), slug).toBe(true)
    }

    expect(pack.scholarshipCandidates.every((candidate) => candidate.applicationUrl === null))
      .toBe(true)
    expect(pack.scholarshipCandidates.every((candidate) => candidate.applicationRouteStatus === 'not_confirmed'))
      .toBe(true)
  })

  it('materializes every candidate exactly once and raises nine sparse schools to depth', () => {
    for (const candidate of pack.programCandidates) {
      const records = materializedProgram(candidate.candidateId)
      expect(records, candidate.candidateId).toHaveLength(1)
      expect(records[0]?.universityId, candidate.candidateId)
        .toBe(universityBySlug.get(candidate.institutionSlug)?.id)
    }
    for (const candidate of pack.scholarshipCandidates) {
      const records = materializedScholarship(candidate.candidateId)
      expect(records, candidate.candidateId).toHaveLength(1)
      expect(records[0]?.universityIds, candidate.candidateId)
        .toContain(universityBySlug.get(candidate.institutionSlug)?.id)
    }

    const expectedPublishedDepth = new Map([
      ['central-south-university', 5],
      ['china-conservatory-of-music', 5],
      ['guangxi-university', 4],
      ['kunming-university-of-science-and-technology', 5],
      ['ocean-university-of-china', 5],
      ['southern-university-of-science-and-technology', 5],
      ['wuhan-university-of-science-and-technology', 3],
      ['zhengzhou-university', 4],
      ['zhongnan-university-of-economics-and-law', 5],
    ])
    for (const [slug, minimum] of expectedPublishedDepth) {
      const universityId = published.universities.find((item) => item.slug === slug)?.id
      expect(universityId, slug).toBeDefined()
      expect(
        published.programs.filter((program) => program.universityId === universityId).length,
        slug,
      ).toBeGreaterThanOrEqual(minimum)
    }

    const composition = materializedProgram(
      'sparse-depth-0808-ccmusic-composition-bachelor',
    )[0]
    expect(composition?.discipline).toBe('art-design')
    expect(composition && classifyProgramField(composition)).toBe('arts-design')

    const publicCounts = new Map<string, number>()
    for (const program of published.programs) {
      publicCounts.set(program.universityId, (publicCounts.get(program.universityId) ?? 0) + 1)
    }
    expect(published.universities.every((item) => (publicCounts.get(item.id) ?? 0) >= 1)).toBe(true)
    expect(published.universities.filter((item) => (publicCounts.get(item.id) ?? 0) < 3).length)
      .toBeLessThanOrEqual(8)
    expect(published.universities.length).toBeGreaterThanOrEqual(266)
    expect(data.programs.filter(
      (program) => program.status === 'verified' || program.status === 'stale',
    ).length).toBeGreaterThanOrEqual(1_234)
    expect(data.scholarships.filter(
      (scholarship) => scholarship.status === 'verified' || scholarship.status === 'stale',
    ).length).toBeGreaterThanOrEqual(358)
  })

  it('keeps all eleven fee references explicitly date-free and non-open', () => {
    const waveProgramIds = new Set(
      pack.programCandidates.flatMap((candidate) => (
        materializedProgram(candidate.candidateId).map((program) => program.id)
      )),
    )
    const waveCycles = data.admissionCycles.filter((cycle) => waveProgramIds.has(cycle.programId))
    expect(waveCycles).toHaveLength(11)
    for (const cycle of waveCycles) {
      expect(cycle.opensOn, cycle.id).toBeNull()
      expect(cycle.closesOn, cycle.id).toBeNull()
      expect(cycle.dateStatus, cycle.id).toBe('not-announced')
      expect(cycle.tuitionStatus, cycle.id).toBe('reference')
      expect(cycle.status, cycle.id).toBe('stale')
    }
    expect(JSON.stringify({ admissionCycles, programs, scholarships })).not.toMatch(/2026-06-31|June 31/iu)
  })

  it('publishes three date-free scholarships with the correct provider scope', () => {
    const providers = new Map([
      ['sparse-depth-0808-csu-university-scholarship', 'university'],
      ['sparse-depth-0808-gzhmu-guangdong-government-freshmen', 'province'],
      ['sparse-depth-0808-zzu-2026-master-full-scholarship', 'csc'],
    ])
    for (const [candidateId, providerType] of providers) {
      const scholarship = materializedScholarship(candidateId)[0]
      expect(scholarship, candidateId).toBeDefined()
      expect(scholarship?.status, candidateId).toBe('verified')
      expect(scholarship?.deadline, candidateId).toBeNull()
      expect(scholarship?.applicationUrl, candidateId).toBeNull()
      expect(scholarship?.providerType, candidateId).toBe(providerType)
      expect((scholarship?.reviewAfter ?? '') >= TODAY, candidateId).toBe(true)
    }
  })
})
