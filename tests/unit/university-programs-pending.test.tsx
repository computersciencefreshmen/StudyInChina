import { render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UniversityProgramsPending } from '@/components/features/UniversityProgramsPending'
import { publicLocales } from '@/i18n/config'

const props = {
  universityName: 'Example University',
  officialUrl: 'https://example.edu.cn/admissions',
}

describe('university programme availability guidance', () => {
  it.each(publicLocales)('offers official discovery and localized feedback in %s', (locale) => {
    render(<UniversityProgramsPending {...props} locale={locale} />)

    expect(screen.getByRole('heading', { level: 3 })).toBeVisible()
    expect(screen.getByTestId('university-programs-pending')).toHaveTextContent(props.universityName)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', props.officialUrl)
    expect(links[1]).toHaveAttribute('href', `/${locale}/contact`)
    for (const link of links) expect(link).toHaveAccessibleName()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('distinguishes an atlas evidence gap from university admissions availability', () => {
    render(<UniversityProgramsPending {...props} locale="en" />)

    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('No current verified programme information')
    expect(screen.getByTestId('university-programs-pending')).toHaveTextContent('This does not mean the university has no programmes or is not admitting students.')
    expect(screen.queryByText(/verification in progress|coming soon|available shortly|within \d+ days/i)).not.toBeInTheDocument()
  })

  it('explains the same evidence boundary in Chinese', () => {
    render(<UniversityProgramsPending {...props} locale="zh" />)

    expect(screen.getByTestId('university-programs-pending')).toHaveTextContent('当前已核验的专业信息')
    expect(screen.getByTestId('university-programs-pending')).toHaveTextContent('这不代表该大学没有开设专业或没有招生')
    expect(screen.getByRole('link', { name: '反馈缺失的专业' })).toHaveAttribute('href', '/zh/contact')
  })

  it('renders on the server and treats the university name as plain text', () => {
    const markup = renderToStaticMarkup(<UniversityProgramsPending {...props} universityName={'University <script>alert(1)</script>'} locale="en" />)

    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('<h3')
  })
})
