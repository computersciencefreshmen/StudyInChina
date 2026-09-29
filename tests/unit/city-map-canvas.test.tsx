import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { getCityMapCopy } from '@/i18n/city-map'
import { CityMapCanvas } from '@/components/features/CityMapCanvas'
import type { CityPlotItem } from '@/components/features/CityConstellation'

type FakeMap = {
  container: HTMLElement
  options: Record<string, unknown>
  fitBounds: ReturnType<typeof vi.fn>
  panTo: ReturnType<typeof vi.fn>
  zoomIn: ReturnType<typeof vi.fn>
  zoomOut: ReturnType<typeof vi.fn>
  invalidateSize: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  getZoom: ReturnType<typeof vi.fn>
  project: ReturnType<typeof vi.fn>
  unproject: ReturnType<typeof vi.fn>
}
type FakeTiles = {
  url: string
  options: Record<string, unknown>
  emit: (event: string) => void
  redraw: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
}
type FakeMarker = {
  coordinates: [number, number]
  element: HTMLElement
  emit: (event: string) => void
  setZIndexOffset: ReturnType<typeof vi.fn>
}
type FakeGroup = {
  map: FakeMap | null
  nodes: HTMLElement[]
  addTo: (map: FakeMap) => FakeGroup
  clearLayers: () => void
}

const state = vi.hoisted(() => ({
  maps: [] as FakeMap[], tiles: [] as FakeTiles[], markers: [] as FakeMarker[],
  failSetup: false, viewportWidth: 768,
}))

// This mock owns all tiles. Unit tests never contact the external tile service.
vi.mock('leaflet', () => ({
  map: (container: HTMLElement, options: Record<string, unknown>) => {
    if (state.failSetup) throw new Error('Map initialization failed')
    const map = {
      container, options, fitBounds: vi.fn(), panTo: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(),
      invalidateSize: vi.fn(), remove: vi.fn(() => container.replaceChildren()),
      getZoom: vi.fn(() => 6),
      project: vi.fn(([lat, lng]: [number, number]) => ({ subtract: ([x, y]: [number, number]) => ({ x: lng * 100 - x, y: lat * 100 - y }) })),
      unproject: vi.fn((point: { x: number; y: number }) => [point.y / 100, point.x / 100]),
    }
    state.maps.push(map)
    return map
  },
  layerGroup: () => {
    const group: FakeGroup = {
      map: null, nodes: [],
      addTo(map) { this.map = map; return this },
      clearLayers() { for (const node of this.nodes) node.remove(); this.nodes = [] },
    }
    return group
  },
  tileLayer: (url: string, options: Record<string, unknown>) => {
    const handlers = new Map<string, () => void>()
    const tiles = {
      url, options,
      on(event: string, callback: () => void) { handlers.set(event, callback); return this },
      emit(event: string) { handlers.get(event)?.() },
      off: vi.fn(() => handlers.clear()), redraw: vi.fn(), addTo() { return this },
    }
    state.tiles.push(tiles)
    return tiles
  },
  divIcon: (options: unknown) => options,
  marker: (coordinates: [number, number], options: { icon: { html: HTMLElement; className: string } }) => {
    const handlers = new Map<string, () => void>()
    const element = document.createElement('div')
    element.className = options.icon.className
    element.setAttribute('role', 'button')
    element.setAttribute('tabindex', '0')
    element.append(options.icon.html)
    const marker = {
      coordinates, element,
      on(event: string, callback: () => void) { handlers.set(event, callback); return this },
      emit(event: string) { handlers.get(event)?.() },
      addTo(group: FakeGroup) { group.nodes.push(element); group.map?.container.append(element); this.emit('add'); return this },
      getElement: () => element, getLatLng: () => coordinates, setZIndexOffset: vi.fn(),
    }
    state.markers.push(marker)
    return marker
  },
}))

const copy = getCityMapCopy('en')
const cities: CityPlotItem[] = [
  { id: 'beijing', slug: 'beijing', name: { en: 'Beijing', zh: '北京' }, coordinates: { lat: 39.9, lng: 116.4 } },
  { id: 'shanghai', slug: 'shanghai', name: { en: 'Shanghai', zh: '上海' }, coordinates: { lat: 31.2, lng: 121.5 } },
]
const resizeCallbacks: ResizeObserverCallback[] = []
const disconnect = vi.fn()

beforeEach(() => {
  state.maps.length = 0
  state.tiles.length = 0
  state.markers.length = 0
  state.failSetup = false
  state.viewportWidth = 768
  resizeCallbacks.length = 0
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 901px)' && state.viewportWidth >= 901 }))
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback) }
    observe = vi.fn()
    disconnect = disconnect
  })
})
afterEach(() => { vi.unstubAllGlobals() })

async function ready() {
  await waitFor(() => expect(screen.getByRole('button', { name: copy.zoomIn })).toBeEnabled())
}

describe('CityMapCanvas', () => {
  it('loads a viewport-only real basemap and excludes absent or invalid coordinates', async () => {
    render(<CityMapCanvas cities={[
      ...cities,
      { ...cities[0], id: 'missing', coordinates: null },
      { ...cities[0], id: 'invalid', coordinates: { lat: NaN, lng: 116 } },
      { ...cities[0], id: 'outside', coordinates: { lat: 51, lng: 0 } },
    ]} locale="en" selectedId={null} onSelect={vi.fn()} />)
    await ready()
    expect(state.markers).toHaveLength(2)
    expect(state.tiles[0].url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    expect(state.tiles[0].options).toMatchObject({ keepBuffer: 0, updateWhenIdle: true, updateWhenZooming: false, noWrap: true })
    expect(state.maps[0].options).toMatchObject({ scrollWheelZoom: false, minZoom: 3, maxZoom: 14 })
    expect(screen.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')
    expect(screen.getByRole('region', { name: copy.mapLabel })).toHaveAttribute('aria-busy', 'true')
    act(() => { state.tiles[0].emit('tileload'); state.tiles[0].emit('load') })
    expect(screen.getByRole('region', { name: copy.mapLabel })).toHaveAttribute('aria-busy', 'false')
  })

  it('selects safely, preserves the zoom and only fits again when displayed cities change', async () => {
    const onSelect = vi.fn()
    const view = render(<CityMapCanvas cities={cities} locale="en" selectedId={null} onSelect={onSelect} />)
    await ready()
    const map = state.maps[0]
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    act(() => state.markers[0].emit('click'))
    expect(onSelect).toHaveBeenCalledWith('beijing')
    view.rerender(<CityMapCanvas cities={[...cities]} locale="en" selectedId="beijing" onSelect={onSelect} />)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    expect(map.panTo).toHaveBeenLastCalledWith([39.9, 116.4], expect.any(Object))
    expect(state.markers[0].element).toHaveClass('is-selected')
    expect(state.markers[0].element).toHaveAttribute('aria-pressed', 'true')
    expect(map.zoomIn).not.toHaveBeenCalled()
    view.rerender(<CityMapCanvas cities={[...cities].reverse()} locale="en" selectedId="beijing" onSelect={onSelect} />)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    expect(state.markers).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: copy.zoomIn }))
    fireEvent.click(screen.getByRole('button', { name: copy.zoomOut }))
    expect(map.zoomIn).toHaveBeenCalledTimes(1)
    expect(map.zoomOut).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: copy.showAll }))
    expect(map.fitBounds).toHaveBeenCalledTimes(2)
    view.rerender(<CityMapCanvas cities={[cities[1]]} locale="en" selectedId={null} onSelect={onSelect} />)
    expect(map.fitBounds).toHaveBeenCalledTimes(3)
    expect(map.fitBounds).toHaveBeenLastCalledWith([[31.2, 121.5]], expect.objectContaining({ maxZoom: 7 }))
  })

  it('repositions a retained selection after filtering changes the fitted extent', async () => {
    state.viewportWidth = 960
    const view = render(<CityMapCanvas cities={cities} locale="en" selectedId="beijing" onSelect={vi.fn()} />)
    await ready()
    const map = state.maps[0]
    expect(map.panTo).toHaveBeenCalledTimes(1)
    view.rerender(<CityMapCanvas cities={[cities[0]]} locale="en" selectedId="beijing" onSelect={vi.fn()} />)
    expect(map.fitBounds).toHaveBeenCalledTimes(2)
    expect(map.panTo).toHaveBeenCalledTimes(2)
    expect(map.panTo).toHaveBeenLastCalledWith([39.9, 114.8], expect.any(Object))
    expect(screen.getByRole('button', { name: 'Beijing' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps selected pins clear of the detail card on narrow desktops without shifting mobile centres', async () => {
    state.viewportWidth = 960
    const view = render(<CityMapCanvas cities={cities} locale="en" selectedId={null} onSelect={vi.fn()} />)
    await ready()
    const map = state.maps[0]
    view.rerender(<CityMapCanvas cities={cities} locale="en" selectedId="beijing" onSelect={vi.fn()} />)
    expect(map.project).toHaveBeenLastCalledWith([39.9, 116.4], 6)
    expect(map.unproject).toHaveBeenLastCalledWith({ x: 11480, y: 3990 }, 6)
    expect(map.panTo).toHaveBeenLastCalledWith([39.9, 114.8], expect.any(Object))
    expect(map.zoomIn).not.toHaveBeenCalled()
    expect(map.zoomOut).not.toHaveBeenCalled()

    state.viewportWidth = 390
    view.rerender(<CityMapCanvas cities={cities} locale="en" selectedId="shanghai" onSelect={vi.fn()} />)
    expect(map.project).toHaveBeenCalledTimes(1)
    expect(map.panTo).toHaveBeenLastCalledWith([31.2, 121.5], expect.any(Object))
  })

  it('uses text nodes for labels and supports keyboard selection after filtering', async () => {
    const firstCallback = vi.fn()
    const newCallback = vi.fn()
    const view = render(<CityMapCanvas cities={cities} locale="en" selectedId={null} onSelect={firstCallback} />)
    await ready()
    const unsafeName = '<img src=x onerror=alert(1)>'
    view.rerender(<CityMapCanvas cities={[{ ...cities[1], name: { en: unsafeName } }]} locale="en" selectedId={null} onSelect={newCallback} />)
    const marker = screen.getByRole('button', { name: unsafeName })
    expect(marker.querySelector('img')).toBeNull()
    expect(marker.textContent).toBe(unsafeName)
    fireEvent.keyDown(marker, { key: ' ' })
    expect(newCallback).toHaveBeenCalledWith('shanghai')
    expect(firstCallback).not.toHaveBeenCalled()
  })

  it('retains markers when tiles fail and does not treat a failed batch as loaded', async () => {
    render(<CityMapCanvas cities={cities} locale="en" selectedId="beijing" onSelect={vi.fn()} />)
    await ready()
    const tile = state.tiles[0]
    act(() => { tile.emit('tileerror'); tile.emit('load') })
    expect(screen.getByText(copy.tileUnavailable)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Beijing' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: copy.retry }))
    expect(tile.redraw).toHaveBeenCalledTimes(1)
    expect(state.maps).toHaveLength(1)
    expect(state.markers[0].element).toHaveClass('is-selected')
    expect(screen.getByText(copy.loading)).toBeVisible()
    act(() => { tile.emit('tileload'); tile.emit('load') })
    expect(screen.queryByText(copy.tileUnavailable)).not.toBeInTheDocument()
    expect(screen.queryByText(copy.loading)).not.toBeInTheDocument()
  })

  it('recovers map initialization failures without changing the available controls', async () => {
    state.failSetup = true
    render(<CityMapCanvas cities={cities} locale="en" selectedId={null} onSelect={vi.fn()} />)
    expect(await screen.findByText(copy.loadFailed)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.zoomIn })).toBeDisabled()
    expect(screen.getByRole('region', { name: copy.mapLabel })).toHaveAttribute('aria-busy', 'false')
    state.failSetup = false
    fireEvent.click(screen.getByRole('button', { name: copy.retry }))
    await ready()
    expect(state.maps).toHaveLength(1)
  })

  it('invalidates on resize and releases the map, events and observer under StrictMode', async () => {
    const view = render(<StrictMode><CityMapCanvas cities={cities} locale="en" selectedId={null} onSelect={vi.fn()} /></StrictMode>)
    await ready()
    expect(state.maps).toHaveLength(1)
    act(() => resizeCallbacks[0]([], {} as ResizeObserver))
    expect(state.maps[0].invalidateSize).toHaveBeenCalledWith({ animate: false, pan: false })
    view.unmount()
    expect(state.maps[0].remove).toHaveBeenCalledTimes(1)
    expect(state.tiles[0].off).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
