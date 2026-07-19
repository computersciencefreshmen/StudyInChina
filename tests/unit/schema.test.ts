import { describe, expect, it } from 'vitest'
import { admissionCycleSchema, bundleSchema } from '@/lib/data/schema'

const audit = {
  sourceIds: ['source-1'],
  verifiedAt: '2026-07-01',
  reviewAfter: '2027-01-01',
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
      programUrl: 'https://example.edu.cn/programs/computer-science',
      applyUrl: 'https://example.edu.cn/apply',
      languageRequirements: [{ test: 'IELTS' as const, minimum: '6.0' }],
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

  it('rejects missing required English content', () => {
    const bundle = validBundle()
    bundle.universities[0].summary.en = ''

    expect(bundleSchema.safeParse(bundle).success).toBe(false)
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
