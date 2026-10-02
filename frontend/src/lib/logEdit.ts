import type { DailyLog, DutyStatus, LogEntry } from './api'
import { GENERIC_KIND } from './duty'
import { DAY } from './format'

export { DAY }

/** Pure edits on one day's duty status entries. All times are minutes from
 *  midnight on the 15-minute grid, and entries always cover 0 to 1440. */

export const STEP = 15

export const snap = (minute: number) => Math.min(DAY, Math.max(0, Math.round(minute / STEP) * STEP))

const NOTE_LIMIT = 160

/**
 * Drops empty entries and joins neighbors on the same duty status, so the
 * line only has a point where it changes rows. The joined entry keeps the
 * first location and both notes.
 */
export function normalize(entries: LogEntry[]): LogEntry[] {
  const out: LogEntry[] = []
  for (const e of entries) {
    if (e.end <= e.start) continue
    const last = out[out.length - 1]
    if (last && last.status === e.status) {
      const notes = [...new Set([last.note, e.note].filter(Boolean))].join('; ')
      out[out.length - 1] = {
        ...last,
        end: e.end,
        kind: last.kind === e.kind ? last.kind : GENERIC_KIND[e.status],
        note: notes.length > NOTE_LIMIT ? `${notes.slice(0, NOTE_LIMIT - 1)}…` : notes,
        location: last.location || e.location,
        miles: Math.round((last.miles + e.miles) * 10) / 10,
      }
    } else {
      out.push({ ...e })
    }
  }
  return out
}

function locationAt(entries: LogEntry[], minute: number) {
  const hit = entries.find((e) => e.start <= minute && minute < e.end) ?? entries[entries.length - 1]
  return hit?.location ?? ''
}

/** Sets [from, to) to one duty status, like drawing a new line on paper. */
export function paint(entries: LogEntry[], status: DutyStatus, from: number, to: number): LogEntry[] {
  if (to <= from) return entries
  const location = locationAt(entries, from)
  const out: LogEntry[] = []
  for (const e of entries) {
    if (e.end <= from || e.start >= to) {
      out.push(e)
      continue
    }
    if (e.start < from) out.push({ ...e, end: from, miles: share(e, e.start, from) })
    if (e.end > to) out.push({ ...e, start: to, miles: share(e, to, e.end) })
  }
  const piece: LogEntry = { status, kind: GENERIC_KIND[status], start: from, end: to, note: '', location, miles: 0 }
  // Repaint with the status that is already there keeps the original entry's details.
  const covering = entries.find((e) => e.start <= from && to <= e.end)
  out.push(covering && covering.status === status ? { ...covering, start: from, end: to, miles: share(covering, from, to) } : piece)
  return normalize(out.sort((a, b) => a.start - b.start))
}

function share(e: LogEntry, start: number, end: number) {
  const span = e.end - e.start
  return span ? Math.round(((e.miles * (end - start)) / span) * 10) / 10 : 0
}

/**
 * Moves the change of duty status at the start of entries[index]. Dragging it
 * onto the next or previous change removes the entry in between.
 */
export function moveBoundary(entries: LogEntry[], index: number, minute: number): LogEntry[] {
  if (index <= 0 || index >= entries.length) return entries
  const prev = entries[index - 1]
  const cur = entries[index]
  const at = Math.min(cur.end, Math.max(prev.start, snap(minute)))
  if (at === cur.start) return entries
  const next = [...entries]
  next[index - 1] = { ...prev, end: at, miles: share(prev, prev.start, Math.min(at, prev.end)) }
  next[index] = { ...cur, start: at, miles: share(cur, Math.max(at, cur.start), cur.end) }
  return normalize(next)
}

/** Moves entries[index] up or down to another duty status row. */
export function setStatus(entries: LogEntry[], index: number, status: DutyStatus): LogEntry[] {
  const e = entries[index]
  if (!e || e.status === status) return entries
  const next = [...entries]
  next[index] = { ...e, status, kind: GENERIC_KIND[status], note: '', miles: 0 }
  return normalize(next)
}

export function updateEntry(entries: LogEntry[], index: number, patch: Partial<Pick<LogEntry, 'location' | 'note'>>) {
  const next = [...entries]
  next[index] = { ...next[index], ...patch }
  return next
}

/**
 * Adds a change of duty status halfway through entries[index]: the second
 * half gets a different status, which the driver can then set. Gives keyboard
 * and screen-reader users a way to add a period without drawing.
 */
export function insertChange(entries: LogEntry[], index: number): LogEntry[] {
  const e = entries[index]
  if (!e || e.end - e.start < 2 * STEP) return entries
  const mid = Math.round((e.start + e.end) / 2 / STEP) * STEP
  const status: DutyStatus = e.status === 'on_duty' ? 'off_duty' : 'on_duty'
  return paint(entries, status, mid, e.end)
}

export function removeEntry(entries: LogEntry[], index: number): LogEntry[] {
  if (entries.length <= 1) return entries
  const next = [...entries]
  const [gone] = next.splice(index, 1)
  if (index > 0) next[index - 1] = { ...next[index - 1], end: gone.end }
  else next[0] = { ...next[0], start: 0 }
  return normalize(next)
}

export function totals(entries: LogEntry[]): Record<DutyStatus, number> {
  const t: Record<DutyStatus, number> = { off_duty: 0, sleeper_berth: 0, driving: 0, on_duty: 0 }
  for (const e of entries) t[e.status] += e.end - e.start
  return t
}

/** The sheet as it would look with these entries; server preview fills the rest. */
export function draftLog(base: DailyLog, entries: LogEntry[], miles: number, previousStatus: DutyStatus | null): DailyLog {
  return {
    ...base,
    entries,
    miles,
    totals: totals(entries),
    remarks: entries
      .filter((e, i) => !(i === 0 && (base.index === 0 || e.status === previousStatus)))
      .map((e) => ({ minute: e.start, end_minute: e.end, status: e.status, kind: e.kind, location: e.location, note: e.note })),
  }
}

/** Older saved trips have no per-entry location: take it from the remarks. */
export function withLocations(log: DailyLog): LogEntry[] {
  let last = log.from
  return log.entries.map((e) => {
    const remark = log.remarks.find((r) => r.minute === e.start)
    const location = e.location ?? remark?.location ?? last
    last = location
    return { ...e, location }
  })
}

export function toTimeValue(minute: number) {
  const m = Math.min(minute, DAY - 1)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function fromTimeValue(value: string) {
  const [h, m] = value.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? snap(h * 60 + m) : null
}
