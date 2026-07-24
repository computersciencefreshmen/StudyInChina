import { describe, expect, it } from 'vitest'
import { admissionCycleSchema, bundleSchema, programSchema } from '@/lib/data/schema'

const audit = {
  sourceIds: ['source-1'],
  verifiedAt: '2026-07-01',
  reviewAfter: '2026-08-01',
  status: 'verified' as const,
}

const localized = (en: string) => ({ en, zh: `ZH ${en}`, ru: `RU ${en}` })

function validBundle() {
  return {
    sources: [{
      id: 'source-1',
      url: 'https://example.edu.cn/programs/computer-science',
      title: 'Official program information',
      publisher: 'Example University',
      kind: 'program' as const,
      language: 'en' as const,
      official: true,
      accessedAt: '2026-07-01',
    }],
    cities: [{
      ...audit,
      id: 'city-1',
      slug: 'beijing',
      name: localized('Beijing'),
      province: localized('Beijing'),
      region: 'north' as const,
      coordinates: { lat: 39.9042, lng: 116.4074 },
      overview: localized('A capital city.'),
      climate: localized('Four distinct seasons.'),
      foodHighlights: [localized('Roast duck')],
      sights: [localized('Forbidden City')],
    }],
    universities: [{
      ...audit,
      id: 'university-1',
      slug: 'example-university',
      name: localized('Example University'),
      cityId: 'city-1',
      region: 'north' as const,
      officialUrl: 'https://example.edu.cn',
      admissionsUrl: 'https://example.edu.cn/admissions',
      summary: localized('An example institution.'),
      featured: true,
    }],
    programs: [{
      ...audit,
      id: 'program-1',
      slug: 'example-program',
      universityId: 'university-1',
      name: localized('Computer Science'),
      degreeLevel: 'bachelor' as const,
      discipline: 'engineering' as const,
      teachingLanguages: ['English'],
      durationMonths: 48,
      durationMonthsMax: 48,
      programUrl: 'https://example.edu.cn/programs/computer-science',
      applyUrl: 'https://example.edu.cn/apply',
      languageRequirements: [{ test: 'IELTS' as const, minimum: '6.0' }],
      details: {
        faculty: localized('School of Computing'),
        overview: localized('A source-backed computing program for international students.'),
        qualification: localized('Bachelor of Engineering'),
        studyMode: 'full-time' as const,
        languagePolicy: localized('The program is taught in English and requires IELTS 6.0 or equivalent.'),
        curriculumHighlights: [localized('Programming foundations'), localized('Algorithms and data structures')],
        eligibility: [localized('International applicants with a high-school diploma')],
        applicationMaterials: [localized('Passport copy'), localized('High-school transcript')],
        campus: localized('Main Campus'),
      },
    }],
    admissionCycles: [{
      ...audit,
      id: 'cycle-1',
      programId: 'program-1',
      academicYear: '2026-2027',
      intake: 'autumn' as const,
      opensOn: '2026-01-01',
      closesOn: '2026-05-31',
      dateStatus: 'published' as const,
      tuitionCny: 30000,
      tuitionPeriod: 'academic-year' as const,
      tuitionStatus: 'confirmed' as const,
      evidenceBasis: 'cycle-specific' as const,
      applicationFeeCny: 600,
    }],
    scholarships: [{
      ...audit,
      id: 'scholarship-1',
      slug: 'example-scholarship',
      name: localized('Example Scholarship'),
      providerType: 'university' as const,
      universityIds: ['university-1'],
      programIds: ['program-1'],
      coverage: {
        tuition: 'full' as const,
        accommodation: 'partial' as const,
        insurance: true,
        stipendCnyPerMonth: 2500,
      },
      deadline: '2026-04-30',
      applicationUrl: 'https://example.edu.cn/scholarships',
      summary: localized('Funding for international students.'),
    }],
  }
}

describe('content schemas', () => {
  it('accepts a complete, linked data bundle', () => {
    expect(bundleSchema.safeParse(validBundle()).success).toBe(true)
  })

  it('preserves doctorate as its own degree level', () => {
    const program = { ...validBundle().programs[0], degreeLevel: 'doctorate' }

    expect(programSchema.parse(program).degreeLevel).toBe('doctorate')
  })

  it('rejects a cycle whose closing date precedes its opening date', () => {
    const cycle = validBundle().admissionCycles[0]
    const result = admissionCycleSchema.safeParse({
      ...cycle,
      opensOn: '2026-06-01',
      closesOn: '2026-05-31',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('opensOn'))).toBe(true)
    }
  })

  it('rejects localized identity text with no official-language value', () => {
    const bundle = validBundle()
    ;(bundle.programs[0] as unknown as { name: unknown }).name = {}

    expect(bundleSchema.safeParse(bundle).success).toBe(false)
  })

  it('preserves an optional German translation through schema parsing', () => {
    const bundle = validBundle()
    const summary = bundle.universities[0].summary as {
      en: string
      zh: string
      ru: string
      de?: string
    }
    summary.de = 'Eine Beispieluniversität.'

    const result = bundleSchema.parse(bundle)

    expect(result.universities[0].summary?.de).toBe('Eine Beispieluniversität.')
  })

  it('accepts a verified identity-only record without fabricating admissions facts', () => {
    const bundle = validBundle()
    const identity = bundle.programs[0] as unknown as {
      name: unknown
      degreeLevel: string
      discipline: string
      teachingLanguages: string[]
      durationMonths: number | null
      durationMonthsMax: number | null
      applyUrl: string | null
      languageRequirements: unknown[]
      details?: unknown
    }
    identity.name = { zh: '\u5b98\u65b9\u9879\u76ee\u540d\u79f0' }
    identity.degreeLevel = 'other'
    identity.discipline = 'other'
    identity.teachingLanguages = []
    identity.durationMonths = null
    identity.durationMonthsMax = null
    identity.applyUrl = null
    identity.languageRequirements = []
    delete identity.details
    bundle.admissionCycles = []

    const result = bundleSchema.parse(bundle)

    expect(result.programs[0]).toMatchObject({
      teachingLanguages: [],
      durationMonths: null,
      applyUrl: null,
    })
  })

  it('rejects a verified program without a verified admission cycle', () => {
    const bundle = validBundle()
    ;(bundle.admissionCycles[0] as { status: 'verified' | 'draft' }).status = 'draft'

    const result = bundleSchema.safeParse(bundle)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('verified admission cycle'))).toBe(true)
    }
  })

  it('rejects a verified program without an explicit language policy result', () => {
    const bundle = validBundle()
    bundle.programs[0].languageRequirements = []

    const result = bundleSchema.safeParse(bundle)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('explicit language requirement'))).toBe(true)
    }
  })

  it('rejects published verified cycles whose fees were left as placeholders', () => {
    const bundle = validBundle()
    ;(bundle.admissionCycles[0] as { tuitionCny: number | null }).tuitionCny = null

    const result = bundleSchema.safeParse(bundle)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('tuition and application fee'))).toBe(true)
    }
  })

  it('accepts a verified deadline-only cycle without inventing an opening date', () => {
    const bundle = validBundle()
    ;(bundle.admissionCycles[0] as { opensOn: string | null }).opensOn = null

    expect(bundleSchema.safeParse(bundle).success).toBe(true)
  })

  it('rejects a verified dynamic record that can skip the monthly review', () => {
    const bundle = validBundle()
    bundle.programs[0].reviewAfter = '2026-09-01'

    const result = bundleSchema.safeParse(bundle)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('31-day review window'))).toBe(true)
    }
  })

  it('rejects duplicate ids and broken foreign keys', () => {
    const bundle = validBundle()
    bundle.programs.push({ ...bundle.programs[0] })
    bundle.programs[0].universityId = 'missing-university'

    const result = bundleSchema.safeParse(bundle)
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message)
      expect(messages).toContain('Duplicate program id: program-1')
      expect(messages).toContain('Unknown university missing-university on program-1')
    }
  })
})
