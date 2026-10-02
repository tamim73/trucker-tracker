import { CheckIcon, MapPinIcon, SpinnerGapIcon } from '@phosphor-icons/react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { api, type Place, type PlaceDraft } from '../lib/api'

interface Props {
  name: string
  label: string
  value: PlaceDraft
  onChange: (value: PlaceDraft) => void
  placeholder: string
  error?: string
  trailing?: ReactNode
  busy?: boolean
}

export function PlaceInput({ name, label, value, onChange, placeholder, error, trailing, busy }: Props) {
  const id = useId()
  const listId = `${id}-list`
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Place[]>([])
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [typed, setTyped] = useState(false)
  const resolved = value.lat != null && value.lon != null

  useEffect(() => {
    if (!typed) return
    const query = value.label.trim()
    if (query.length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const timer = window.setTimeout(() => {
      api
        .searchPlaces(query, controller.signal)
        .then(({ results }) => {
          setResults(results)
          setActive(results.length ? 0 : -1)
          setSearchError('')
          setOpen(true)
        })
        .catch((err) => {
          if (controller.signal.aborted) return
          setResults([])
          setSearchError(err.message)
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 220)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [value.label, typed])

  function choose(place: Place) {
    setTyped(false)
    onChange({ label: place.label, lat: place.lat, lon: place.lon })
    setOpen(false)
    setResults([])
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) {
      if (event.key === 'ArrowDown' && results.length) setOpen(true)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault()
      choose(results[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const showList = open && (results.length > 0 || (!loading && value.label.trim().length >= 2 && typed))
  const errorText = error || searchError

  return (
    <div className="relative min-w-0">
      <div
        className={`flex items-center gap-2 rounded-[10px] bg-soft pr-1.5 transition-shadow duration-150 focus-within:bg-softer focus-within:shadow-[inset_0_0_0_2px_var(--ink)] ${
          errorText ? 'shadow-[inset_0_0_0_1.5px_var(--danger)]' : ''
        }`}
      >
        <label htmlFor={id} className="flex min-w-0 flex-1 cursor-text flex-col px-3.5 pt-2 pb-1.5">
          <span className="text-[12px] leading-4 font-medium text-body">{label}</span>
          <input
            id={id}
            name={name}
            type="text"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
            aria-invalid={Boolean(errorText)}
            aria-describedby={errorText ? `${id}-err` : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            value={value.label}
            onChange={(e) => {
              setTyped(true)
              onChange({ label: e.target.value, lat: null, lon: null })
            }}
            onFocus={() => results.length && setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKeyDown}
            className="w-full min-w-0 truncate bg-transparent text-[16px] leading-6 text-ink outline-none placeholder:text-mute focus-visible:outline-none"
          />
        </label>
        <span className="flex shrink-0 items-center" aria-hidden={!busy && !loading}>
          {loading || busy ? (
            <SpinnerGapIcon size={18} className="mr-2 animate-spin text-mute" aria-label="Searching" />
          ) : resolved ? (
            <CheckIcon size={18} weight="bold" className="mr-2 text-accent" aria-label="Location confirmed" />
          ) : null}
          {trailing}
        </span>
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute inset-x-0 top-[calc(100%+6px)] z-40 max-h-80 overflow-y-auto overscroll-contain rounded-2xl border border-hairline bg-surface p-1.5 shadow-float"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2.5 text-[14px] text-body">No US places match. Try a city and state.</li>
          ) : (
            results.map((place, i) => (
              <li
                key={`${place.id}-${i}`}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(place)
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ${i === active ? 'bg-soft' : ''}`}
              >
                <MapPinIcon size={18} className="mt-0.5 shrink-0 text-body" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium">{place.label}</span>
                  {place.detail && <span className="block truncate text-[13px] text-body">{place.detail}</span>}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
      {errorText && (
        <p id={`${id}-err`} className="mt-1.5 px-1 text-[13px] text-danger" aria-live="polite">
          {errorText}
        </p>
      )}
    </div>
  )
}
