import { describe, expect, it, vi } from 'vitest'
import {
  CatalogRepositoryError,
  createD1CatalogRepository,
  createShadowCatalogRepository,
  parseCatalogReleaseInfo,
  type CatalogRepository,
} from '@/lib/catalog'
import { deploymentShaFromEnvironment } from '@/lib/catalog-api/runtime'
import type { CatalogProgramComparison } from '@/lib/catalog/d1-compare'

const publicCounts = {
  sources: 1,
  cities: 1,
  universities: 1,
  programs: 1,
  admissionCycles: 1,
  scholarships: 1,
}
const rawCounts = { ...publicCounts, programs: 2 }
const release = {
  id: 'release-2026-08-10',
  dataDate: '2026-08-10',
  generatedAt: '2026-08-10T01:00:00.000Z',
  recordCounts: publicCounts,
  rawCounts,
  publicCounts,
  dataCheckedThrough: '2026-08-09',
  evaluatedForDate: '2026-08-10',
  activatedAt: '2026-08-10T01:05:00.000Z',
  catalogBackend: 'd1',
  deploymentSha: null,
} as const

function meta(status: 'known' | 'officially_not_announced' = 'known') {
  return {
    status,
    officialUrl: 'https://admissions.example.edu.cn/program',
    sourceTitle: 'Official admissions page',
    checkedAt: '2026-08-09',
    verifiedAt: '2026-08-09',
    reviewAfter: '2026-09-08',
    sourceIds: ['src-program'],
  }
}

const normalizedComparison = {
  data: {
    items: [{
      program: {
        type: 'program',
        id: 'prog-safe-1',
        slug: 'safe-program',
        attributes: {
          name: { en: 'Safe Program', zh: '安全项目' },
          programType: 'degree',
          degreeLevel: 'master',
          credentialType: 'masters_degree',
          attendanceMode: 'full_time',
          deliveryMode: 'on_campus',
          duration: { minimum: 2, maximum: 2, unit: 'academic_years' },
          disciplineCodes: ['engineering'],
          teachingLanguageCodes: ['eng'],
          officialUrl: 'https://admissions.example.edu.cn/program',
          applyUrl: 'http://unsafe.example/apply',
        },
        relationships: {
          institution: { id: 'uni-safe', slug: 'safe-university', name: { en: 'Safe University' } },
        },
        sources: [{
          id: 'src-program',
          url: 'https://admissions.example.edu.cn/program',
          title: 'Official admissions page',
          publisher: 'Safe University',
          languageCode: 'en',
          authorityLevel: 'primary_official',
          checkedAt: '2026-08-09',
        }],
        fieldMeta: {
          name: meta(),
          officialUrl: meta(),
          applyUrl: meta(),
          institution: meta(),
          disciplineCodes: meta(),
          teachingLanguageCodes: meta(),
          'duration.minimum': meta(),
          'duration.maximum': meta(),
        },
      },
      currentCycle: {
        type: 'program_cycle',
        id: 'cycle-safe-1',
        slug: null,
        attributes: {
          academicYear: '2026-2027',
          intake: 'autumn',
          sequence: 1,
          cycleStatus: 'announced',
          startsOn: null,
          endsOn: null,
          application: {
            routeType: 'direct',
            accessMode: 'individual',
            applyUrl: 'http://unsafe.example/cycle-apply',
            opensOn: '2026-08-01',
            closesOn: '2026-10-01',
            rolling: false,
            state: 'open',
          },
          tuition: {
            amountMinimumMinor: 30_000_00,
            amountMaximumMinor: 30_000_00,
            currencyCode: 'CNY',
            currencyExponent: 2,
            period: 'academic_year',
          },
          applicationFee: {
            amountMinimumMinor: 800_00,
            amountMaximumMinor: 800_00,
            currencyCode: 'CNY',
            currencyExponent: 2,
            period: 'one_time',
          },
        },
        relationships: { program: { id: 'prog-safe-1', slug: 'safe-program' } },
        sources: [{
          id: 'src-cycle',
          url: 'https://admissions.example.edu.cn/cycle',
          title: 'Official cycle page',
          publisher: 'Safe University',
          languageCode: 'en',
          authorityLevel: 'primary_official',
          checkedAt: '2026-08-09',
        }],
        fieldMeta: {
          name: meta(),
          academicYear: meta(),
          intake: meta(),
          'application.opensOn': meta(),
          'application.closesOn': meta(),
          'application.state': meta(),
          tuition: meta(),
          applicationFee: meta(),
        },
      },
      linkedScholarshipCount: 2,
    }],
    missingIds: ['prog-missing-record'],
  },
  meta: {
    release,
    notice: 'Official-source automated catalog.',
  },
}

describe('D1 P0 release and compare contracts', () => {
  it('preserves extended Worker release truth while accepting legacy payloads', () => {
    expect(parseCatalogReleaseInfo(release)).toEqual(release)
    const legacy = parseCatalogReleaseInfo({
      id: release.id,
      dataDate: release.dataDate,
      generatedAt: release.generatedAt,
      recordCounts: publicCounts,
    })
    expect(legacy).toMatchObject({
      recordCounts: publicCounts,
      rawCounts: publicCounts,
      publicCounts,
      dataCheckedThrough: release.dataDate,
      evaluatedForDate: release.dataDate,
      activatedAt: release.generatedAt,
      catalogBackend: 'd1',
      deploymentSha: null,
    })
    expect(() => parseCatalogReleaseInfo({ ...release, deploymentSha: 'main' }))
      .toThrow(CatalogRepositoryError)
  })

  it('reads operational release metadata and comparisons from public Worker endpoints only', async () => {
    const calls: string[] = []
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      calls.push(`${url.pathname}${url.search}`)
      if (url.pathname === '/api/v1/releases/current') {
        return Response.json({ data: release, meta: { release, notice: 'notice' } })
      }
      if (url.pathname === '/api/v1/programs/compare') {
        return Response.json(normalizedComparison)
      }
      throw new Error(`Unexpected endpoint: ${url.pathname}`)
    })
    const repository = createD1CatalogRepository({
      apiUrl: 'https://catalog.example.test/internal/v1/catalog-bundle',
      apiToken: 'private-token',
      apiTokenHost: 'catalog.example.test',
      fetch: fetcher,
    })

    await expect(repository.getOperationalRelease?.()).resolves.toEqual(release)
    const comparison = await repository.comparePrograms?.([
      'prog-safe-1',
      'prog-missing-record',
    ]) as CatalogProgramComparison

    expect(calls).toEqual([
      '/api/v1/releases/current',
      '/api/v1/programs/compare?ids=prog-safe-1%2Cprog-missing-record',
    ])
    expect(calls.every((call) => !call.startsWith('/internal/'))).toBe(true)
    expect(comparison.data.items.map((item) => item.program.id)).toEqual(['prog-safe-1'])
    expect(comparison.data.missingIds).toEqual(['prog-missing-record'])
    expect(comparison.data.items[0]!.program.applyUrl).toBeNull()
    expect(comparison.data.items[0]!.currentCycle?.applicationState).toBe('open')
    expect(comparison.data.items[0]!.currentCycle?.tuitionCny).toBe(30_000)
    expect(comparison.data.items[0]!.linkedScholarshipCount).toBe(2)
    expect(comparison.meta.release.rawCounts.programs).toBe(2)
  })

  it('returns the primary lightweight projection in Shadow mode and records D1 parity only', async () => {
    const primaryGetBundle = vi.fn(async () => { throw new Error('primary bundle must not load') })
    const shadowGetBundle = vi.fn(async () => { throw new Error('shadow bundle must not load') })
    const primaryComparison = structuredClone(normalizedComparison)
    const shadowComparison = structuredClone(normalizedComparison)
    shadowComparison.data.items[0]!.linkedScholarshipCount = 3
    const primaryComparePrograms = vi.fn(async () => primaryComparison)
    const shadowComparePrograms = vi.fn(async () => shadowComparison)
    const onReport = vi.fn()
    const base = {
      getRelease: async () => release,
      listInstitutions: async () => { throw new Error('not used') },
      listPrograms: async () => { throw new Error('not used') },
      listScholarships: async () => { throw new Error('not used') },
    }
    const primary: CatalogRepository = {
      ...base,
      mode: 'json',
      getBundle: primaryGetBundle,
      comparePrograms: primaryComparePrograms,
    }
    const shadow: CatalogRepository = {
      ...base,
      mode: 'd1',
      getBundle: shadowGetBundle,
      comparePrograms: shadowComparePrograms,
    }
    const repository = createShadowCatalogRepository({
      primary,
      shadow,
      onReport,
      now: () => new Date('2026-08-10T08:00:00.000Z'),
    })

    await expect(repository.comparePrograms(['prog-safe-1'])).resolves.toBe(primaryComparison)
    expect(primaryComparePrograms).toHaveBeenCalledWith(['prog-safe-1'])
    expect(shadowComparePrograms).toHaveBeenCalledWith(['prog-safe-1'])
    expect(primaryGetBundle).not.toHaveBeenCalled()
    expect(shadowGetBundle).not.toHaveBeenCalled()
    expect(onReport).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'comparePrograms',
      checkedAt: '2026-08-10T08:00:00.000Z',
      status: 'different',
      matches: false,
      primaryMode: 'json',
      shadowMode: 'd1',
      summary: expect.objectContaining({ differenceCount: 1 }),
    }))
  })

  it('keeps the primary comparison available when the D1 shadow fails', async () => {
    const primaryComparison = structuredClone(normalizedComparison)
    const primary = {
      mode: 'json' as const,
      getBundle: async () => { throw new Error('not used') },
      getRelease: async () => release,
      comparePrograms: async () => primaryComparison,
      listInstitutions: async () => { throw new Error('not used') },
      listPrograms: async () => { throw new Error('not used') },
      listScholarships: async () => { throw new Error('not used') },
    }
    const shadow = {
      ...primary,
      mode: 'd1' as const,
      comparePrograms: async () => { throw new Error('D1 compare unavailable') },
    }
    const onReport = vi.fn()
    const repository = createShadowCatalogRepository({ primary, shadow, onReport })

    await expect(repository.comparePrograms(['prog-safe-1'])).resolves.toBe(primaryComparison)
    expect(onReport).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'comparePrograms',
      status: 'shadow-error',
      shadowError: { name: 'Error', message: 'D1 compare unavailable' },
    }))
  })

  it('accepts only an immutable 40-hex Vercel deployment SHA', () => {
    expect(deploymentShaFromEnvironment('a'.repeat(40))).toBe('a'.repeat(40))
    expect(deploymentShaFromEnvironment('A'.repeat(40))).toBeNull()
    expect(deploymentShaFromEnvironment('main')).toBeNull()
    expect(deploymentShaFromEnvironment(undefined)).toBeNull()
  })
})
