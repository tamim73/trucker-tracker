const DAY = 24 * 60

const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const longDateFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
const milesFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const decimalFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/** Trip times are wall-clock minutes from midnight of the first log day. */
export function tripDate(startDate: string, minute: number): Date {
  const [y, m, d] = startDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + minute * 60_000)
}

export function formatDay(startDate: string, minute: number) {
  return dateFmt.format(tripDate(startDate, minute))
}

export function formatLongDate(isoDate: string) {
  return longDateFmt.format(tripDate(isoDate, 0))
}

export function formatClock(startDate: string, minute: number) {
  return timeFmt.format(tripDate(startDate, minute))
}

export function formatDayClock(startDate: string, minute: number) {
  return `${formatDay(startDate, minute)}, ${formatClock(startDate, minute)}`
}

export function dayIndex(minute: number) {
  return Math.floor(minute / DAY)
}

/** 135 -> "2h 15m" */
export function formatDuration(minutes: number) {
  const days = Math.floor(minutes / DAY)
  const hours = Math.floor((minutes % DAY) / 60)
  const mins = minutes % 60
  const parts = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (mins || parts.length === 0) parts.push(`${mins}m`)
  return parts.join(' ')
}

/** 1875 -> "31h 15m", for driving totals where days would mislead. */
export function formatHours(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/** 135 -> "2:15", used on the log grid and for HOS totals. */
export function formatHM(minutes: number) {
  const sign = minutes < 0 ? '-' : ''
  const abs = Math.abs(Math.round(minutes))
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`
}

export function formatMiles(miles: number) {
  return `${milesFmt.format(miles)} mi`
}

export function formatNumber(value: number) {
  return decimalFmt.format(value)
}

export function hoursLabel(minutes: number) {
  return `${decimalFmt.format(minutes / 60)} h`
}

/** Next quarter hour from now, as a datetime-local value. */
export function defaultDeparture(now = new Date()) {
  const d = new Date(now)
  d.setSeconds(0, 0)
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
