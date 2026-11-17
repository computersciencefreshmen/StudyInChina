import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ImportedProgramCard, importedProgramsHref } from '@/components/features/ImportedPrograms'
import type { ThirdPartyProgram } from '@/lib/third-party-programs'

const program: ThirdPartyProgram = {
  id: 'sicas-123', provider: 'sicas', sourceId: '123', schoolId: 'sicas-42', schoolName: 'Example University',
  name: 'Chinese language', sourceUrl: 'https://www.sicas.com.cn/School/42/Example/123/Chinese',
  status: 'link_only', official: false, admissionYear: null, fields: {},
}

describe('imported program presentation', () => {
  it('keeps URL-only discoveries out of local detail navigation and names the unknown intake', () => {
    render(<ImportedProgramCard program={program} locale="en" />)
    expect(screen.queryByRole('link', { name: /captured details/i })).not.toBeInTheDocument()
    expect(screen.getByText('Intake year unknown')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view source page/i })).toHaveAttribute('href', program.sourceUrl)
  })

  it('shows captured wording without inventing an annual tuition scope', () => {
    render(<ImportedProgramCard program={{ ...program, status: 'extracted', fields: { tuition: 'CNY 4,000 / 8 weeks', duration: '8 weeks' } }} locale="zh" />)
    expect(screen.getByText('CNY 4,000 / 8 weeks')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /查看已采集详情/ })).toHaveAttribute('href', '/zh/programs/imported/sicas-123')
    expect(screen.queryByText(/per year|每年/)).not.toBeInTheDocument()
  })

  it('preserves shareable filters across pages with safe query encoding', () => {
    const url = new URL(importedProgramsHref('en', { query: 'A & B', school: 'sicas-42', provider: 'sicas', view: 'links', page: 2 }), 'https://example.test')
    expect(url.searchParams.get('query')).toBe('A & B')
    expect(url.searchParams.get('school')).toBe('sicas-42')
    expect(url.searchParams.get('provider')).toBe('sicas')
    expect(url.searchParams.get('view')).toBe('links')
    expect(url.searchParams.get('page')).toBe('2')
  })
})
