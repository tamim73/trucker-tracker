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

/** Kinds created by hand in the log editor; their note names the activity. */
export const NOTE_KINDS: SegmentKind[] = ['off_duty', 'sleeper', 'on_duty']

/** What an entry is called in lists: the driver's note for hand-made entries, otherwise its activity. */
export function entryLabel(entry: Pick<LogEntry, 'kind' | 'note'>) {
  if (NOTE_KINDS.includes(entry.kind) && entry.note) return entry.note
  return entry.kind === 'drive' ? 'Driving' : kindInfo(entry.kind).title
}

export function stopTitle(segment: Segment) {
  if (segment.kind === 'pickup') return `Pickup at ${segment.from.label}`
  if (segment.kind === 'dropoff') return `Drop-off at ${segment.from.label}`
  return kindInfo(segment.kind).title
}
