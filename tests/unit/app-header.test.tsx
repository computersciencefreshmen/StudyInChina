import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AppHeader } from '@/components/layout/AppHeader'

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/programs/software-engineering',
}))

describe('AppHeader locale navigation', () => {
  it('keeps the current path and exposes public languages only', () => {
    const { container } = render(<AppHeader locale="en" />)
    const hrefs = Array.from(container.querySelectorAll('.atlas-language-switcher a'))
      .map((link) => link.getAttribute('href'))

    expect(new Set(hrefs)).toEqual(new Set([
      '/en/programs/software-engineering',
      '/zh/programs/software-engineering',
      '/ru/programs/software-engineering',
      '/de/programs/software-engineering',
      '/fr/programs/software-engineering',
      '/es/programs/software-engineering',
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
})
