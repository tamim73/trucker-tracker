import { describe, expect, it } from 'vitest'
import type { DutyStatus, LogEntry } from './api'
import { fromTimeValue, insertChange, moveBoundary, normalize, paint, removeEntry, setStatus, toTimeValue, totals } from './logEdit'

function entry(status: DutyStatus, start: number, end: number, extra: Partial<LogEntry> = {}): LogEntry {
  const kind = status === 'driving' ? 'drive' : status === 'sleeper_berth' ? 'sleeper' : status
  return { status, kind, start, end, note: '', location: 'Joliet, IL', miles: 0, ...extra }
}

/** Off duty to 6:00, on duty 6:00-6:15, driving 6:15-14:15, off duty after. */
const day = (): LogEntry[] => [
  entry('off_duty', 0, 360),
  entry('on_duty', 360, 375, { kind: 'pre_trip' }),
  entry('driving', 375, 855, { miles: 440 }),
  entry('off_duty', 855, 1440),
]

function covers24h(entries: LogEntry[]) {
  expect(entries[0].start).toBe(0)
  expect(entries[entries.length - 1].end).toBe(1440)
  entries.slice(1).forEach((e, i) => expect(e.start).toBe(entries[i].end))
}

function noSameStatusNeighbors(entries: LogEntry[]) {
  entries.slice(1).forEach((e, i) => expect(e.status).not.toBe(entries[i].status))
}

describe('normalize', () => {
  it('joins neighbors on the same status and drops empty entries', () => {
    const merged = normalize([
      entry('on_duty', 0, 60, { note: 'Fuel' }),
      entry('on_duty', 60, 120, { note: 'Inspection' }),
      entry('driving', 120, 120),
      entry('off_duty', 120, 1440),
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ start: 0, end: 120, note: 'Fuel; Inspection', kind: 'on_duty' })
  })
})

describe('paint', () => {
  it('draws a period on a status and keeps 24 hours covered', () => {
    const next = paint(day(), 'sleeper_berth', 900, 1440)
    covers24h(next)
    noSameStatusNeighbors(next)
    expect(totals(next).sleeper_berth).toBe(540)
  })

  it('splits driving miles in proportion to time', () => {
    const next = paint(day(), 'off_duty', 615, 855)
    const driving = next.find((e) => e.status === 'driving')!
    expect(driving.end).toBe(615)
    expect(driving.miles).toBe(220)
  })

  it('ignores empty ranges', () => {
    const entries = day()
    expect(paint(entries, 'driving', 600, 600)).toBe(entries)
  })
})

describe('moveBoundary', () => {
  it('moves a change of status on the 15-minute grid', () => {
    const next = moveBoundary(day(), 3, 902)
    expect(next[2].end).toBe(900)
    expect(next[3].start).toBe(900)
    covers24h(next)
  })

  it('removes the piece in between when dropped on the next change', () => {
    const next = moveBoundary(day(), 1, 375)
    expect(next.map((e) => e.status)).toEqual(['off_duty', 'driving', 'off_duty'])
    covers24h(next)
  })

  it('does not move the start of the day', () => {
    const entries = day()
    expect(moveBoundary(entries, 0, 30)).toBe(entries)
  })
})

describe('setStatus', () => {
  it('merges with neighbors that now have the same status', () => {
    const next = setStatus(day(), 1, 'off_duty')
    expect(next.map((e) => e.status)).toEqual(['off_duty', 'driving', 'off_duty'])
    expect(next[0]).toMatchObject({ start: 0, end: 375 })
  })

  it('clears the old activity note and miles', () => {
    const next = setStatus(day(), 2, 'on_duty')
    const changed = next.find((e) => e.start <= 375 && e.end >= 855)!
    expect(changed.miles).toBe(0)
  })
})

describe('insertChange', () => {
  it('adds a different status halfway through an entry', () => {
    const next = insertChange(day(), 3)
    covers24h(next)
    expect(next.at(-1)).toMatchObject({ status: 'on_duty', end: 1440 })
    expect(next.at(-2)).toMatchObject({ status: 'off_duty', start: 855 })
  })

  it('refuses entries too short to split', () => {
    const entries = day()
    expect(insertChange(entries, 1)).toBe(entries)
  })
})

describe('removeEntry', () => {
  it('gives the removed time to the previous entry', () => {
    const next = removeEntry(day(), 1)
    covers24h(next)
    noSameStatusNeighbors(next)
    expect(next[0]).toMatchObject({ status: 'off_duty', end: 375 })
  })

  it('gives the first entry time to the next one', () => {
    const next = removeEntry(day(), 0)
    expect(next[0]).toMatchObject({ status: 'on_duty', start: 0 })
  })
})

describe('time inputs', () => {
  it('formats and parses times on the grid', () => {
    expect(toTimeValue(375)).toBe('06:15')
    expect(toTimeValue(1440)).toBe('23:59')
    expect(fromTimeValue('06:20')).toBe(375)
    expect(fromTimeValue('nonsense')).toBeNull()
  })
})
