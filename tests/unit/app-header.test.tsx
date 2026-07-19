import { render } from '@testing-library/react'
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
    ]))
    expect(hrefs.some((href) => href?.startsWith('/de'))).toBe(false)
  })
})
