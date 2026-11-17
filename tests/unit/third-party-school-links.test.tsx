import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({
  schools: [
    { id: 'sicas-alpha', name: 'ＡＬＰＨＡ - University', provider: 'SICAS', programCount: 8, extractedCount: 0 },
    { id: 'cucas-alpha', name: 'Alpha University', provider: 'CUCAS', programCount: 3, extractedCount: 2 },
    { id: 'cucas-alpha-medical', name: 'Alpha Medical University', provider: 'CUCAS', programCount: 5, extractedCount: 5 },
    { id: 'sicas-alpha-reordered', name: 'University Alpha', provider: 'SICAS', programCount: 4, extractedCount: 0 },
    { id: 'sicas-beta', name: 'Beta University', provider: 'SICAS', programCount: 0, extractedCount: 0 },
  ],
}))
vi.mock('@/lib/third-party-programs', () => ({ queryThirdPartyPrograms: () => ({ schools: fixtures.schools, items: [] }) }))
import { getThirdPartySchoolLinks, normalizeFullSchoolName } from '@/lib/third-party-school-links'
import { UniversityImportedPrograms } from '@/components/features/UniversityImportedPrograms'

describe('university links to imported programs', () => {
  it('normalizes full names without fuzzy, substring, acronym, or reordered-word matches', () => {
    expect(normalizeFullSchoolName('  ＡＬＰＨＡ -- University  ')).toBe('alpha university')
    expect(getThirdPartySchoolLinks('Alpha University').map(school => school.id)).toEqual(['sicas-alpha', 'cucas-alpha'])
    expect(getThirdPartySchoolLinks('Alpha')).toEqual([])
    expect(getThirdPartySchoolLinks('AU')).toEqual([])
    expect(getThirdPartySchoolLinks('')).toEqual([])
  })

  it('uses captured details when available and source links otherwise, excluding empty source directories', () => {
    expect(getThirdPartySchoolLinks('Alpha University').map(({ id, view }) => ({ id, view }))).toEqual([
      { id: 'sicas-alpha', view: 'links' },
      { id: 'cucas-alpha', view: 'extracted' },
    ])
    expect(getThirdPartySchoolLinks('Beta University')).toEqual([])
  })

  it('renders distinct source-labelled school links without changing the core university catalog', () => {
    render(<UniversityImportedPrograms englishSchoolName="Alpha University" locale="en" />)
    const sicas = screen.getByRole('link', { name: /SICAS/ })
    const cucas = screen.getByRole('link', { name: /CUCAS/ })
    expect(sicas).toHaveAttribute('href', '/en/programs/imported?school=sicas-alpha&provider=sicas&view=links')
    expect(cucas).toHaveAttribute('href', '/en/programs/imported?school=cucas-alpha&provider=cucas')
    expect(screen.getByText(/2 Captured details/)).toBeInTheDocument()
    expect(screen.getByText(/8 program links/)).toBeInTheDocument()
    expect(screen.getByText(/has not been checked against university websites/)).toBeInTheDocument()
  })

  it('renders no section for unmatched institutions', () => {
    const { container } = render(<UniversityImportedPrograms englishSchoolName="Unrelated University" locale="zh" />)
    expect(container).toBeEmptyDOMElement()
  })
})
