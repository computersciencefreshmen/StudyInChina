import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AppHeader } from '@/components/layout/AppHeader'

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/programs/software-engineering',
  useSearchParams: () => new URLSearchParams('degree=master&applicationState=open&page=3&cursor=opaque&cursorHistory=%7E%2Cprevious'),
}))

describe('AppHeader locale navigation', () => {
  it('keeps the current path and exposes public languages only', () => {
    const { container } = render(<AppHeader locale="en" />)
    const hrefs = Array.from(container.querySelectorAll('.atlas-language-switcher a'))
      .map((link) => link.getAttribute('href'))

    expect(new Set(hrefs)).toEqual(new Set([
      '/en/programs/software-engineering?degree=master&applicationState=open',
      '/zh/programs/software-engineering?degree=master&applicationState=open',
      '/ru/programs/software-engineering?degree=master&applicationState=open',
      '/de/programs/software-engineering?degree=master&applicationState=open',
      '/fr/programs/software-engineering?degree=master&applicationState=open',
      '/es/programs/software-engineering?degree=master&applicationState=open',
    ]))
    expect(hrefs.some((href) => href?.startsWith('/pt'))).toBe(false)
    expect(hrefs.some((href) => href?.startsWith('/ar'))).toBe(false)
  })

  it('keeps discovery routes in primary navigation and treats saved programs as a tool', () => {
    const { container } = render(<AppHeader locale="en" />)
    const primaryNav = container.querySelector('.atlas-site-header__nav')
    const primaryHrefs = Array.from(primaryNav?.querySelectorAll('a') ?? [])
      .map((link) => link.getAttribute('href'))

    expect(primaryHrefs).toEqual([
      '/en',
      '/en/universities',
      '/en/programs',
      '/en/scholarships',
      '/en/cities',
      '/en/guides',
    ])
    expect(primaryHrefs).not.toContain('/en/favorites')

    const savedLinks = screen.getAllByRole('link', { name: /saved/i })
    expect(savedLinks).toHaveLength(2)
    expect(savedLinks.every((link) => link.getAttribute('href') === '/en/favorites')).toBe(true)
  })

  it('discloses possible English record fallbacks on beta-language data routes', () => {
    render(<AppHeader locale="de" />)

    expect(screen.getByRole('note')).toHaveTextContent(/Englisch/)
  })
})
