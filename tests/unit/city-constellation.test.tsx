import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CityConstellation } from '@/components/features/CityConstellation'
import type { City } from '@/lib/data/types'

const city: City = {
  id: 'city-guangzhou',
  slug: 'guangzhou',
  name: { en: 'Guangzhou', zh: '广州' },
  province: { en: 'Guangdong', zh: '广东省' },
  region: 'south',
  coordinates: { lat: 23.1291, lng: 113.2644 },
  overview: { en: 'A student city.' },
  climate: null,
  foodHighlights: [],
  sights: [],
  sourceIds: ['source-city-guangzhou'],
  verifiedAt: '2026-07-26',
  reviewAfter: '2027-07-26',
  status: 'verified',
}

describe('CityConstellation', () => {
  it('keeps a located city link visible with its university count', () => {
    render(<CityConstellation cities={[city]} locale="en" universityCounts={{ [city.id]: 3 }} />)

    const link = screen.getByRole('link', { name: 'Guangzhou: 3 Universities' })
    expect(link).toHaveAttribute('href', '/en/cities/guangzhou')
    expect(link).toHaveTextContent('3 Universities')
  })

  it('shows an explicit fallback instead of a blank plot without coordinates', () => {
    render(<CityConstellation cities={[{ ...city, coordinates: null }]} locale="en" />)

    expect(screen.getByText('0 Cities')).toBeInTheDocument()
    expect(screen.getAllByText(/latitude\/longitude city index/i)).toHaveLength(2)
  })
})
