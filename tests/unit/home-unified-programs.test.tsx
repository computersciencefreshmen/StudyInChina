import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connection } from 'next/server'
import HomePage, { dynamic } from '@/app/[locale]/page'
import { getCatalogData } from '@/lib/data/load'
import { getProgramFeedIndex } from '@/lib/program-feed'
import { parseProgramCatalogFilters } from '@/lib/program-catalog'
import { queryUnifiedProgramData } from '@/lib/unified-programs'
import { getHomeExperienceCopy } from '@/i18n/home-experience'
import type { DataBundle } from '@/lib/data/types'
import type { ThirdPartyProgram } from '@/lib/third-party-programs'

vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }))
vi.mock('@/lib/data/load', () => ({ getCatalogData: vi.fn() }))
vi.mock('@/lib/program-feed', () => ({ getProgramFeedIndex: vi.fn(), getProgramFeedRecord: vi.fn() }))
vi.mock('@/lib/data/freshness', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/data/freshness')>(), getTodayDate: () => '2026-11-17' }))
vi.mock('@/components/features/CityConstellation', () => ({ CityConstellation: () => <div /> }))
vi.mock('@/components/features/CraftHomeVisual', () => ({ CraftHomeVisual: ({ counts }: { counts: { programs: number } }) => <div data-testid="home-visual" data-program-count={counts.programs} /> }))

const audit = { status: 'verified' as const, verifiedAt: '2026-11-16', reviewAfter: '2027-11-17', sourceIds: ['official'] }
const data: DataBundle = {
  universities: [{ ...audit, id: 'alpha', slug: 'alpha', name: { en: 'Alpha University' }, cityId: 'city', region: null,
    officialUrl: 'https://alpha.edu.cn', admissionsUrl: null, summary: null, featured: true }],
  programs: [{ ...audit, id: 'reviewed', slug: 'reviewed', universityId: 'alpha', name: { en: 'Computer Science' }, degreeLevel: 'bachelor',
    discipline: 'engineering', teachingLanguages: ['English'], durationMonths: 48, programUrl: 'https://alpha.edu.cn/computing', applyUrl: null, languageRequirements: [] }],
  admissionCycles: [], scholarships: [], cities: [],
  sources: [{ id: 'official', url: 'https://alpha.edu.cn', title: 'Official evidence', publisher: 'Alpha University', kind: 'university', language: 'en', official: true, accessedAt: '2026-11-16' },
    { id: 'copied', url: 'https://alpha.cucas.cn', title: 'Copied source', publisher: 'CUCAS', kind: 'program', language: 'en', official: false, accessedAt: '2026-11-17' }],
}
function captured(id: string, name: string, status: ThirdPartyProgram['status'] = 'extracted'): ThirdPartyProgram {
  return { id, sourceId: id, provider: 'CUCAS', schoolId: 'cucas-alpha', schoolName: 'Alpha University', name,
    sourceUrl: `https://alpha.cucas.cn/program/${id}`, fetchedAt: '2026-11-17T00:00:00Z', status, official: false, admissionYear: null,
    fields: { degree: 'Bachelor', language: 'English', duration: '4 Years', tuition: 'RMB 20000', startDate: '2027-09-01', deadline: '2027-07-01' } }
}
const initial = [captured('captured-finance', 'Finance'), captured('duplicate-finance', 'Finance'), captured('captured-art', 'Painting'), captured('link-only', 'Bare URL', 'link_only')]
function feed(programs = initial) {
  return { programs, revision: 'remote-home-one', generatedAt: '2026-11-17T00:00:00Z', summary: { capturedCount: programs.filter(row => row.status === 'extracted').length, schoolCount: 1, sourceCount: programs.length } }
}
async function home() {
  const element = await HomePage({ params: Promise.resolve({ locale: 'en' }) })
  const document = new DOMParser().parseFromString(renderToStaticMarkup(element), 'text/html')
  return document
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getCatalogData).mockResolvedValue(data); vi.mocked(getProgramFeedIndex).mockResolvedValue(feed()) })

describe('homepage uses the live unified programme snapshot', () => {
  it('updates hero, ledger and every discipline count together while keeping official sources separate', async () => {
    const document = await home()
    const expected = queryUnifiedProgramData(data, initial, parseProgramCatalogFilters({}), '2026-11-17', 'remote-home-one').total
    expect(expected).toBe(3)
    expect(document.querySelector('[data-home-program-count]')?.getAttribute('data-home-program-count')).toBe(String(expected))
    expect(document.querySelector('[data-testid="home-visual"]')?.getAttribute('data-program-count')).toBe(String(expected))
    const fieldTotal = [...document.querySelectorAll('[data-field-program-count]')].reduce((total, node) => total + Number(node.getAttribute('data-field-program-count')), 0)
    expect(fieldTotal).toBe(expected)
    const official = [...document.querySelectorAll('dl dt')].find(node => node.textContent === getHomeExperienceCopy('en').officialSources)
    expect(official?.nextElementSibling?.textContent).toBe('1')
    expect(getProgramFeedIndex).toHaveBeenCalledTimes(1)
    expect(getCatalogData).toHaveBeenCalledTimes(1)
    expect(connection).toHaveBeenCalledTimes(1)
    expect(dynamic).toBe('force-dynamic')
  })

  it('previews actual reviewed and collected records with normal detail links and retained source attribution', async () => {
    const document = await home(), previews = document.querySelector('[data-testid="home-program-previews"]')!
    expect(previews.querySelectorAll('[data-program-preview]')).toHaveLength(3)
    expect(previews.querySelector('[data-source-status="source-collected"]')).not.toBeNull()
    expect(previews.querySelector('a[href="/en/programs/captured-finance"]')).not.toBeNull()
    expect(previews.querySelector('a[href="https://alpha.cucas.cn/program/captured-finance"]')).not.toBeNull()
    expect(previews.textContent).toContain('Source collected')
    expect(previews.textContent).not.toContain('Bare URL')
    expect(previews.querySelector('a[href="/en/programs/duplicate-finance"]')).toBeNull()
  })

  it('refreshes the homepage after cloud growth using a single snapshot and caps programme previews at six', async () => {
    const grown = [...initial, ...Array.from({ length: 9 }, (_, i) => captured(`new-${i}`, `New programme ${i}`))]
    vi.mocked(getProgramFeedIndex).mockResolvedValue(feed(grown))
    const document = await home()
    expect(document.querySelector('[data-home-program-count]')?.getAttribute('data-home-program-count')).toBe('12')
    expect(document.querySelectorAll('[data-testid="home-program-previews"] [data-program-preview]')).toHaveLength(6)
    expect(getProgramFeedIndex).toHaveBeenCalledTimes(1)
  })

  it('still publishes captured programmes when the reviewed programme subset is empty', async () => {
    vi.mocked(getCatalogData).mockResolvedValue({ ...data, programs: [] })
    const document = await home()
    expect(document.querySelector('[data-home-program-count]')?.getAttribute('data-home-program-count')).toBe('2')
    expect(document.querySelector('[data-testid="program-publication-note"]')).toBeNull()
    expect(document.querySelectorAll('[data-testid="home-program-previews"] [data-source-status="source-collected"]')).toHaveLength(2)
  })
})
