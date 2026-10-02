import { AttributionControl, LngLatBounds, Map as MapLibre, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PlaceDraft, RouteLeg, Segment } from '../lib/api'
import { DUTY, KIND } from '../lib/duty'

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}
const US_BOUNDS: [[number, number], [number, number]] = [
  [-124.8, 24.4],
  [-66.9, 49.4],
]
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')

const NO_STOPS: Segment[] = []
const ROUTE_LAYERS = ['route-casing-0', 'route-line-0', 'route-casing-1', 'route-line-1', 'preview-line']

interface Props {
  theme: 'light' | 'dark'
  places: { current?: PlaceDraft; pickup?: PlaceDraft; dropoff?: PlaceDraft }
  legs?: RouteLeg[]
  stops?: Segment[]
  activeStopId?: number | null
  onStopSelect?: (id: number) => void
  stopLabel?: (stop: Segment) => string
  padding?: { top: number; right: number; bottom: number; left: number }
  className?: string
}

type Pin = { key: string; lon: number; lat: number; kind: 'current' | 'pickup' | 'dropoff' | 'stop'; stop?: Segment }

function hasCoords(p?: PlaceDraft): p is PlaceDraft & { lat: number; lon: number } {
  return p != null && p.lat != null && p.lon != null
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function TripMap({ theme, places, legs, stops = NO_STOPS, activeStopId, onStopSelect, stopLabel, padding, className }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibre | null>(null)
  const [ready, setReady] = useState(false)
  const latest = useRef({ legs, places })
  latest.current = { legs, places }
  const pad = padding ?? { top: 80, right: 110, bottom: 80, left: 80 }

  // Create the map once.
  useEffect(() => {
    if (!container.current) return
    const instance = new MapLibre({
      container: container.current,
      style: STYLES[theme],
      bounds: US_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: false,
    })
    instance.touchZoomRotate.disableRotation()
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    instance.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    instance.on('style.load', () => {
      drawRoute(instance, latest.current.legs, latest.current.places)
      setReady(true)
    })
    map.current = instance
    const resize = new ResizeObserver(() => instance.resize())
    resize.observe(container.current)
    return () => {
      resize.disconnect()
      instance.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Theme switch swaps the basemap; route layers are re-added on style.load.
  const shownTheme = useRef(theme)
  useEffect(() => {
    if (shownTheme.current === theme) return
    shownTheme.current = theme
    map.current?.setStyle(STYLES[theme])
  }, [theme])

  useEffect(() => {
    if (!ready || !map.current) return
    try {
      drawRoute(map.current, legs, places)
    } catch {
      // Style is mid-swap; the style.load handler draws the route again.
    }
  }, [ready, legs, places])

  // Fit the camera whenever the set of known points changes.
  const fitKey = JSON.stringify([
    legs?.map((l) => l.miles),
    hasCoords(places.current) ? [places.current.lat, places.current.lon] : null,
    hasCoords(places.pickup) ? [places.pickup.lat, places.pickup.lon] : null,
    hasCoords(places.dropoff) ? [places.dropoff.lat, places.dropoff.lon] : null,
  ])
  useEffect(() => {
    const m = map.current
    if (!m) return
    const bounds = new LngLatBounds()
    let count = 0
    for (const leg of legs ?? []) {
      for (const point of leg.geometry) {
        bounds.extend(point)
        count++
      }
    }
    for (const p of [places.current, places.pickup, places.dropoff]) {
      if (hasCoords(p)) {
        bounds.extend([p.lon, p.lat])
        count++
      }
    }
    if (count === 0) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (count === 1) {
      m.easeTo({ center: bounds.getCenter(), zoom: 8, duration: reduce ? 0 : 900 })
    } else {
      m.fitBounds(bounds, { padding: pad, maxZoom: 11, duration: reduce ? 0 : 900 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])

  // Pins rendered with React into marker elements through portals.
  const pins: Pin[] = useMemo(() => {
    const list: Pin[] = []
    for (const stop of stops) list.push({ key: `s${stop.id}`, lon: stop.from.lon, lat: stop.from.lat, kind: 'stop', stop })
    for (const role of ['current', 'pickup', 'dropoff'] as const) {
      const p = places[role]
      if (hasCoords(p)) list.push({ key: role, lon: p.lon, lat: p.lat, kind: role })
    }
    return list
  }, [stops, places])

  const elements = useRef(new Map<string, { el: HTMLDivElement; marker: Marker }>())
  const [, force] = useState(0)

  useEffect(() => {
    const m = map.current
    if (!m) return
    const store = elements.current
    const wanted = new Set(pins.map((p) => p.key))
    for (const [key, entry] of store) {
      if (!wanted.has(key)) {
        entry.marker.remove()
        store.delete(key)
      }
    }
    for (const pin of pins) {
      const existing = store.get(pin.key)
      if (existing) {
        existing.marker.setLngLat([pin.lon, pin.lat])
        continue
      }
      const el = document.createElement('div')
      const marker = new Marker({ element: el, anchor: 'center' }).setLngLat([pin.lon, pin.lat]).addTo(m)
      store.set(pin.key, { el, marker })
    }
    force((n) => n + 1)
  }, [pins])

  useEffect(() => {
    const store = elements.current
    return () => {
      for (const entry of store.values()) entry.marker.remove()
      store.clear()
    }
  }, [])

  useEffect(() => {
    if (activeStopId == null || !map.current) return
    const stop = stops.find((s) => s.id === activeStopId)
    if (!stop) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    map.current.easeTo({
      center: [stop.from.lon, stop.from.lat],
      zoom: Math.max(map.current.getZoom(), 7),
      duration: reduce ? 0 : 700,
    })
    const entry = elements.current.get(`s${activeStopId}`)
    entry?.el.parentElement?.appendChild(entry.el) // raise above neighbors
  }, [activeStopId, stops])

  return (
    <div className={`relative overflow-hidden bg-soft ${className ?? ''}`}>
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" role="region" aria-label="Route map" />
      </div>
      {!ready && <div className="skeleton absolute inset-0" aria-hidden />}
      {pins.map((pin) => {
        const entry = elements.current.get(pin.key)
        if (!entry) return null
        return createPortal(
          <PinView
            pin={pin}
            active={pin.stop?.id === activeStopId}
            onSelect={onStopSelect}
            label={pin.stop && stopLabel ? stopLabel(pin.stop) : undefined}
          />,
          entry.el,
          pin.key,
        )
      })}
    </div>
  )
}

function PinView({ pin, active, onSelect, label }: { pin: Pin; active: boolean; onSelect?: (id: number) => void; label?: string }) {
  if (pin.kind !== 'stop' || !pin.stop) {
    const title = pin.kind === 'current' ? 'Start' : pin.kind === 'pickup' ? 'Pickup' : 'Drop-off'
    return (
      <div className="relative" title={title}>
        <span
          className={`block size-[18px] border-[4px] border-[var(--ink)] shadow-[0_0_0_3px_var(--surface)] ${
            pin.kind === 'current' ? 'rounded-full bg-[var(--surface)]' : pin.kind === 'pickup' ? 'bg-[var(--surface)]' : 'bg-[var(--ink)]'
          }`}
        />
        <span className="absolute top-1/2 left-[calc(100%+6px)] -translate-y-1/2 rounded-full bg-[var(--ink)] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-[var(--canvas)]">
          {title}
        </span>
      </div>
    )
  }
  const stop = pin.stop
  const Icon = KIND[stop.kind].icon
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onSelect?.(stop.id)}
        aria-label={label ?? KIND[stop.kind].title}
        className={`flex items-center justify-center rounded-full border-2 border-[var(--surface)] text-[#fefefd] shadow-[0_2px_8px_rgb(0_0_0/0.25)] transition-transform duration-200 ${
          active ? 'size-9 scale-110' : 'size-7 hover:scale-110'
        }`}
        style={{ background: DUTY[stop.status].color }}
      >
        <Icon size={active ? 18 : 15} weight="bold" aria-hidden />
      </button>
      {active && label && (
        <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 rounded-xl bg-[var(--surface)] px-3 py-2 text-[12px] leading-4 font-medium whitespace-nowrap text-[var(--ink)] shadow-[var(--shadow-float)]">
          {label}
        </span>
      )}
    </div>
  )
}

function firstSymbolLayer(m: MapLibre) {
  return m.getStyle().layers?.find((l) => l.type === 'symbol')?.id
}

function drawRoute(m: MapLibre, legs: RouteLeg[] | undefined, places: Props['places']) {
  const before = firstSymbolLayer(m)
  const ink = cssVar('--ink') || '#121212'
  const accent = cssVar('--accent') || '#0b7352'
  const deadhead = cssVar('--deadhead') || '#6b6b68'
  const casing = cssVar('--surface') || '#ffffff'

  for (const id of ROUTE_LAYERS) if (m.getLayer(id)) m.removeLayer(id)
  for (const id of ['route-0', 'route-1', 'preview']) if (m.getSource(id)) m.removeSource(id)

  if (legs?.length) {
    legs.forEach((leg, i) => {
      const source = `route-${i}`
      m.addSource(source, {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: leg.geometry } },
      })
      m.addLayer(
        {
          id: `route-casing-${i}`,
          type: 'line',
          source,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 6, 10, 11] },
        },
        before,
      )
      m.addLayer(
        {
          id: `route-line-${i}`,
          type: 'line',
          source,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': i === 0 ? deadhead : accent,
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3, 10, 6],
            ...(i === 0 ? { 'line-dasharray': [1.2, 1.4] } : {}),
          },
        },
        before,
      )
    })
    return
  }

  const points = [places.current, places.pickup, places.dropoff].filter(hasCoords).map((p) => [p.lon, p.lat])
  if (points.length >= 2) {
    m.addSource('preview', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points } },
    })
    m.addLayer(
      {
        id: 'preview-line',
        type: 'line',
        source: 'preview',
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': ink, 'line-opacity': 0.55, 'line-width': 2, 'line-dasharray': [2, 2] },
      },
      before,
    )
  }
}

