import { CaretDownIcon, CrosshairIcon, MinusIcon, PlusIcon, SpinnerGapIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useId, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react'
import { api, type DriverDetails, type PlaceDraft, type TripRequest } from '../lib/api'
import { DRIVER_FIELDS } from '../lib/driver'
import { formatNumber } from '../lib/format'
import { PlaceInput } from './PlaceInput'

export type Role = 'current' | 'pickup' | 'dropoff'

export interface FormState {
  current: PlaceDraft
  pickup: PlaceDraft
  dropoff: PlaceDraft
  cycle: string
  departure: string
  driver: DriverDetails
}

interface Props {
  value: FormState
  /** Accepts an updater so async results (geolocation) apply to the latest form. */
  onChange: Dispatch<SetStateAction<FormState>>
  onForgetDriver: () => void
  onSubmit: (request: TripRequest) => void
  submitting: boolean
  serverError?: string
  fieldErrors?: Record<string, string>
  onLoadSample: () => void
}


export function TripForm({ value, onChange, onSubmit, submitting, serverError, fieldErrors = {}, onLoadSample, onForgetDriver }: Props) {
  const ids = { cycle: useId(), departure: useId(), cycleHelp: useId(), departureHelp: useId() }
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [locating, setLocating] = useState(false)
  const allErrors = { ...fieldErrors, ...errors }

  const cycle = Number.parseFloat(value.cycle)
  const cycleValid = Number.isFinite(cycle) && cycle >= 0 && cycle <= 70
  const available = cycleValid ? 70 - cycle : null

  function setPlace(role: Role, place: PlaceDraft) {
    onChange((v) => ({ ...v, [role]: place }))
    if (errors[role]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[role]
        return next
      })
    }
  }

  function setCycle(next: number) {
    const clamped = Math.min(70, Math.max(0, Math.round(next * 4) / 4))
    onChange((v) => ({ ...v, cycle: String(clamped) }))
  }

  function locateMe() {
    if (!('geolocation' in navigator)) {
      setErrors((e) => ({ ...e, current: 'This browser cannot share its location. Type a city instead.' }))
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const place = await api.reverse(coords.latitude, coords.longitude)
          setPlace('current', { label: place.label, lat: coords.latitude, lon: coords.longitude })
        } catch {
          setPlace('current', {
            label: `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`,
            lat: coords.latitude,
            lon: coords.longitude,
          })
        } finally {
          setLocating(false)
        }
      },
      () => {
        setLocating(false)
        setErrors((e) => ({ ...e, current: 'Location access was blocked. Type a city instead.' }))
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    const roles: [Role, string][] = [
      ['current', 'Enter where the truck is now.'],
      ['pickup', 'Enter the pickup location.'],
      ['dropoff', 'Enter the drop-off location.'],
    ]
    for (const [role, message] of roles) if (!value[role].label.trim()) next[role] = message
    if (!cycleValid) next.cycle_used_hours = 'Enter hours between 0 and 70.'
    if (!value.departure) next.departure = 'Pick a departure date and time.'
    setErrors(next)
    if (Object.keys(next).length) {
      const first = Object.keys(next)[0]
      document.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus()
      return
    }
    onSubmit({
      current: value.current,
      pickup: value.pickup,
      dropoff: value.dropoff,
      cycle_used_hours: cycle,
      departure: value.departure,
      driver: value.driver,
    })
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Route</legend>
        <RouteRow shape="dot">
          <PlaceInput
            name="current"
            label="Current location"
            placeholder="City, address or terminal…"
            value={value.current}
            onChange={(p) => setPlace('current', p)}
            error={allErrors.current}
            busy={locating}
            trailing={
              <button
                type="button"
                className="icon-btn size-9"
                onClick={locateMe}
                aria-label="Use my current location"
                title="Use my current location"
                disabled={locating}
              >
                <CrosshairIcon size={18} weight="bold" aria-hidden />
              </button>
            }
          />
        </RouteRow>
        <RouteRow shape="square">
          <PlaceInput
            name="pickup"
            label="Pickup"
            placeholder="Shipper city or address…"
            value={value.pickup}
            onChange={(p) => setPlace('pickup', p)}
            error={allErrors.pickup}
          />
        </RouteRow>
        <RouteRow shape="filled" last>
          <PlaceInput
            name="dropoff"
            label="Drop-off"
            placeholder="Receiver city or address…"
            value={value.dropoff}
            onChange={(p) => setPlace('dropoff', p)}
            error={allErrors.dropoff}
          />
        </RouteRow>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor={ids.cycle} className="field-label">
            Current cycle used
          </label>
          <div className="flex h-12 items-center gap-1 rounded-[10px] bg-soft px-1.5 focus-within:shadow-[inset_0_0_0_2px_var(--ink)]">
            <button type="button" className="icon-btn size-9" onClick={() => setCycle((cycleValid ? cycle : 0) - 0.5)} aria-label="Decrease by 30 minutes">
              <MinusIcon size={16} weight="bold" aria-hidden />
            </button>
            <input
              id={ids.cycle}
              name="cycle_used_hours"
              type="number"
              inputMode="decimal"
              min={0}
              max={70}
              step={0.25}
              autoComplete="off"
              value={value.cycle}
              onChange={(e) => onChange((v) => ({ ...v, cycle: e.target.value }))}
              aria-describedby={ids.cycleHelp}
              aria-invalid={Boolean(allErrors.cycle_used_hours)}
              className="tnum w-full min-w-0 bg-transparent text-center font-mono text-[17px] font-medium outline-none focus-visible:outline-none"
            />
            <span className="pr-1 text-[14px] text-body" aria-hidden>
              hrs
            </span>
            <button type="button" className="icon-btn size-9" onClick={() => setCycle((cycleValid ? cycle : 0) + 0.5)} aria-label="Increase by 30 minutes">
              <PlusIcon size={16} weight="bold" aria-hidden />
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={70}
            step={0.5}
            value={cycleValid ? cycle : 0}
            onChange={(e) => setCycle(Number(e.target.value))}
            aria-label="Current cycle used, in hours"
            className="h-6 w-full cursor-pointer accent-[var(--ink)]"
          />
          <p id={ids.cycleHelp} className={`text-[13px] ${allErrors.cycle_used_hours ? 'text-danger' : 'text-body'}`} aria-live="polite">
            {allErrors.cycle_used_hours ??
              (available === null
                ? 'Hours on duty in the last 8 days, from 0 to 70.'
                : available < 0.25
                  ? 'Cycle used up. The plan starts with a 34-hour restart.'
                  : `${formatNumber(available)} h left of the 70-hour / 8-day limit.`)}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={ids.departure} className="field-label">
            Departure, home terminal time
          </label>
          <input
            id={ids.departure}
            name="departure"
            type="datetime-local"
            step={900}
            autoComplete="off"
            value={value.departure}
            onChange={(e) => onChange((v) => ({ ...v, departure: e.target.value }))}
            aria-invalid={Boolean(allErrors.departure)}
            aria-describedby={ids.departureHelp}
            className="tnum h-12 w-full rounded-[10px] bg-soft px-3.5 text-[16px] text-ink outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ink)] focus-visible:outline-none"
          />
          <p id={ids.departureHelp} className={`text-[13px] ${allErrors.departure ? 'text-danger' : 'text-body'}`}>
            {allErrors.departure ?? 'Logs run midnight to midnight in this time.'}
          </p>
        </div>
      </div>

      <details className="group rounded-2xl border border-hairline">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3.5 hover:bg-softer [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-[15px] font-medium">Log sheet details</span>
            <span className="block text-[13px] text-body">Driver, carrier and equipment printed on every sheet. Optional.</span>
          </span>
          <CaretDownIcon size={18} weight="bold" className="shrink-0 transition-transform duration-200 group-open:rotate-180" aria-hidden />
        </summary>
        <div className="grid gap-4 px-4 pt-1 pb-4 sm:grid-cols-2">
          {DRIVER_FIELDS.map((field) => (
            <DriverField
              key={field.key}
              field={field}
              value={value.driver[field.key]}
              onChange={(text) => onChange((v) => ({ ...v, driver: { ...v.driver, [field.key]: text } }))}
            />
          ))}
          <p className="text-[13px] text-body sm:col-span-2">
            Saved in this browser for your next trip.{' '}
            <button type="button" className="font-medium text-ink underline underline-offset-2" onClick={onForgetDriver}>
              Forget saved details
            </button>
          </p>
        </div>
      </details>

      {serverError && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl bg-danger-soft px-4 py-3 text-[14px] text-danger">
          <WarningCircleIcon size={20} weight="bold" className="mt-px shrink-0" aria-hidden />
          <p>{serverError}</p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="submit" className="btn btn-primary h-12 flex-1 text-[16px]" disabled={submitting}>
          {submitting ? (
            <>
              <SpinnerGapIcon size={18} weight="bold" className="animate-spin" aria-hidden />
              Planning route and logs…
            </>
          ) : (
            'Plan Trip'
          )}
        </button>
        <button type="button" className="btn btn-subtle h-12" onClick={onLoadSample} disabled={submitting}>
          Load Sample Trip
        </button>
      </div>
    </form>
  )
}

function DriverField({
  field,
  value,
  onChange,
}: {
  field: (typeof DRIVER_FIELDS)[number]
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="field-label">
        {field.label}
      </label>
      <input
        id={id}
        name={`driver_${field.key}`}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        autoComplete={field.autoComplete ?? 'off'}
        maxLength={field.key === 'carrier' || field.key === 'commodity' ? 120 : 160}
        className="h-11 w-full min-w-0 rounded-[10px] bg-soft px-3.5 text-[15px] text-ink outline-none placeholder:text-mute focus-visible:shadow-[inset_0_0_0_2px_var(--ink)] focus-visible:outline-none"
      />
    </div>
  )
}

function RouteRow({ shape, last, children }: { shape: 'dot' | 'square' | 'filled'; last?: boolean; children: ReactNode }) {
  return (
    <div className="relative grid grid-cols-[20px_1fr] gap-x-3">
      {!last && <span className="absolute top-[30px] -bottom-[38px] left-[9px] w-0.5 bg-ink/60" aria-hidden />}
      <div className="relative z-10 flex h-[60px] items-center justify-center" aria-hidden>
        {shape === 'dot' && <span className="size-3.5 rounded-full border-[3px] border-ink bg-canvas" />}
        {shape === 'square' && <span className="size-3.5 border-[3px] border-ink bg-canvas" />}
        {shape === 'filled' && <span className="size-3.5 bg-ink" />}
      </div>
      {children}
    </div>
  )
}
