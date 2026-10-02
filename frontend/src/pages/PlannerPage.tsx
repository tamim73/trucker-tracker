import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { TripForm, type FormState } from '../components/TripForm'
import { LazyMap as TripMap } from '../components/LazyMap'
import { ApiError, api, type DriverDetails, type TripRequest } from '../lib/api'
import { EMPTY_DRIVER } from '../lib/driver'
import { defaultDeparture } from '../lib/format'

const DRIVER_KEY = 'trip-planner-driver'


/** Driver details saved by the last trip, keeping only known text fields. */
function storedDriver(): DriverDetails {
  try {
    const saved = JSON.parse(localStorage.getItem(DRIVER_KEY) ?? '{}') as Record<string, unknown>
    const driver = { ...EMPTY_DRIVER }
    for (const key of Object.keys(EMPTY_DRIVER) as (keyof DriverDetails)[]) {
      if (typeof saved?.[key] === 'string') driver[key] = saved[key] as string
    }
    return driver
  } catch {
    return EMPTY_DRIVER
  }
}

function tomorrowAt(hour: number) {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`
}

/** A multi-day example: deadhead to Indianapolis, loaded to Salt Lake City. */
function sampleTrip(): FormState {
  return {
    current: { label: 'Joliet, IL', lat: 41.52636, lon: -88.084021 },
    pickup: { label: 'Indianapolis, IN', lat: 39.768333, lon: -86.15835 },
    dropoff: { label: 'Salt Lake City, UT', lat: 40.759505, lon: -111.888229 },
    cycle: '21.5',
    departure: tomorrowAt(6),
    driver: {
      name: 'Rosa Delgado',
      co_driver: '',
      carrier: 'Prairie Line Freight LLC',
      main_office: '2210 W Jefferson St, Joliet, IL 60435',
      home_terminal: '2210 W Jefferson St, Joliet, IL 60435',
      vehicle_numbers: 'Tractor 4471 / Trailer 53-1208, IL',
      shipping_document: 'BOL 88213-07',
      commodity: 'Midwest Paper Co., packaged paper goods',
    },
  }
}

export function PlannerPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [form, setForm] = useState<FormState>(() => ({
    current: { label: '' },
    pickup: { label: '' },
    dropoff: { label: '' },
    cycle: '0',
    departure: defaultDeparture(),
    driver: storedDriver(),
  }))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const touched = useRef(false)

  // Any edit clears the last server error, which may no longer apply.
  const updateForm: Dispatch<SetStateAction<FormState>> = useCallback((action) => {
    touched.current = true
    setForm(action)
    setError(null)
  }, [])

  // "Edit trip" opens the planner prefilled from an existing plan, unless the
  // driver has already started typing.
  const fromId = params.get('from')
  useEffect(() => {
    if (!fromId) return
    const controller = new AbortController()
    api
      .getTrip(fromId, controller.signal)
      .then((trip) => {
        if (touched.current) return
        const i = trip.inputs
        setForm({
          current: i.current,
          pickup: i.pickup,
          dropoff: i.dropoff,
          cycle: String(i.cycle_used_hours),
          departure: i.departure,
          driver: { ...EMPTY_DRIVER, ...(i.driver ?? {}) },
        })
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof ApiError ? err : null)
      })
    return () => controller.abort()
  }, [fromId])

  function forgetDriver() {
    try {
      localStorage.removeItem(DRIVER_KEY)
    } catch {
      /* storage unavailable: nothing was saved */
    }
    updateForm((v) => ({ ...v, driver: EMPTY_DRIVER }))
  }

  useEffect(() => {
    document.title = 'Plan a Trip - HOS Trip Planner Demo'
  }, [])

  async function submit(request: TripRequest) {
    setSubmitting(true)
    setError(null)
    try {
      localStorage.setItem(DRIVER_KEY, JSON.stringify(request.driver))
    } catch {
      /* not critical */
    }
    try {
      const trip = await api.createTrip(request)
      navigate(`/trips/${trip.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('Something went wrong. Try again.', 0))
      setSubmitting(false)
    }
  }

  const { current, pickup, dropoff } = form
  const places = useMemo(() => ({ current, pickup, dropoff }), [current, pickup, dropoff])

  return (
    <main id="main" className="grid lg:h-[calc(100dvh-64px)] lg:grid-cols-[minmax(420px,520px)_1fr]">
      <div className="flex flex-col gap-8 px-4 py-8 sm:px-8 lg:overflow-y-auto lg:py-10">
        <div className="flex flex-col gap-3">
          <h1 className="text-[34px] leading-[40px] font-bold tracking-[-0.025em] sm:text-[40px] sm:leading-[46px]">
            Plan a compliant trip
          </h1>
          <p className="max-w-[46ch] text-[16px] leading-6 text-body">
            Enter where you are, where you load and where you deliver. Get the route, required stops and filled daily logs.
          </p>
        </div>
        <TripForm
          value={form}
          onChange={updateForm}
          onForgetDriver={forgetDriver}
          onSubmit={submit}
          submitting={submitting}
          serverError={error?.message}
          fieldErrors={error?.fields}
          onLoadSample={() => updateForm(sampleTrip())}
        />
        <Assumptions />
      </div>
      <div className="h-[42vh] min-h-[280px] lg:h-auto">
        <TripMap places={places} className="h-full" />
      </div>
    </main>
  )
}

function Assumptions() {
  const items = [
    'Property-carrying driver on the 70-hour / 8-day schedule, no adverse driving conditions.',
    '11 hours driving and a 14-hour window after 10 hours off, 30-minute break after 8 hours of driving.',
    'Fuel at least every 1,000 miles (30 minutes on duty). 1 hour on duty at pickup and drop-off.',
    '15-minute pre-trip inspection each duty day and a post-trip inspection on arrival.',
    'Truck speed follows the road network estimate, capped at a 60 mph average.',
  ]
  return (
    <section aria-labelledby="assumptions" className="border-t border-hairline pt-6">
      <h2 id="assumptions" className="text-[15px] font-semibold">
        Planning rules
      </h2>
      <ul className="mt-3 flex flex-col gap-2 text-[14px] leading-5 text-body">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5">
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-mute" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}
