'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LaunchLocale } from '@/i18n/config'
import { getCityMapCopy } from '@/i18n/city-map'
import { localize } from '@/lib/data/format'
import type { CityPlotItem } from './CityConstellation'

type Props = {
  cities: CityPlotItem[]
  locale: LaunchLocale
  selectedId: string | null
  onSelect: (id: string) => void
}
type LocatedCity = CityPlotItem & { coordinates: { lat: number; lng: number } }
type MapRuntime = {
  leaflet: typeof import('leaflet')
  map: Leaflet.Map
  tiles: Leaflet.TileLayer
  markers: Map<string, Leaflet.Marker>
  markerLayer: Leaflet.LayerGroup
  signature: string
  selectedId: string | null
  fitAll: () => void
  retryTiles: () => void
}

const COUNTRY_BOUNDS: Leaflet.LatLngBoundsLiteral = [[18, 73], [54, 135]]
const NAVIGATION_BOUNDS: Leaflet.LatLngBoundsLiteral = [[4, 60], [62, 152]]
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
let leafletPromise: Promise<typeof import('leaflet')> | null = null

function loadLeaflet() {
  // StrictMode can mount twice before the first import finishes. Share that load,
  // but release a rejected promise so the Retry button can start a new attempt.
  leafletPromise ??= import('leaflet').catch((error) => { leafletPromise = null; throw error })
  return leafletPromise
}

function hasCoordinates(city: CityPlotItem): city is LocatedCity {
  const point = city.coordinates
  return point !== null && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && point.lat >= 18 && point.lat <= 54 && point.lng >= 73 && point.lng <= 135
}

function shouldAnimate() {
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function CityMapCanvas({ cities, locale, selectedId, onSelect }: Props) {
  const copy = getCityMapCopy(locale)
  const helpId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<MapRuntime | null>(null)
  const onSelectRef = useRef(onSelect)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [tileState, setTileState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])

  useEffect(() => {
    let disposed = false
    let instance: Leaflet.Map | undefined
    let tiles: Leaflet.TileLayer | undefined
    let observer: ResizeObserver | undefined

    // Leaflet reads window during module initialization; keep it out of server rendering.
    void loadLeaflet().then((leaflet) => {
      if (disposed || !containerRef.current) return
      instance = leaflet.map(containerRef.current, {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
        minZoom: 3,
        maxZoom: 14,
        maxBounds: NAVIGATION_BOUNDS,
        maxBoundsViscosity: 1,
      })
      const map = instance
      const markerLayer = leaflet.layerGroup().addTo(map)
      let failedTile = false
      let loadedTile = false
      tiles = leaflet.tileLayer(TILE_URL, {
        maxZoom: 19,
        noWrap: true,
        bounds: NAVIGATION_BOUNDS,
        keepBuffer: 0,
        updateWhenIdle: true,
        updateWhenZooming: false,
        // Browser caching and Referer are retained; no proxy or prefetch is used.
      })
      const tileLayer = tiles
      tileLayer.on('loading', () => {
        if (!disposed && !failedTile) setTileState('loading')
      })
      tileLayer.on('tileload', () => { loadedTile = true })
      tileLayer.on('tileerror', () => {
        failedTile = true
        if (!disposed) setTileState('unavailable')
      })
      // Leaflet fires `load` even if tiles failed. A completed batch is not proof of success.
      tileLayer.on('load', () => {
        if (!disposed) setTileState(failedTile || !loadedTile ? 'unavailable' : 'ready')
      })
      tileLayer.addTo(map)
      runtimeRef.current = {
        leaflet, map, tiles: tileLayer, markerLayer, markers: new Map(), signature: '', selectedId: null,
        fitAll: () => map.fitBounds(COUNTRY_BOUNDS, { padding: [28, 28], maxZoom: 5, animate: false }),
        retryTiles: () => {
          failedTile = false
          loadedTile = false
          setTileState('loading')
          tileLayer.redraw()
        },
      }
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => {
          if (!disposed) map.invalidateSize({ animate: false, pan: false })
        })
        observer.observe(containerRef.current)
      }
      setPhase('ready')
    }).catch(() => {
      if (disposed) return
      observer?.disconnect()
      tiles?.off()
      instance?.remove()
      observer = undefined
      tiles = undefined
      instance = undefined
      runtimeRef.current = null
      setPhase('failed')
    })

    return () => {
      disposed = true
      observer?.disconnect()
      tiles?.off()
      instance?.remove()
      runtimeRef.current = null
    }
  }, [attempt])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || phase !== 'ready') return
    const located = cities.filter(hasCoordinates)
    const signature = JSON.stringify([...located].sort((left, right) => left.id.localeCompare(right.id))
      .map(city => [city.id, city.coordinates, localize(city.name, locale)]))
    const markersChanged = signature !== runtime.signature

    // Fresh arrays and list sorting must not reset the viewport while the user pans.
    if (markersChanged) {
      runtime.markerLayer.clearLayers()
      runtime.markers.clear()
      for (const city of located) {
        const name = localize(city.name, locale)
        const content = document.createElement('span')
        const dot = document.createElement('span')
        dot.className = 'city-map-pin__dot'
        dot.setAttribute('aria-hidden', 'true')
        const label = document.createElement('span')
        label.className = 'city-map-pin__label'
        label.textContent = name
        content.append(dot, label)
        const icon = runtime.leaflet.divIcon({
          html: content, className: 'city-map-pin', iconSize: [44, 44], iconAnchor: [22, 22],
        })
        const marker = runtime.leaflet.marker([city.coordinates.lat, city.coordinates.lng], {
          icon, title: name, alt: name, keyboard: true, autoPanOnFocus: true,
        })
        marker.on('click', () => onSelectRef.current(city.id))
        marker.on('add', () => {
          const element = marker.getElement()
          element?.setAttribute('aria-label', name)
          element?.addEventListener('keydown', (event) => {
            if (event.key === ' ') { event.preventDefault(); onSelectRef.current(city.id) }
          })
        })
        marker.addTo(runtime.markerLayer)
        runtime.markers.set(city.id, marker)
      }
      runtime.signature = signature
      runtime.fitAll = () => {
        const bounds: Leaflet.LatLngBoundsLiteral = located.length
          ? located.map(city => [city.coordinates.lat, city.coordinates.lng])
          : COUNTRY_BOUNDS
        runtime.map.fitBounds(bounds, { padding: [42, 42], maxZoom: located.length === 1 ? 7 : 6, animate: false })
      }
      runtime.fitAll()
    }

    for (const [id, marker] of runtime.markers) {
      const selected = id === selectedId
      marker.getElement()?.classList.toggle('is-selected', selected)
      marker.getElement()?.setAttribute('aria-pressed', String(selected))
      marker.setZIndexOffset(selected ? 1000 : 0)
    }
    if (selectedId !== runtime.selectedId || markersChanged) {
      const marker = selectedId ? runtime.markers.get(selectedId) : undefined
      if (marker) {
        const point = marker.getLatLng()
        const desktopOverlay = window.matchMedia?.('(min-width: 901px)').matches ?? window.innerWidth >= 901
        // On desktop the detail card covers the left side. Move the geographic
        // centre left by 160 screen pixels so the selected pin stays to its right.
        // Mobile details are below the canvas and keep the normal centre.
        const zoom = runtime.map.getZoom()
        const centre = desktopOverlay
          ? runtime.map.unproject(runtime.map.project(point, zoom).subtract([160, 0]), zoom)
          : point
        runtime.map.panTo(centre, { animate: shouldAnimate() })
      }
      runtime.selectedId = selectedId
    }
  }, [cities, locale, selectedId, phase])

  const retry = () => {
    if (phase === 'failed') {
      setPhase('loading')
      setTileState('loading')
      setAttempt(value => value + 1)
    } else runtimeRef.current?.retryTiles()
  }
  const status = phase === 'failed' ? copy.loadFailed
    : tileState === 'unavailable' ? copy.tileUnavailable
      : phase === 'loading' || tileState === 'loading' ? copy.loading : null

  return <div className="city-map-canvas">
    <div ref={containerRef} className="city-map-canvas__surface" role="region"
      aria-label={copy.mapLabel} aria-describedby={helpId} aria-busy={phase === 'loading' || (phase === 'ready' && tileState === 'loading')} />
    <div className="city-map-canvas__controls" role="group" aria-label={copy.mapLabel}>
      <button type="button" aria-label={copy.zoomIn} title={copy.zoomIn} disabled={phase !== 'ready'}
        style={{ minWidth: 44, minHeight: 44 }} onClick={() => runtimeRef.current?.map.zoomIn()}><span aria-hidden="true">+</span></button>
      <button type="button" aria-label={copy.zoomOut} title={copy.zoomOut} disabled={phase !== 'ready'}
        style={{ minWidth: 44, minHeight: 44 }} onClick={() => runtimeRef.current?.map.zoomOut()}><span aria-hidden="true">−</span></button>
      <button type="button" className="city-map-canvas__control--fit" disabled={phase !== 'ready'} aria-label={copy.showAll} title={copy.showAll}
        style={{ minWidth: 44, minHeight: 44 }} onClick={() => runtimeRef.current?.fitAll()}><span aria-hidden="true">⤢</span></button>
    </div>
    {status && <div className="city-map-canvas__status" role="status" aria-live="polite">
      <span>{status}</span>
      {(phase === 'failed' || tileState === 'unavailable') && <button type="button" onClick={retry}
        style={{ minWidth: 44, minHeight: 44 }}>{copy.retry}</button>}
    </div>}
    <p className="city-map-canvas__help" id={helpId}>{copy.mapHelp}</p>
    <p className="city-map-canvas__attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</p>
  </div>
}

export default CityMapCanvas
