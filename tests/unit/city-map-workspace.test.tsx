import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CityMapWorkspace } from '@/components/features/CityMapWorkspace'
import { CityExplorer, type CityExplorerItem } from '@/components/features/CityExplorer'
import { googleMapsCityUrl, hasMapCoordinates } from '@/lib/city-map'

vi.mock('@/components/features/CityMapCanvas', () => ({
  CityMapCanvas: ({ onSelect, selectedId }: { onSelect: (id: string) => void; selectedId: string | null }) =>
    <button data-testid="map-pin" data-selected={selectedId} onClick={() => onSelect('beijing')}>Map pin</button>,
}))

const beijing: CityExplorerItem = { id: 'beijing', slug: 'beijing', name: { en: 'Beijing', zh: '北京' }, province: { en: 'Beijing', zh: '北京市' }, region: 'north', coordinates: { lat: 39.9, lng: 116.4 } }
const pending: CityExplorerItem = { id: 'pending', slug: 'pending', name: { en: 'Pending City' }, province: { en: 'Province' }, region: 'south', coordinates: null }
const universities = [{ id: 'pku', slug: 'peking-university', cityId: 'beijing', name: { en: 'Peking University', zh: '北京大学' } }]

describe('city map workspace', () => {
  it('links list selection to the map, city guide and actual university directory', () => {
    render(<CityMapWorkspace cities={[beijing, pending]} locale="en" universities={universities} universityCounts={{ beijing: 1 }} />)
    fireEvent.click(screen.getByRole('button', { name: /Beijing.*1 Universities/ }))
    expect(screen.getByTestId('map-pin')).toHaveAttribute('data-selected', 'beijing')
    const detail = screen.getByRole('region', { name: 'Beijing' })
    expect(within(detail).getByRole('link', { name: /Peking University/ })).toHaveAttribute('href', '/en/universities/peking-university')
    expect(within(detail).getByRole('link', { name: /Explore city/ })).toHaveAttribute('href', '/en/cities/beijing')
    const provider = new URL(within(detail).getByRole('link', { name: /Google Maps/ }).getAttribute('href')!)
    expect(provider.hostname).toBe('www.google.com')
    expect(provider.searchParams.get('query')).toBe('39.9,116.4')
    fireEvent.click(screen.getByRole('button', { name: 'Close city details' }))
    expect(screen.queryByRole('region', { name: 'Beijing' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Beijing.*1 Universities/ })).toHaveFocus()
  })

  it('scrolls the results pane to a map selection using the pane coordinate system', () => {
    render(<CityMapWorkspace cities={[pending, beijing]} locale="en" universityCounts={{ beijing: 1 }} />)
    const button = screen.getByRole('button', { name: /Beijing.*1 Universities/ })
    const list = button.closest('ul')!
    const scrollTo = vi.fn()
    Object.defineProperty(list, 'scrollTo', { value: scrollTo })
    Object.defineProperty(list, 'scrollTop', { value: 40, writable: true })
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 500 } as DOMRect)
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top: 720 } as DOMRect)
    fireEvent.click(screen.getByTestId('map-pin'))
    expect(scrollTo).toHaveBeenCalledWith({ top: 260, behavior: 'auto' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: 'Beijing' })).toBeVisible()
  })

  it('keeps unlocated cities usable without placing guessed coordinates', () => {
    const { rerender } = render(<CityMapWorkspace cities={[beijing, pending]} locale="en" universityCounts={{}} />)
    fireEvent.click(screen.getByRole('button', { name: /Pending City/ }))
    expect(screen.getByText(/This city has no coordinates in the catalogue/)).toBeVisible()
    expect(new URL(screen.getByRole('link', { name: /Google Maps/ }).getAttribute('href')!).searchParams.get('query')).toBe('Pending City, Province, China')
    rerender(<CityMapWorkspace cities={[beijing]} locale="en" universityCounts={{}} />)
    expect(screen.queryByRole('region', { name: 'Pending City' })).not.toBeInTheDocument()
  })

  it('searches across translations and university names without network geocoding', () => {
    render(<CityExplorer cities={[beijing, pending]} locale="zh" universities={universities} universityCounts={{ beijing: 1 }} />)
    fireEvent.change(screen.getByLabelText('搜索城市'), { target: { value: 'Peking' } })
    expect(screen.getByRole('button', { name: /北京.*1/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Pending City/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('搜索城市'), { target: { value: 'Beijing' } })
    expect(screen.getByRole('button', { name: /北京.*1/ })).toBeVisible()
  })

  it('rejects invalid points and uses a provider search URL with encoded city names', () => {
    expect(hasMapCoordinates({ coordinates: { lat: NaN, lng: 110 } })).toBe(false)
    expect(hasMapCoordinates({ coordinates: { lat: 0, lng: 0 } })).toBe(false)
    const url = new URL(googleMapsCityUrl({ ...pending, name: { en: 'A & B / City' } }))
    expect(url.searchParams.get('api')).toBe('1')
    expect(url.searchParams.get('query')).toBe('A & B / City, Province, China')
    expect(new URL(googleMapsCityUrl({ ...pending, province: null })).searchParams.get('query')).toBe('Pending City, China')
  })
})
