import { CheckIcon, LinkSimpleIcon, PencilSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Itinerary } from '../components/Itinerary'
import { LogsView } from '../components/LogsView'
import { LazyMap as TripMap } from '../components/LazyMap'
import { ComplianceList, TripHeading, TripStats } from '../components/TripSummary'
import { ApiError, api, type Segment, type Trip } from '../lib/api'
import { DUTY, MAP_STOP_KINDS, stopTitle } from '../lib/duty'
import { formatDayClock } from '../lib/format'

interface Props {
  view: 'route' | 'logs'
}

/** Shows the copy cached in this session right away, then refreshes it from
 *  the server so edits made elsewhere are picked up. */
function useTrip(id: string | undefined) {
  const [loaded, setLoaded] = useState<Trip | null>(null)
  const [failure, setFailure] = useState<{ id: string; error: ApiError } | null>(null)
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    api
      .getTrip(id, controller.signal)
      .then(setLoaded)
      .catch((err) => {
        if (controller.signal.aborted) return
        setFailure({ id, error: err instanceof ApiError ? err : new ApiError('Could not load this trip.', 0) })
      })
    return () => controller.abort()
  }, [id])
  const trip = loaded?.id === id ? loaded : id ? (api.cachedTrip(id) ?? null) : null
  const error = failure && failure.id === id && !trip ? failure.error : null
  return { trip, error, setTrip: setLoaded }
}

export function TripPage({ view }: Props) {
  const { id } = useParams()
  const { trip, error, setTrip } = useTrip(id)

  useEffect(() => {
    if (trip) {
      document.title = `${view === 'logs' ? 'Daily logs' : 'Route'}: ${trip.places.current.label} to ${trip.places.dropoff.label} - HOS Trip Planner Demo`
    }
  }, [trip, view])

  if (error) return <TripError error={error} />
  if (!trip) return view === 'logs' ? <LogsSkeleton /> : <RouteSkeleton />
  return view === 'logs' ? (
    <main id="main">
      <LogsView trip={trip} onTripChange={setTrip} />
    </main>
  ) : (
    <RouteView trip={trip} />
  )
}

function RouteView({ trip }: { trip: Trip }) {
  const [active, setActive] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const stops = useMemo(() => trip.segments.filter((s) => MAP_STOP_KINDS.includes(s.kind)), [trip.segments])
  const label = useCallback(
    (s: Segment) => `${stopTitle(s)}, ${formatDayClock(trip.summary.start_date, s.start)}`,
    [trip.summary.start_date],
  )

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <main id="main" className="grid lg:h-[calc(100dvh-64px)] lg:grid-cols-[minmax(400px,480px)_1fr]">
      <div className="order-2 flex flex-col gap-8 px-4 py-6 sm:px-6 lg:order-1 lg:overflow-y-auto lg:py-8">
        <div className="flex flex-col gap-4">
          <TripHeading trip={trip} />
          <div className="flex flex-wrap gap-2">
            <Link to={`/?from=${trip.id}`} className="btn btn-subtle h-9 px-4 text-[14px]">
              <PencilSimpleIcon size={16} weight="bold" aria-hidden />
              Edit Trip
            </Link>
            <button type="button" className="btn btn-subtle h-9 px-4 text-[14px]" onClick={copyLink}>
              {copied ? <CheckIcon size={16} weight="bold" aria-hidden /> : <LinkSimpleIcon size={16} weight="bold" aria-hidden />}
              <span aria-live="polite">{copied ? 'Link Copied' : 'Copy Link'}</span>
            </button>
          </div>
        </div>
        <TripStats trip={trip} />
        <ComplianceList checks={trip.compliance} edited={trip.edited} />
        <Itinerary trip={trip} activeId={active} onSelect={setActive} />
      </div>
      <div className="relative order-1 h-[42vh] min-h-[280px] lg:order-2 lg:h-auto">
        <TripMap
          places={trip.places}
          legs={trip.route.legs}
          stops={stops}
          activeStopId={active}
          onStopSelect={setActive}
          stopLabel={label}
          className="h-full"
        />
        <MapLegend />
      </div>
    </main>
  )
}

function MapLegend() {
  const rows = [
    { label: 'To pickup', swatch: <span className="h-0 w-6 border-t-[3px] border-dashed" style={{ borderColor: 'var(--deadhead)' }} /> },
    { label: 'Loaded', swatch: <span className="h-[3px] w-6 rounded-full" style={{ background: 'var(--driving)' }} /> },
    { label: 'Fuel', swatch: <span className="size-3 rounded-full" style={{ background: DUTY.on_duty.color }} /> },
    { label: 'Off duty', swatch: <span className="size-3 rounded-full" style={{ background: DUTY.off_duty.color }} /> },
    { label: 'Sleeper berth', swatch: <span className="size-3 rounded-full" style={{ background: DUTY.sleeper_berth.color }} /> },
  ]
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 hidden flex-wrap gap-x-4 gap-y-1.5 rounded-2xl bg-surface/92 px-4 py-2.5 text-[12px] text-body shadow-float backdrop-blur-sm sm:flex sm:max-w-[calc(100%-120px)]">
      {rows.map((r) => (
        <span key={r.label} className="flex items-center gap-2">
          {r.swatch}
          {r.label}
        </span>
      ))}
    </div>
  )
}

function RouteSkeleton() {
  return (
    <main id="main" className="grid lg:h-[calc(100dvh-64px)] lg:grid-cols-[minmax(400px,480px)_1fr]" aria-busy="true">
      <div className="order-2 flex flex-col gap-6 px-4 py-8 sm:px-6 lg:order-1">
        <span className="sr-only">Loading trip…</span>
        <div className="skeleton h-8 w-4/5 rounded-lg" />
        <div className="skeleton h-5 w-3/5 rounded-lg" />
        <div className="skeleton h-44 rounded-2xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
      <div className="skeleton order-1 h-[42vh] lg:order-2 lg:h-auto" aria-hidden />
    </main>
  )
}

function LogsSkeleton() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 py-8 sm:px-6" aria-busy="true">
      <span className="sr-only">Loading logs…</span>
      <div className="skeleton h-8 w-72 rounded-lg" />
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-14 w-36 rounded-2xl" />
        ))}
      </div>
      <div className="skeleton aspect-[1100/860] w-full rounded-2xl" />
    </main>
  )
}

function TripError({ error }: { error: ApiError }) {
  const missing = error.status === 404
  return (
    <main id="main" className="mx-auto flex max-w-lg flex-col items-start gap-4 px-4 py-20 sm:px-6">
      <WarningCircleIcon size={32} weight="bold" className="text-danger" aria-hidden />
      <h1 className="text-[28px] leading-9 font-bold tracking-[-0.02em]">{missing ? 'Trip not found' : 'Could not load this trip'}</h1>
      <p className="text-[16px] text-body">
        {missing ? 'This link does not match a saved trip. Plan a new one to get a route and logs.' : error.message}
      </p>
      <Link to="/" className="btn btn-primary">
        Plan a Trip
      </Link>
    </main>
  )
}
