import { render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connection } from 'next/server'
import ProgramDetailPage, { generateMetadata as programMetadata } from '@/app/[locale]/programs/[slug]/page'
import UniversityDetailPage, { generateMetadata as universityMetadata } from '@/app/[locale]/universities/[slug]/page'
import ScholarshipDetailPage, { generateMetadata as scholarshipMetadata } from '@/app/[locale]/scholarships/[slug]/page'
import { getCatalogData } from '@/lib/data/load'
import * as freshness from '@/lib/data/freshness'
import type { DataBundle, ProgramDetails } from '@/lib/data/types'

vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }))
vi.mock('@/lib/data/load', () => ({ getCatalogData: vi.fn(), getData: vi.fn() }))

const audit = { status: 'verified' as const, verifiedAt: '2026-08-01', reviewAfter: '2026-09-01', sourceIds: ['profile-source'] }
const details: ProgramDetails = {
  faculty: { en: 'Engineering' }, overview: { en: 'Official program overview.' }, qualification: { en: 'Master' },
  studyMode: 'full-time', languagePolicy: { en: 'English teaching.' }, curriculumHighlights: [], eligibility: [], applicationMaterials: [],
}
function bundle(complete: boolean): DataBundle {
  return {
    sources: [
      { id: 'profile-source', url: 'https://example.edu/program', title: 'Program profile evidence', publisher: 'Example University', kind: 'program', language: 'en', official: true, accessedAt: '2026-08-02' },
      { id: 'cycle-source', url: 'https://example.edu/admissions', title: 'Cycle deadline evidence', publisher: 'Example University', kind: 'admissions', language: 'en', official: true, accessedAt: '2026-08-09' },
    ],
    cities: [],
    universities: [{ ...audit, id: 'university', slug: 'university', name: { en: 'Example University' }, cityId: 'city', region: null, officialUrl: 'https://example.edu', admissionsUrl: null, summary: null, featured: false }],
    programs: [{ ...audit, id: 'program', slug: 'program', universityId: 'university', name: { en: 'Engineering' }, degreeLevel: 'master', discipline: 'engineering', teachingLanguages: ['English'], durationMonths: complete ? 24 : null, programUrl: 'https://example.edu/program', applyUrl: 'https://example.edu/apply', languageRequirements: [], details: complete ? details : undefined }],
    admissionCycles: [{ ...audit, id: 'cycle', programId: 'program', academicYear: '2026-2027', intake: 'autumn', opensOn: '2026-08-01', closesOn: '2026-08-30', dateStatus: 'published', tuitionCny: 28000, tuitionPeriod: 'academic-year', tuitionStatus: 'reference', applicationFeeCny: 600, sourceIds: ['cycle-source'] }],
    scholarships: [{ ...audit, id: 'scholarship', slug: 'scholarship', name: { en: 'Merit scholarship' }, providerType: 'university', universityIds: ['university'], programIds: [], coverage: { tuition: 'full', accommodation: 'unknown', insurance: 'unknown', stipendCnyPerMonth: null }, deadline: '2026-08-30', applicationUrl: null, summary: null }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(connection).mockResolvedValue(undefined)
  vi.spyOn(freshness, 'getTodayDate').mockReturnValue('2026-08-10')
})
afterEach(() => { vi.restoreAllMocks() })

describe('program detail evidence and freshness', () => {
  it.each([
    ['program', ProgramDetailPage],
    ['university', UniversityDetailPage],
  ] as const)('keeps source names inside JSON-LD when rendering the %s page as HTML', async (slug, renderPage) => {
    const data = bundle(true)
    const sourceName = '</ScRiPt><script id="injected-source-script">void 0</script><img id="injected-source-image" src=x>'
    data.programs[0].name.en = sourceName
    data.universities[0].name.en = sourceName
    vi.mocked(getCatalogData).mockResolvedValue(data)

    // Parse server HTML, where raw script text is handled differently from a React DOM update.
    const markup = renderToStaticMarkup(await renderPage({ params: Promise.resolve({ locale: 'en', slug }) }))
    const document = new DOMParser().parseFromString(markup, 'text/html')
    const scripts = document.querySelectorAll('script')
    expect(scripts).toHaveLength(1)
    expect(scripts[0].getAttribute('type')).toBe('application/ld+json')
    expect(document.querySelector('#injected-source-script, #injected-source-image')).toBeNull()
    expect(JSON.parse(scripts[0].textContent ?? '').name).toBe(sourceName)
  })

  it.each([
    ['program page', 'program', ProgramDetailPage],
    ['university page', 'university', UniversityDetailPage],
    ['scholarship page', 'scholarship', ScholarshipDetailPage],
    ['program metadata', 'program', programMetadata],
    ['university metadata', 'university', universityMetadata],
    ['scholarship metadata', 'scholarship', scholarshipMetadata],
  ] as const)('waits for a real request before loading date-sensitive data in %s', async (_name, slug, renderPage) => {
    vi.mocked(getCatalogData).mockResolvedValue(bundle(true))
    let releaseRequest!: () => void
    vi.mocked(connection).mockImplementationOnce(() => new Promise<void>((resolve) => { releaseRequest = resolve }))
    const pending = renderPage({ params: Promise.resolve({ locale: 'en', slug }) })
    await Promise.resolve()
    expect(getCatalogData).not.toHaveBeenCalled()
    releaseRequest()
    await pending
    expect(getCatalogData).toHaveBeenCalledOnce()
  })

  it.each([false, true])('keeps cycle sources and separates source checks from record verification (complete: %s)', async (complete) => {
    vi.mocked(getCatalogData).mockResolvedValue(bundle(complete))
    const { container } = render(await ProgramDetailPage({ params: Promise.resolve({ locale: 'en', slug: 'program' }) }))
    expect(screen.getByRole('link', { name: 'Read official evidence' })).toHaveAttribute('href', '#official-evidence')
    expect(container.querySelector('#official-evidence')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cycle deadline evidence/ })).toBeVisible()
    expect(screen.queryByText(/28,000/)).not.toBeInTheDocument()
    const summary = screen.getByRole('heading', { name: 'Application snapshot' }).closest('section')!
    expect(summary).toHaveTextContent('Aug 1, 2026')
    expect(summary).not.toHaveTextContent('Aug 9, 2026')
    expect(screen.getByRole('region', { name: 'Evidence & freshness' })).toBeVisible()
  })
})
