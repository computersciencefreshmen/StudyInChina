import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  cursorQueryFingerprint,
  InvalidCursorError,
} from '@/lib/catalog-api/cursor'
import { handleCatalogRequest, ok } from '@/lib/catalog-api/http'
import { CatalogApiService, releaseFromBundle } from '@/lib/catalog-api/service'
import type { DataBundle } from '@/lib/data/types'

const text = (en: string, zh = en, ru = en) => ({ en, zh, ru })

function fixture(): DataBundle {
  const source = {
    id: 'source-1',
    url: 'https://example.edu/admissions',
    title: 'Official admissions',
    publisher: 'Example University',
    kind: 'admissions' as const,
    language: 'en' as const,
    official: true,
    accessedAt: '2026-07-20',
  }
  const audit = {
    sourceIds: [source.id],
    verifiedAt: '2026-07-20',
    reviewAfter: '2027-07-20',
    status: 'verified' as const,
  }
  const city = {
    id: 'city-1',
    slug: 'example-city',
    name: text('Example City'),
    province: text('Example Province'),
    region: 'east' as const,
    coordinates: { lat: 31.2, lng: 121.5 },
    overview: text('City overview'),
    climate: text('Seasonal'),
    foodHighlights: [text('Local food')],
    sights: [text('Landmark')],
    ...audit,
  }
  const university = {
    id: 'uni-alpha',
    slug: 'alpha-university',
    name: text('Alpha University'),
    cityId: city.id,
    region: 'east' as const,
    officialUrl: 'https://example.edu',
    admissionsUrl: 'https://example.edu/admissions',
    summary: text('University overview'),
    featured: false,
    ...audit,
  }
  const program = {
    id: 'program-alpha',
    slug: 'alpha-program',
    universityId: university.id,
    name: text('Alpha Program'),
    degreeLevel: 'bachelor' as const,
    discipline: 'engineering' as const,
    teachingLanguages: ['English'],
    durationMonths: 48,
    programUrl: 'https://example.edu/programs/alpha',
    applyUrl: 'https://example.edu/apply',
    languageRequirements: [],
    ...audit,
  }
  const scholarship = {
    id: 'scholarship-alpha',
    slug: 'alpha-scholarship',
    name: text('Alpha Scholarship'),
    providerType: 'university' as const,
    universityIds: [university.id],
    programIds: [program.id],
    coverage: {
      tuition: 'full' as const,
      accommodation: 'unknown' as const,
      insurance: true,
      stipendCnyPerMonth: null,
    },
    deadline: '2027-05-01',
    applicationUrl: 'https://example.edu/scholarships/alpha',
    summary: text('Funding summary'),
    ...audit,
  }

  return {
    sources: [source],
    cities: [city],
    universities: [
      university,
      {
        ...university,
        id: 'uni-beta',
        slug: 'beta-university',
        name: text('Beta University'),
      },
    ],
    programs: [
      program,
      {
        ...program,
        id: 'program-beta',
        slug: 'beta-program',
        name: text('Beta Program'),
      },
      {
        ...program,
        id: 'program-gamma',
        slug: 'gamma-program',
        universityId: 'uni-beta',
        name: text('Gamma Program'),
        degreeLevel: 'master',
        teachingLanguages: ['Chinese'],
      },
    ],
    admissionCycles: [],
    scholarships: [
      {
        ...scholarship,
        programIds: ['program-alpha', 'program-beta'],
      },
      {
        ...scholarship,
        id: 'scholarship-beta',
        slug: 'beta-scholarship',
        name: text('Beta Scholarship'),
        universityIds: ['uni-beta'],
        programIds: ['program-gamma'],
      },
    ],
  }
}

function service() {
  const bundle = fixture()
  return new CatalogApiService(bundle, releaseFromBundle(bundle, '2026-07-20'), '2026-07-20')
}

describe('legacy catalog API cursor query binding', () => {
  it('uses a stable normalized query fingerprint without binding page size or cursor', () => {
    const first = cursorQueryFingerprint('programs', {
      q: '  PROGRAM  ',
      language: 'ENGLISH',
      scholarship: 'linked',
      limit: 1,
    })
    const second = cursorQueryFingerprint('programs', {
      scholarship: 'linked',
      language: 'english',
      q: 'program',
      limit: 100,
      cursor: 'ignored',
    })

    expect(first).toBe(second)
    expect(first).not.toBe(cursorQueryFingerprint('programs', {
      q: 'program',
      language: 'english',
    }))
    expect(first).not.toBe(cursorQueryFingerprint('scholarships', {
      q: 'program',
      language: 'english',
      scholarship: 'linked',
    }))
  })

  it('resumes the same normalized linked-scholarship query without skipping records', () => {
    const catalog = service()
    const first = catalog.listPrograms({
      q: 'PROGRAM',
      language: 'english',
      scholarship: 'linked',
      limit: 1,
    })

    expect(first.data.map((item) => item.id)).toEqual(['program-alpha'])
    expect(first.meta.nextCursor).toBeTruthy()

    const second = catalog.listPrograms({
      scholarship: 'linked',
      language: 'ENGLISH',
      q: 'program',
      limit: 100,
      cursor: first.meta.nextCursor ?? undefined,
    })
    expect(second.data.map((item) => item.id)).toEqual(['program-beta'])
    expect(second.meta.nextCursor).toBeNull()
  })

  it('rejects program cursors reused across filters or resource types', () => {
    const catalog = service()
    const cursor = catalog.listPrograms({
      q: 'program',
      language: 'english',
      scholarship: 'linked',
      limit: 1,
    }).meta.nextCursor

    expect(cursor).toBeTruthy()
    for (const changedQuery of [
      { q: 'program', language: 'english' },
      { q: 'program', language: 'english', scholarship: 'alpha-scholarship' },
      { q: 'program', language: 'english', scholarship: 'linked', degree: 'master' },
    ]) {
      expect(() => catalog.listPrograms({
        ...changedQuery,
        cursor: cursor ?? undefined,
      })).toThrow(InvalidCursorError)
    }

    expect(() => catalog.listScholarships({ cursor: cursor ?? undefined }))
      .toThrow(InvalidCursorError)
    expect(() => catalog.listInstitutions({ cursor: cursor ?? undefined }))
      .toThrow(InvalidCursorError)
  })

  it('binds scholarship and institution cursors to their own filters', () => {
    const catalog = service()
    const scholarshipCursor = catalog.listScholarships({
      provider: 'university',
      limit: 1,
    }).meta.nextCursor
    const institutionCursor = catalog.listInstitutions({
      region: 'east',
      sort: 'name',
      limit: 1,
    }).meta.nextCursor

    expect(scholarshipCursor).toBeTruthy()
    expect(institutionCursor).toBeTruthy()
    expect(() => catalog.listScholarships({
      provider: 'government',
      cursor: scholarshipCursor ?? undefined,
    })).toThrow(InvalidCursorError)
    expect(() => catalog.listInstitutions({
      region: 'east',
      sort: 'programs-desc',
      cursor: institutionCursor ?? undefined,
    })).toThrow(InvalidCursorError)
  })

  it('fails closed for legacy v1 cursors and maps filter mismatches to HTTP 400', async () => {
    const catalog = service()
    const legacyCursor = Buffer.from(JSON.stringify({
      v: 1,
      sortKey: 'alpha-program',
      id: 'program-alpha',
    }), 'utf8').toString('base64url')
    expect(() => catalog.listPrograms({ cursor: legacyCursor })).toThrow(InvalidCursorError)

    const cursor = catalog.listPrograms({
      scholarship: 'linked',
      language: 'english',
      limit: 1,
    }).meta.nextCursor
    const response = await handleCatalogRequest(() => ok(catalog.listPrograms({
      language: 'english',
      cursor: cursor ?? undefined,
    })))

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      error: { code: 'invalid_request', message: 'Invalid cursor' },
    })
  })
})
