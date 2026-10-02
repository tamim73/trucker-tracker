import { NotebookIcon } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import type { Segment, Trip } from '../lib/api'
import { DUTY, kindInfo, stopTitle } from '../lib/duty'
import { dayIndex, formatClock, formatDay, formatDuration, formatMiles } from '../lib/format'

interface Props {
  trip: Trip
  activeId: number | null
  onSelect: (id: number) => void
}

export function Itinerary({ trip, activeId, onSelect }: Props) {
  const startDate = trip.summary.start_date
  const days = useMemo(() => {
    const map = new Map<number, Segment[]>()
    for (const segment of trip.segments) {
      const d = dayIndex(segment.start)
      if (!map.has(d)) map.set(d, [])
      map.get(d)!.push(segment)
    }
    return [...map.entries()]
  }, [trip.segments])

  const activeRef = useRef<HTMLLIElement | null>(null)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [activeId])

  return (
    <section aria-labelledby="itinerary" className="flex flex-col gap-4">
      <h2 id="itinerary" className="text-[18px] font-bold tracking-[-0.01em]">
        Itinerary
      </h2>
      {days.map(([d, segments]) => {
        const log = trip.logs[d]
        return (
          <div key={d} className="flex flex-col">
            <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between gap-3 bg-canvas/95 px-1 py-2 backdrop-blur-sm">
              <h3 className="text-[14px] font-semibold">
                Day {d + 1}
                <span className="ml-2 font-normal text-body">{formatDay(startDate, d * 1440)}</span>
              </h3>
              <Link
                to={`/trips/${trip.id}/logs?day=${d + 1}`}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium text-body hover:bg-soft hover:text-ink"
              >
                <NotebookIcon size={15} weight="bold" aria-hidden />
                Log sheet{log ? `, ${formatMiles(log.miles)}` : ''}
              </Link>
            </div>
            <ol className="flex flex-col">
              {segments.map((segment, i) =>
                segment.kind === 'drive' ? (
                  <DriveRow key={segment.id} segment={segment} />
                ) : (
                  <StopRow
                    key={segment.id}
                    segment={segment}
                    startDate={startDate}
                    active={segment.id === activeId}
                    onSelect={onSelect}
                    index={i}
                    ref={segment.id === activeId ? activeRef : undefined}
                  />
                ),
              )}
            </ol>
          </div>
        )
      })}
    </section>
  )
}

function DriveRow({ segment }: { segment: Segment }) {
  return (
    <li className="grid grid-cols-[78px_32px_1fr] items-stretch">
      <span />
      <span className="flex justify-center" aria-hidden>
        <span className="w-[3px] rounded-full" style={{ background: segment.leg === 0 ? 'var(--deadhead)' : 'var(--driving)' }} />
      </span>
      <p className="py-2.5 pl-2 text-[13px] text-body">
        Drive <span className="tnum font-medium text-ink">{formatMiles(segment.miles)}</span> in{' '}
        <span className="tnum font-medium text-ink">{formatDuration(segment.end - segment.start)}</span>
        {segment.leg === 0 ? ' to pickup' : ''}
        <span className="block text-[12px] text-mute">to {segment.to.label}</span>
      </p>
    </li>
  )
}

function StopRow({
  segment,
  startDate,
  active,
  onSelect,
  index,
  ref,
}: {
  segment: Segment
  startDate: string
  active: boolean
  onSelect: (id: number) => void
  index: number
  ref?: React.Ref<HTMLLIElement>
}) {
  const Icon = kindInfo(segment.kind).icon
  const duty = DUTY[segment.status]
  return (
    <li ref={ref} className="rise-in" style={{ '--i': index } as React.CSSProperties}>
      <button
        type="button"
        onClick={() => onSelect(segment.id)}
        aria-pressed={active}
        className={`grid w-full grid-cols-[78px_32px_1fr] items-center rounded-xl py-1.5 text-left transition-colors duration-150 ${
          active ? 'bg-soft' : 'hover:bg-softer'
        }`}
      >
        <span className="tnum pl-1 font-mono text-[13px] whitespace-nowrap text-body">{formatClock(startDate, segment.start)}</span>
        <span className="flex justify-center">
          <span className="flex size-7 items-center justify-center rounded-full text-[#fefefd]" style={{ background: duty.color }}>
            <Icon size={15} weight="bold" aria-hidden />
          </span>
        </span>
        <span className="flex min-w-0 items-baseline justify-between gap-3 pr-3 pl-2">
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-medium">{stopTitle(segment)}</span>
            <span className="block truncate text-[13px] text-body">
              {segment.kind === 'pickup' || segment.kind === 'dropoff' ? duty.label : `${segment.from.label}, ${duty.label.toLowerCase()}`}
            </span>
          </span>
          <span className="tnum shrink-0 font-mono text-[13px] text-body">{formatDuration(segment.end - segment.start)}</span>
        </span>
      </button>
    </li>
  )
}
