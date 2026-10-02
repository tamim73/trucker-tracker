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
import type { DutyStatus, Segment, SegmentKind } from './api'

export const DUTY_ORDER: DutyStatus[] = ['off_duty', 'sleeper_berth', 'driving', 'on_duty']

export const DUTY: Record<DutyStatus, { label: string; short: string; line: string; color: string }> = {
  off_duty: { label: 'Off duty', short: 'OFF', line: '1. Off Duty', color: 'var(--off)' },
  sleeper_berth: { label: 'Sleeper berth', short: 'SB', line: '2. Sleeper Berth', color: 'var(--sleeper)' },
  driving: { label: 'Driving', short: 'D', line: '3. Driving', color: 'var(--driving)' },
  on_duty: { label: 'On duty, not driving', short: 'ON', line: '4. On Duty', color: 'var(--onduty)' },
}

export const KIND: Record<SegmentKind, { title: string; short: string; icon: Icon }> = {
  pre_trip: { title: 'Pre-trip inspection', short: 'Pre-trip', icon: ClipboardTextIcon },
  drive: { title: 'Drive', short: 'Driving', icon: SteeringWheelIcon },
  pickup: { title: 'Pickup', short: 'Pickup', icon: PackageIcon },
  dropoff: { title: 'Drop-off', short: 'Drop-off', icon: FlagCheckeredIcon },
  post_trip: { title: 'Post-trip inspection', short: 'Post-trip', icon: ClipboardTextIcon },
  fuel: { title: 'Fuel stop', short: 'Fuel', icon: GasPumpIcon },
  break: { title: '30-minute break', short: '30-min break', icon: CoffeeIcon },
  rest: { title: '10-hour break', short: '10-hr break', icon: BedIcon },
  restart: { title: '34-hour restart', short: '34-hr restart', icon: ArrowsClockwiseIcon },
  off_duty: { title: 'Off duty', short: 'Off duty', icon: MoonIcon },
  sleeper: { title: 'Sleeper berth', short: 'Sleeper', icon: BedIcon },
  on_duty: { title: 'On duty', short: 'On duty', icon: BriefcaseIcon },
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

export function stopTitle(segment: Segment) {
  if (segment.kind === 'pickup') return `Pickup at ${segment.from.label}`
  if (segment.kind === 'dropoff') return `Drop-off at ${segment.from.label}`
  return KIND[segment.kind].title
}
