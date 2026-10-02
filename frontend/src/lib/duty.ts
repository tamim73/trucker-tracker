import {
  ArrowsClockwiseIcon,
  BedIcon,
  ClipboardTextIcon,
  CoffeeIcon,
  FlagCheckeredIcon,
  GasPumpIcon,
  PackageIcon,
  SteeringWheelIcon,
  MoonIcon,
  BriefcaseIcon,
  type Icon,
} from '@phosphor-icons/react'
import type { DutyStatus, LogEntry, Segment, SegmentKind } from './api'

export const DUTY_ORDER: DutyStatus[] = ['off_duty', 'sleeper_berth', 'driving', 'on_duty']

export const DUTY: Record<DutyStatus, { label: string; color: string }> = {
  off_duty: { label: 'Off duty', color: 'var(--off)' },
  sleeper_berth: { label: 'Sleeper berth', color: 'var(--sleeper)' },
  driving: { label: 'Driving', color: 'var(--driving)' },
  on_duty: { label: 'On duty, not driving', color: 'var(--onduty)' },
}

export const KIND: Record<SegmentKind, { title: string; icon: Icon }> = {
  pre_trip: { title: 'Pre-trip inspection', icon: ClipboardTextIcon },
  drive: { title: 'Drive', icon: SteeringWheelIcon },
  pickup: { title: 'Pickup', icon: PackageIcon },
  dropoff: { title: 'Drop-off', icon: FlagCheckeredIcon },
  post_trip: { title: 'Post-trip inspection', icon: ClipboardTextIcon },
  fuel: { title: 'Fuel stop', icon: GasPumpIcon },
  break: { title: '30-minute break', icon: CoffeeIcon },
  rest: { title: '10-hour break', icon: BedIcon },
  restart: { title: '34-hour restart', icon: ArrowsClockwiseIcon },
  off_duty: { title: 'Off duty', icon: MoonIcon },
  sleeper: { title: 'Sleeper berth', icon: BedIcon },
  on_duty: { title: 'On duty', icon: BriefcaseIcon },
}

/** Kind used when the driver sets a period to a status by hand. */
export const GENERIC_KIND: Record<DutyStatus, SegmentKind> = {
  off_duty: 'off_duty',
  sleeper_berth: 'sleeper',
  driving: 'drive',
  on_duty: 'on_duty',
}

/** Stops that get their own marker on the map. */
export const MAP_STOP_KINDS: SegmentKind[] = ['fuel', 'break', 'rest', 'restart']

const UNKNOWN_KIND = { title: 'Duty status change', icon: ClipboardTextIcon }

/** Title and icon for a kind, tolerant of kinds this client does not know. */
export function kindInfo(kind: string): { title: string; icon: Icon } {
  return KIND[kind as SegmentKind] ?? UNKNOWN_KIND
}

/** How each activity is written in the log remarks: [full, short]. */
export const REMARK_ACTIVITY: Record<SegmentKind, [string, string]> = {
  pre_trip: ['Pre-trip inspection', 'Pre-trip'],
  drive: ['Driving', 'Driving'],
  pickup: ['Pickup, loading', 'Pickup'],
  dropoff: ['Drop-off, unloading', 'Drop-off'],
  post_trip: ['Post-trip inspection', 'Post-trip'],
  fuel: ['Fuel', 'Fuel'],
  break: ['30-min break', 'Break'],
  rest: ['10-hr break (SB)', '10-hr SB'],
  restart: ['34-hr restart', 'Restart'],
  off_duty: ['Off duty', 'Off duty'],
  sleeper: ['Sleeper berth', 'SB'],
  on_duty: ['On duty', 'On duty'],
}

/** Remark text for an entry: what the driver wrote, otherwise its activity. */
export function remarkText(entry: Pick<LogEntry, 'kind' | 'note'>): [string, string] {
  if (entry.note) return [entry.note, entry.note]
  return REMARK_ACTIVITY[entry.kind] ?? ['Duty status change', 'Change']
}

/** What an entry is called in lists. */
export function entryLabel(entry: Pick<LogEntry, 'kind' | 'note'>) {
  return entry.note || (entry.kind === 'drive' ? 'Driving' : kindInfo(entry.kind).title)
}

export function stopTitle(segment: Segment) {
  if (segment.kind === 'pickup') return `Pickup at ${segment.from.label}`
  if (segment.kind === 'dropoff') return `Drop-off at ${segment.from.label}`
  return kindInfo(segment.kind).title
}
