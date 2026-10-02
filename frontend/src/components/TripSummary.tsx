import { ArrowRightIcon, CheckCircleIcon, InfoIcon, WarningCircleIcon } from '@phosphor-icons/react'
import type { ComplianceCheck, Trip } from '../lib/api'
import { formatClock, formatDay, formatDayClock, formatDuration, formatHM, formatHours, formatMiles, formatNumber } from '../lib/format'

export function TripHeading({ trip }: { trip: Trip }) {
  const { current, pickup, dropoff } = trip.places
  return (
    <div className="flex flex-col gap-2">
      <h1 className="flex flex-wrap items-center gap-x-2 text-[26px] leading-8 font-bold tracking-[-0.02em]">
        <span>{current.label}</span>
        <ArrowRightIcon size={20} weight="bold" className="text-mute" aria-label="to" />
        <span>{dropoff.label}</span>
      </h1>
      <p className="text-[15px] text-body">
        Pickup in <span className="font-medium text-ink">{pickup.label}</span>, departing{' '}
        {formatDayClock(trip.summary.start_date, trip.summary.start_minute)}
      </p>
    </div>
  )
}

export function TripStats({ trip }: { trip: Trip }) {
  const s = trip.summary
  const stats = [
    { label: 'Distance', value: formatMiles(s.total_miles), note: `${formatNumber(s.average_mph)} mph average` },
    { label: 'Driving', value: formatHours(s.driving_minutes), note: `${s.days} log ${s.days === 1 ? 'sheet' : 'sheets'}` },
    { label: 'Trip time', value: formatDuration(s.elapsed_minutes), note: 'Departure to post-trip' },
    { label: 'Drop-off', value: formatClock(s.start_date, s.dropoff_minute), note: `Arrive ${formatDay(s.start_date, s.dropoff_minute)}` },
  ]
  const stopParts = [
    s.fuel_stops && `${s.fuel_stops} fuel ${s.fuel_stops === 1 ? 'stop' : 'stops'}`,
    s.breaks && `${s.breaks} 30-minute ${s.breaks === 1 ? 'break' : 'breaks'}`,
    s.rests && `${s.rests} 10-hour ${s.rests === 1 ? 'break' : 'breaks'}`,
    s.restarts && `${s.restarts} 34-hour restart`,
  ].filter(Boolean)

  return (
    <section aria-label="Trip totals" className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-hairline">
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className={`flex min-w-0 flex-col gap-0.5 p-4 ${i % 2 ? 'border-l border-hairline' : ''} ${i > 1 ? 'border-t border-hairline' : ''}`}
          >
            <dt className="text-[13px] text-body">{stat.label}</dt>
            <dd className="tnum truncate text-[22px] leading-7 font-semibold tracking-[-0.01em]">{stat.value}</dd>
            <dd className="truncate text-[12px] text-mute">{stat.note}</dd>
          </div>
        ))}
      </dl>
      {stopParts.length > 0 && <p className="text-[14px] text-body">Planned stops: {stopParts.join(', ')}.</p>}
      {s.estimated_route && (
        <p className="flex items-start gap-2 rounded-2xl bg-soft px-4 py-3 text-[14px] text-body" role="status">
          <InfoIcon size={18} weight="bold" className="mt-px shrink-0" aria-hidden />
          The routing service did not respond, so distances are straight-line estimates with a road factor.
        </p>
      )}
    </section>
  )
}

function checkValue(c: ComplianceCheck) {
  if (c.unit === 'miles') return `${formatNumber(c.value)} of ${formatNumber(c.limit)} mi`
  return `${formatHM(c.value)} of ${formatHM(c.limit)}`
}

export function ComplianceList({ checks, edited }: { checks: ComplianceCheck[]; edited?: boolean }) {
  const allOk = checks.every((c) => c.ok)
  return (
    <section aria-labelledby="hos-check" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="hos-check" className="text-[18px] font-bold tracking-[-0.01em]">
          Hours of service check
        </h2>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium ${
            allOk ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'
          }`}
        >
          {allOk ? <CheckCircleIcon size={16} weight="fill" aria-hidden /> : <WarningCircleIcon size={16} weight="fill" aria-hidden />}
          {allOk ? 'All limits met' : 'Limit exceeded'}
        </span>
      </div>
      <ul className="flex flex-col">
        {checks.map((c) => (
          <li key={c.key} className="flex items-start gap-3 py-2.5">
            {c.ok ? (
              <CheckCircleIcon size={20} weight="fill" className="mt-px shrink-0 text-accent" aria-label="Met" />
            ) : (
              <WarningCircleIcon size={20} weight="fill" className="mt-px shrink-0 text-danger" aria-label="Exceeded" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-5 font-medium">{c.title}</p>
              <p className="text-[12px] text-mute">{c.rule.startsWith('395') ? `49 CFR ${c.rule}` : c.rule}</p>
            </div>
            <p className="tnum shrink-0 font-mono text-[13px] text-body">{checkValue(c)}</p>
          </li>
        ))}
      </ul>
      <p className="text-[13px] text-body">
        {edited
          ? 'Includes the driver\'s edits to the daily logs. '
          : ''}
        Worst case across the trip. Driving windows reset after 10 hours off duty, the cycle after a 34-hour restart.
      </p>
    </section>
  )
}
