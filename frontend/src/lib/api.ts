export type DutyStatus = 'off_duty' | 'sleeper_berth' | 'driving' | 'on_duty'
export type SegmentKind =
  | 'pre_trip'
  | 'drive'
  | 'pickup'
  | 'dropoff'
  | 'post_trip'
  | 'fuel'
  | 'break'
  | 'rest'
  | 'restart'
  | 'off_duty'
  | 'sleeper'
  | 'on_duty'

export interface Place {
  id?: string
  label: string
  name?: string
  detail?: string
  kind?: string
  lat: number
  lon: number
}

export interface PlaceDraft {
  label: string
  lat?: number | null
  lon?: number | null
}

export interface DriverDetails {
  name: string
  co_driver: string
  carrier: string
  main_office: string
  home_terminal: string
  vehicle_numbers: string
  shipping_document: string
  commodity: string
}

export interface TripRequest {
  current: PlaceDraft
  pickup: PlaceDraft
  dropoff: PlaceDraft
  cycle_used_hours: number
  departure: string
  driver: DriverDetails
}

export interface Segment {
  id: number
  status: DutyStatus
  kind: SegmentKind
  start: number
  end: number
  note: string
  miles: number
  odometer: number
  from: Place
  to: Place
  leg: number | null
}

export interface LogEntry {
  status: DutyStatus
  kind: SegmentKind
  start: number
  end: number
  note: string
  location: string
  miles: number
  continued?: boolean
}

export interface Violation {
  key: string
  title: string
  start: number
  end: number
}

export interface LogRemark {
  minute: number
  end_minute: number
  status: DutyStatus
  kind: SegmentKind
  location: string
  note: string
}

export interface DailyLog {
  index: number
  date: string
  entries: LogEntry[]
  totals: Record<DutyStatus, number>
  miles: number
  from: string
  to: string
  remarks: LogRemark[]
  recap: {
    on_duty_today: number
    last_7_days: number
    available_tomorrow: number
    last_8_days: number
    restart_completed: boolean
  }
  violations?: Violation[]
  edit?: LogEditRecord
  edits?: LogEditRecord[]
  total_mileage?: number
}

export interface LogEditRecord {
  reason: string
  edited_at: string
}

export interface LogEdit {
  entries: LogEntry[]
  miles: number
  total_mileage: number
  from_place: string
  to_place: string
  reason: string
  driver: DriverDetails
}

export interface ComplianceCheck {
  key: string
  title: string
  value: number
  limit: number
  unit: 'minutes' | 'miles'
  rule: string
  ok: boolean
  /** "plan" when the check describes the route plan rather than edited logs. */
  basis?: 'plan'
}

export interface RouteLeg {
  from: string
  to: string
  miles: number
  router_minutes: number
  planned_mph: number
  geometry: [number, number][]
}

export interface Trip {
  id: string
  created_at: string
  /** Returned once, when the trip is created. Required to edit its logs. */
  edit_token?: string
  inputs: TripRequest & { current: Place; pickup: Place; dropoff: Place }
  places: { current: Place; pickup: Place; dropoff: Place }
  summary: {
    start_date: string
    start_minute: number
    end_minute: number
    pickup_minute: number
    dropoff_minute: number
    total_miles: number
    driving_minutes: number
    on_duty_minutes: number
    rest_minutes: number
    elapsed_minutes: number
    days: number
    average_mph: number
    fuel_stops: number
    breaks: number
    rests: number
    restarts: number
    cycle_used_start: number
    estimated_route: boolean
  }
  route: { bbox: [number, number, number, number] | null; legs: RouteLeg[] }
  segments: Segment[]
  logs: DailyLog[]
  compliance: ComplianceCheck[]
  violations?: Violation[]
  edited?: boolean
  rules: {
    max_driving: number
    duty_window: number
    driving_before_break: number
    cycle_limit: number
    fuel_interval_miles: number
    max_speed_mph: number
  }
}

export class ApiError extends Error {
  status: number
  fields: Record<string, string>
  constructor(message: string, status: number, fields: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.fields = fields
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch (err) {
    if (init?.signal?.aborted) throw err
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (err) {
    // A request cancelled while the body streams must stay a cancellation.
    if (init?.signal?.aborted) throw err
    if (response.ok) throw new ApiError('The server sent an unreadable response. Try again.', response.status)
    body = {}
  }

  if (!response.ok) {
    const data = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
    const fields: Record<string, string> = {}
    if (data.fields && typeof data.fields === 'object') Object.assign(fields, data.fields)
    for (const [key, value] of Object.entries(data)) {
      if (key !== 'detail' && key !== 'fields') {
        fields[key] = Array.isArray(value) ? String(value[0]) : typeof value === 'object' ? 'Check this field.' : String(value)
      }
    }
    const detail = typeof data.detail === 'string' ? data.detail : 'Something went wrong. Try again.'
    throw new ApiError(detail, response.status, fields)
  }
  return body as T
}

function assertTrip(value: Trip): Trip {
  if (!value || typeof value.id !== 'string' || !Array.isArray(value.logs) || !Array.isArray(value.segments)) {
    throw new ApiError('The server sent an incomplete trip. Try again.', 0)
  }
  return value
}

/*
  Edit tokens: the server returns a trip's token only to the client that
  created it. They are kept in this browser so the creator can edit the logs;
  anyone else with the link gets a read-only view.
*/
const TOKENS_KEY = 'trip-planner-edit-tokens'

function readTokens(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveToken(id: string, token: string) {
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify({ ...readTokens(), [id]: token }))
  } catch {
    /* storage unavailable: the trip stays editable until the page reloads */
  }
}

const sessionTokens = new Map<string, string>()

export function editToken(id: string): string | undefined {
  return sessionTokens.get(id) ?? readTokens()[id]
}

function editHeaders(id: string): HeadersInit {
  const token = editToken(id)
  return token ? { 'X-Edit-Token': token } : {}
}

const tripCache = new Map<string, Trip>()

export const api = {
  searchPlaces(query: string, signal?: AbortSignal) {
    return request<{ results: Place[] }>(`/api/places/search?q=${encodeURIComponent(query)}`, { signal })
  },
  reverse(lat: number, lon: number) {
    return request<{ label: string; lat: number; lon: number }>(`/api/places/reverse?lat=${lat}&lon=${lon}`)
  },
  async createTrip(body: TripRequest) {
    const trip = assertTrip(await request<Trip>('/api/trips', { method: 'POST', body: JSON.stringify(body) }))
    if (trip.edit_token) {
      sessionTokens.set(trip.id, trip.edit_token)
      saveToken(trip.id, trip.edit_token)
    }
    tripCache.set(trip.id, trip)
    return trip
  },
  async saveLog(id: string, day: number, edit: LogEdit) {
    const trip = assertTrip(
      await request<Trip>(`/api/trips/${encodeURIComponent(id)}/logs/${day}`, {
        method: 'PUT',
        body: JSON.stringify(edit),
        headers: editHeaders(id),
      }),
    )
    tripCache.set(trip.id, trip)
    return trip
  },
  async previewLog(id: string, day: number, edit: Omit<LogEdit, 'reason'>, signal?: AbortSignal) {
    return assertTrip(
      await request<Trip>(`/api/trips/${encodeURIComponent(id)}/logs/${day}/preview`, {
        method: 'POST',
        body: JSON.stringify(edit),
        headers: editHeaders(id),
        signal,
      }),
    )
  },
  async revertLog(id: string, day: number) {
    const trip = assertTrip(
      await request<Trip>(`/api/trips/${encodeURIComponent(id)}/logs/${day}`, { method: 'DELETE', headers: editHeaders(id) }),
    )
    tripCache.set(trip.id, trip)
    return trip
  },
  /** The trip as last seen in this session, for an instant first render. */
  cachedTrip(id: string) {
    return tripCache.get(id)
  },
  async getTrip(id: string, signal?: AbortSignal) {
    const trip = assertTrip(await request<Trip>(`/api/trips/${encodeURIComponent(id)}`, { signal }))
    tripCache.set(trip.id, trip)
    return trip
  },
}
