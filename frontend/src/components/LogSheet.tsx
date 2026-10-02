import { memo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { DailyLog, DriverDetails, DutyStatus, LogEntry, LogRemark, SegmentKind } from '../lib/api'
import { DUTY, DUTY_ORDER } from '../lib/duty'
import { formatHM, formatNumber } from '../lib/format'
import { DAY, STEP } from '../lib/logEdit'

/*
  A recreation of the FMCSA paper "Driver's Daily Log (24 hours)" from the
  Interstate Truck Driver's Guide to Hours of Service: header, 24-hour grid
  with the four duty-status lines, remarks with locations at every change of
  duty status, shipping documents, and the 70-hour / 8-day recap.
*/

const W = 1100
const H = 860
const GX = 136 // grid left
const GW = 864 // 24 h x 36 px
const HOUR = GW / 24
const GT = 280 // grid top
const RH = 34 // row height
const GB = GT + RH * 4
const TX = GX + GW // totals column left
const RB = GB + 52 // remarks baseline

const PAPER = '#fefefd'
const PRINT = '#1b1b1b'
const RULE = '#3b3b3b'
const FAINT = '#8a8a86'
const PEN = '#1f3a93'

const ACTIVITY: Record<SegmentKind, [string, string]> = {
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
const NOTE_KINDS: SegmentKind[] = ['off_duty', 'sleeper', 'on_duty']
const VIOLATION_LABEL: Record<string, string> = {
  driving: 'Over 11 hr driving',
  window: 'Past 14-hr window',
  break: 'No 30-min break',
  cycle: 'Over 70-hr cycle',
}
const DANGER = '#c0262d'
const LINE_CHARS = 30

function clip(text: string) {
  return text.length > LINE_CHARS ? `${text.slice(0, LINE_CHARS - 1).trimEnd()}…` : text
}

const ROW_LABEL: Record<DutyStatus, [string, string?]> = {
  off_duty: ['1. Off Duty'],
  sleeper_berth: ['2. Sleeper', 'Berth'],
  driving: ['3. Driving'],
  on_duty: ['4. On Duty', '(not driving)'],
}

const x = (minute: number) => GX + (minute / 60) * HOUR
const rowY = (status: DutyStatus) => GT + DUTY_ORDER.indexOf(status) * RH + RH / 2

export interface SheetEditing {
  /** Called once when a drag or key edit begins (records undo, fixes the drag base). */
  onEditStart: () => void
  onEditEnd: () => void
  onPaint: (status: DutyStatus, from: number, to: number) => void
  onMoveBoundary: (index: number, minute: number) => void
  onNudgeBoundary: (index: number, delta: number) => void
  onMoveSegment: (index: number, status: DutyStatus) => void
  onNudgeSegment: (index: number, direction: 1 | -1) => void
}

export type DayField = 'from' | 'to' | 'miles' | 'totalMileage'

/** Header and shipping fields typed straight onto the sheet. */
export interface HeaderEditing {
  day: Record<DayField, string>
  onDayChange: (field: DayField, value: string) => void
  onDriverChange: (field: keyof DriverDetails, value: string) => void
}

interface Props {
  log: DailyLog
  driver: DriverDetails
  dayCount: number
  animate?: boolean
  highlight?: number | null
  editing?: SheetEditing
  header?: HeaderEditing
}

interface FieldEdit {
  value: string
  onChange: (value: string) => void
  label: string
  numeric?: boolean
}

function SheetInput({ x, y, width, height, edit, size = 15, align = 'left', weight = 500 }: {
  x: number
  y: number
  width: number
  height: number
  edit: FieldEdit
  size?: number
  align?: 'left' | 'center'
  weight?: number
}) {
  return (
    <foreignObject x={x} y={y} width={width} height={height}>
      <input
        type="text"
        inputMode={edit.numeric ? 'decimal' : undefined}
        autoComplete="off"
        spellCheck={false}
        maxLength={edit.numeric ? 7 : 160}
        aria-label={edit.label}
        placeholder={edit.label}
        value={edit.value}
        onChange={(e) => edit.onChange(e.target.value)}
        className="sheet-input"
        style={{ fontSize: size, textAlign: align, fontWeight: weight }}
      />
    </foreignObject>
  )
}

interface RemarkGroup {
  minute: number
  location: string
  labels: [string, string][]
}

function remarkLabel(r: LogRemark): [string, string] {
  if (NOTE_KINDS.includes(r.kind) && r.note) return [r.note, r.note]
  return ACTIVITY[r.kind] ?? [r.note, r.note]
}

/** One label per place: changes at the same location within two hours share it. */
function groupRemarks(remarks: LogRemark[]): RemarkGroup[] {
  const groups: RemarkGroup[] = []
  for (const r of remarks) {
    const last = groups[groups.length - 1]
    const label = remarkLabel(r)
    if (last && last.location === r.location && r.minute - last.minute <= 120) {
      if (!last.labels.some((l) => l[0] === label[0])) last.labels.push(label)
    } else {
      groups.push({ minute: r.minute, location: r.location, labels: [label] })
    }
  }
  return groups
}

function activityText(labels: [string, string][]) {
  const full = labels.map((l) => l[0]).join(', ')
  return clip(full.length <= LINE_CHARS ? full : labels.map((l) => l[1]).join(', '))
}

function dutyPath(log: DailyLog) {
  let d = ''
  log.entries.forEach((e, i) => {
    const y = rowY(e.status)
    d += i === 0 ? `M${x(e.start)},${y}` : `V${y}`
    d += `H${x(e.end)}`
  })
  return d
}

function Field({
  x1,
  x2,
  y,
  value,
  label,
  align = 'start',
  edit,
}: {
  x1: number
  x2: number
  y: number
  value?: string
  label: string
  align?: 'start' | 'middle'
  edit?: FieldEdit
}) {
  const vx = align === 'middle' ? (x1 + x2) / 2 : x1 + 6
  return (
    <g>
      {edit ? (
        <SheetInput x={x1} y={y - 25} width={x2 - x1} height={23} edit={edit} />
      ) : value ? (
        <text x={vx} y={y - 6} fill={PEN} fontSize={15} fontWeight={500} textAnchor={align}>
          {value}
        </text>
      ) : null}
      <line x1={x1} x2={x2} y1={y} y2={y} stroke={RULE} strokeWidth={1} />
      <text x={(x1 + x2) / 2} y={y + 13} fill={PRINT} fontSize={10.5} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

function Box({ x1, y1, w, h, value, label, edit }: { x1: number; y1: number; w: number; h: number; value: string; label: ReactNode; edit?: FieldEdit }) {
  return (
    <g>
      <rect x={x1} y={y1} width={w} height={h} fill="none" stroke={RULE} strokeWidth={1} />
      {edit ? (
        <SheetInput x={x1 + 3} y={y1 + 3} width={w - 6} height={h - 6} edit={edit} size={17} align="center" weight={600} />
      ) : (
        <text x={x1 + w / 2} y={y1 + h / 2 + 6} fill={PEN} fontSize={17} fontWeight={600} textAnchor="middle">
          {value}
        </text>
      )}
      <text x={x1 + w / 2} y={y1 + h + 13} fill={PRINT} fontSize={10.5} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

export const LogSheet = memo(function LogSheet({ log, driver, dayCount, animate = true, highlight, editing, header }: Props) {
  const dayEdit = (field: DayField, label: string, numeric = false): FieldEdit | undefined =>
    header && { value: header.day[field], onChange: (v) => header.onDayChange(field, v), label, numeric }
  const driverEdit = (field: keyof DriverDetails, label: string): FieldEdit | undefined =>
    header && { value: driver[field], onChange: (v) => header.onDriverChange(field, v), label }
  const [year, month, day] = log.date.split('-')
  const groups = groupRemarks(log.remarks)
  const stops = log.entries.filter((e) => e.status !== 'driving' && !(e.kind === 'off_duty'))
  const total = DUTY_ORDER.reduce((sum, s) => sum + log.totals[s], 0)
  const r = log.recap

  // Keep rotated remark labels from overprinting each other.
  const placed: (RemarkGroup & { tick: number; lx: number })[] = []
  for (const g of groups) {
    const tick = x(g.minute)
    const previous = placed[placed.length - 1]
    placed.push({ ...g, tick, lx: previous ? Math.max(tick, previous.lx + 30) : tick })
  }

  const describe = `Driver's daily log for ${log.date}, day ${log.index + 1} of ${dayCount}. ${DUTY_ORDER.map(
    (s) => `${s.replace('_', ' ')} ${formatHM(log.totals[s])}`,
  ).join(', ')}. ${formatNumber(log.miles)} miles driven.`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role={editing ? 'group' : 'img'}
      aria-label={describe}
      className="block h-auto w-full select-none"
      style={{ fontFamily: 'var(--font-sans)', fontVariantNumeric: 'tabular-nums' }}
    >
      <rect width={W} height={H} fill={PAPER} />

      {/* Header */}
      <text x={24} y={50} fill={PRINT} fontSize={27} fontWeight={700} letterSpacing={-0.4}>
        Drivers Daily Log
      </text>
      <text x={258} y={50} fill={PRINT} fontSize={13}>
        (24 hours)
      </text>
      <Field x1={350} x2={410} y={46} value={month} label="(month)" align="middle" />
      <Field x1={420} x2={480} y={46} value={day} label="(day)" align="middle" />
      <Field x1={490} x2={570} y={46} value={year} label="(year)" align="middle" />
      <text x={W - 24} y={30} fill={PRINT} fontSize={11.5} textAnchor="end">
        Original - File at home terminal.
      </text>
      <text x={W - 24} y={46} fill={PRINT} fontSize={11.5} textAnchor="end">
        Duplicate - Driver retains in his/her possession for 8 days.
      </text>
      <text x={W - 24} y={66} fill={FAINT} fontSize={11} textAnchor="end">
        Sheet {log.index + 1} of {dayCount}
      </text>
      {log.edit && !header && (
        <text x={W - 24} y={84} fill={PEN} fontSize={11} fontWeight={500} textAnchor="end">
          Edited by driver: {log.edit.reason.length > 60 ? `${log.edit.reason.slice(0, 59)}…` : log.edit.reason}
        </text>
      )}

      <text x={24} y={102} fill={PRINT} fontSize={13} fontWeight={600}>
        From:
      </text>
      <line x1={66} x2={530} y1={104} y2={104} stroke={RULE} />
      {header ? (
        <SheetInput x={66} y={79} width={464} height={23} edit={dayEdit('from', 'From')!} />
      ) : (
        <text x={72} y={98} fill={PEN} fontSize={15} fontWeight={500}>
          {log.from}
        </text>
      )}
      <text x={556} y={102} fill={PRINT} fontSize={13} fontWeight={600}>
        To:
      </text>
      <line x1={584} x2={W - 24} y1={104} y2={104} stroke={RULE} />
      {header ? (
        <SheetInput x={584} y={79} width={W - 24 - 584} height={23} edit={dayEdit('to', 'To')!} />
      ) : (
        <text x={590} y={98} fill={PEN} fontSize={15} fontWeight={500}>
          {log.to}
        </text>
      )}

      <Box
        x1={24}
        y1={124}
        w={150}
        h={42}
        value={formatNumber(Math.round(log.miles))}
        label="Total Miles Driving Today"
        edit={dayEdit('miles', 'Total miles driving today', true)}
      />
      <Box
        x1={186}
        y1={124}
        w={150}
        h={42}
        value={formatNumber(Math.round(log.total_mileage ?? log.miles))}
        label="Total Mileage Today"
        edit={dayEdit('totalMileage', 'Total mileage today', true)}
      />
      <rect x={24} y={190} width={312} height={34} fill="none" stroke={RULE} />
      {header ? (
        <SheetInput x={27} y={193} width={306} height={28} edit={driverEdit('vehicle_numbers', 'Truck and trailer numbers')!} size={14} align="center" />
      ) : (
        <text x={180} y={212} fill={PEN} fontSize={14} fontWeight={500} textAnchor="middle">
          {driver.vehicle_numbers || ''}
        </text>
      )}
      <text x={180} y={237} fill={PRINT} fontSize={10} textAnchor="middle">
        Truck/Tractor and Trailer Numbers or License Plate(s)/State (show each unit)
      </text>

      <Field x1={366} x2={W - 24} y={146} value={driver.carrier} label="Name of Carrier or Carriers" edit={driverEdit('carrier', 'Carrier')} />
      <Field x1={366} x2={720} y={190} value={driver.main_office} label="Main Office Address" edit={driverEdit('main_office', 'Main office address')} />
      <Field x1={740} x2={W - 24} y={190} value={driver.home_terminal} label="Home Terminal Address" edit={driverEdit('home_terminal', 'Home terminal address')} />
      <Field x1={366} x2={720} y={226} value={driver.name} label="Driver" edit={driverEdit('name', 'Driver name')} />
      <Field x1={740} x2={W - 24} y={226} value={driver.co_driver} label="Name of Co-Driver" edit={driverEdit('co_driver', 'Co-driver name')} />

      {/* Hour band */}
      <rect x={24} y={GT - 30} width={W - 48} height={30} fill={PRINT} />
      {Array.from({ length: 25 }, (_, h) => {
        const hx = GX + h * HOUR
        if (h === 0 || h === 24) {
          return (
            <text key={h} x={h === 0 ? hx - 2 : hx - 3} y={GT - 18} fill={PAPER} fontSize={8.5} fontWeight={600} textAnchor={h === 0 ? 'middle' : 'end'}>
              <tspan x={h === 0 ? hx - 2 : hx - 3}>Mid-</tspan>
              <tspan x={h === 0 ? hx - 2 : hx - 3} dy={10}>night</tspan>
            </text>
          )
        }
        return (
          <text key={h} x={hx} y={GT - 10} fill={PAPER} fontSize={h === 12 ? 9.5 : 11.5} fontWeight={600} textAnchor="middle">
            {h === 12 ? 'Noon' : h % 12}
          </text>
        )
      })}
      <text x={TX + 38} y={GT - 18} fill={PAPER} fontSize={9.5} fontWeight={600} textAnchor="middle">
        <tspan x={TX + 38}>Total</tspan>
        <tspan x={TX + 38} dy={10}>Hours</tspan>
      </text>

      {/* Grid */}
      <rect x={24} y={GT} width={W - 48} height={RH * 4} fill="none" stroke={RULE} strokeWidth={1.2} />
      {DUTY_ORDER.map((status, i) => {
        const top = GT + i * RH
        const [a, b] = ROW_LABEL[status]
        return (
          <g key={status}>
            {i > 0 && <line x1={24} x2={W - 24} y1={top} y2={top} stroke={RULE} strokeWidth={1} />}
            <text x={30} y={b ? top + 15 : top + 21} fill={PRINT} fontSize={11.5} fontWeight={600}>
              {a}
            </text>
            {b && (
              <text x={30} y={top + 28} fill={PRINT} fontSize={10.5}>
                {b}
              </text>
            )}
            {Array.from({ length: 24 }, (_, h) =>
              [1, 2, 3].map((q) => {
                const qx = GX + h * HOUR + (q * HOUR) / 4
                const len = q === 2 ? 13 : 7
                return <line key={`${h}-${q}`} x1={qx} x2={qx} y1={top} y2={top + len} stroke={RULE} strokeWidth={0.75} />
              }),
            )}
            <text x={TX + 38} y={top + 22} fill={PEN} fontSize={15} fontWeight={600} textAnchor="middle">
              {formatHM(log.totals[status])}
            </text>
          </g>
        )
      })}
      {Array.from({ length: 25 }, (_, h) => (
        <line key={h} x1={GX + h * HOUR} x2={GX + h * HOUR} y1={GT} y2={GB} stroke={RULE} strokeWidth={h % 6 === 0 ? 1.2 : 0.9} />
      ))}
      <line x1={TX} x2={TX} y1={GT - 30} y2={GB} stroke={RULE} strokeWidth={1.2} />
      <text x={TX + 38} y={GB + 20} fill={PEN} fontSize={15} fontWeight={700} textAnchor="middle">
        ={formatHM(total)}
      </text>
      <line x1={TX + 12} x2={TX + 64} y1={GB + 26} y2={GB + 26} stroke={RULE} />
      <line x1={TX + 12} x2={TX + 64} y1={GB + 29} y2={GB + 29} stroke={RULE} />

      {/* Highlighted hour (hover from the activity list) */}
      {highlight != null && (
        <rect x={x(highlight)} y={GT} width={2} height={GB - GT} fill={PEN} opacity={0.35} />
      )}

      {/* Driving that breaks an hours-of-service limit */}
      {(log.violations ?? []).map((v, i) => {
        const top = rowY('driving') - RH / 2
        const w = x(v.end) - x(v.start)
        return (
          <g key={`${v.key}-${i}`}>
            <rect x={x(v.start)} y={top} width={w} height={RH} fill={DANGER} opacity={0.16} />
            <rect x={x(v.start)} y={top} width={w} height={2.5} fill={DANGER} />
            {w > 70 && (
              <text x={x(v.start) + 4} y={top + 12} fill={DANGER} fontSize={9.5} fontWeight={700}>
                {VIOLATION_LABEL[v.key] ?? v.title}
              </text>
            )}
          </g>
        )
      })}

      {/* Duty status line, drawn like a pen stroke */}
      <path
        d={dutyPath(log)}
        fill="none"
        stroke={PEN}
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        className={animate ? 'log-ink' : undefined}
      />
      {editing && <EditLayer entries={log.entries} editing={editing} />}

      {/* Remarks */}
      <text x={24} y={RB + 4} fill={PRINT} fontSize={13} fontWeight={700}>
        Remarks
      </text>
      <line x1={GX} x2={TX} y1={RB} y2={RB} stroke={RULE} />
      {Array.from({ length: 25 }, (_, h) => (
        <line key={h} x1={GX + h * HOUR} x2={GX + h * HOUR} y1={RB} y2={RB + (h % 6 === 0 ? 8 : 5)} stroke={RULE} strokeWidth={0.75} />
      ))}
      {stops.map((s, i) => {
        if (s.continued && s.start === 0 && s.kind !== 'rest' && s.kind !== 'restart') return null
        const x1 = x(s.start)
        const x2 = x(s.end)
        const y = RB - 14
        return (
          <path
            key={i}
            d={`M${x1},${y - 7}V${y}H${x2}V${y - 7}`}
            fill="none"
            stroke={PEN}
            strokeWidth={1.4}
            opacity={0.8}
          />
        )
      })}
      {placed.map((g, i) => (
        <g key={i}>
          <line x1={g.tick} x2={g.tick} y1={GB} y2={RB} stroke={PEN} strokeWidth={0.8} strokeDasharray="2 3" opacity={0.55} />
          <path d={`M${g.tick},${RB}L${g.lx},${RB + 10}`} stroke={PEN} strokeWidth={1.2} fill="none" />
          <text transform={`translate(${g.lx + 4} ${RB + 14}) rotate(-90)`} textAnchor="end" fontSize={11}>
            <tspan fill={PEN} fontWeight={600}>
              {clip(g.location)}
            </tspan>
            <tspan x={0} dy={13} fill={PRINT}>
              {activityText(g.labels)}
            </tspan>
          </text>
        </g>
      ))}

      {/* Shipping documents and instructions */}
      <text x={24} y={672} fill={PRINT} fontSize={12.5} fontWeight={700}>
        Shipping Documents:
      </text>
      <Field x1={24} x2={330} y={710} value={driver.shipping_document} label="DVL or Manifest No." edit={driverEdit('shipping_document', 'Shipping document number')} />
      <Field x1={350} x2={720} y={710} value={driver.commodity} label="Shipper & Commodity" edit={driverEdit('commodity', 'Shipper and commodity')} />
      <text x={740} y={688} fill={PRINT} fontSize={10.5}>
        <tspan x={740}>Enter name of place you reported and where released</tspan>
        <tspan x={740} dy={14}>from work and when and where each change of duty</tspan>
        <tspan x={740} dy={14}>occurred. Use time standard of home terminal.</tspan>
      </text>

      {/* Recap */}
      <line x1={24} x2={W - 24} y1={742} y2={742} stroke={RULE} strokeWidth={1.2} />
      <text x={24} y={764} fill={PRINT} fontSize={12.5} fontWeight={700}>
        Recap:
      </text>
      <text x={24} y={779} fill={PRINT} fontSize={10.5}>
        Complete at end of day
      </text>
      <RecapCell x1={150} value={formatHM(r.on_duty_today)} lines={['On duty hours today,', 'Total lines 3 & 4']} />
      <text x={330} y={764} fill={PRINT} fontSize={12} fontWeight={700}>
        70 Hour / 8 Day Drivers
      </text>
      <RecapCell x1={330} y={786} prefix="A." value={formatHM(r.last_7_days)} lines={['Total hours on duty last 7', 'days including today.']} />
      <RecapCell x1={540} y={786} prefix="B." value={formatHM(r.available_tomorrow)} lines={['Total hours available', 'tomorrow 70 hr. minus A*']} />
      <RecapCell x1={750} y={786} prefix="C." value={formatHM(r.last_8_days)} lines={['Total hours on duty last 8', 'days including today.']} />
      <text x={330} y={848} fill={PRINT} fontSize={10}>
        *If you took 34 consecutive hours off duty you have 70 hours available.
      </text>
      {r.restart_completed && (
        <text x={W - 24} y={848} fill={PEN} fontSize={12} fontWeight={600} textAnchor="end">
          34-hour restart completed today
        </text>
      )}
    </svg>
  )
})

function RecapCell({ x1, y = 770, prefix, value, lines }: { x1: number; y?: number; prefix?: string; value: string; lines: string[] }) {
  return (
    <g>
      {prefix && (
        <text x={x1} y={y + 2} fill={PRINT} fontSize={12} fontWeight={700}>
          {prefix}
        </text>
      )}
      <text x={x1 + (prefix ? 64 : 44)} y={y} fill={PEN} fontSize={16} fontWeight={600} textAnchor="middle">
        {value}
      </text>
      <line x1={x1 + (prefix ? 22 : 0)} x2={x1 + (prefix ? 106 : 88)} y1={y + 5} y2={y + 5} stroke={RULE} />
      {lines.map((line, i) => (
        <text key={i} x={x1 + (prefix ? 22 : 0)} y={y + 19 + i * 13} fill={PRINT} fontSize={10}>
          {line}
        </text>
      ))}
    </g>
  )
}

function toSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
  const matrix = svg.getScreenCTM()
  return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()) : new DOMPoint(0, 0)
}

function minuteAt(event: ReactPointerEvent<SVGElement>) {
  const svg = event.currentTarget.ownerSVGElement
  if (!svg) return 0
  const point = toSvg(svg, event.clientX, event.clientY)
  return Math.min(DAY - STEP, Math.max(0, Math.floor(((point.x - GX) / HOUR) * 4) * STEP))
}

function statusAtY(y: number): DutyStatus {
  const row = Math.min(DUTY_ORDER.length - 1, Math.max(0, Math.floor((y - GT) / RH)))
  return DUTY_ORDER[row]
}

function clock(minute: number) {
  if (minute >= DAY) return 'Midnight'
  const h = Math.floor(minute / 60) % 24
  const m = minute % 60
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/**
 * Follows a drag at the window level. Handles and line pieces can disappear
 * while dragging (neighbors on the same status merge), which would drop an
 * element-level pointer capture.
 */
function followDrag(svg: SVGSVGElement, onMove: (p: DOMPoint) => void, onEnd: () => void) {
  const move = (e: PointerEvent) => onMove(toSvg(svg, e.clientX, e.clientY))
  const end = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    onEnd()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

type Drag = { type: 'boundary'; minute: number } | { type: 'segment'; status: DutyStatus; y: number }

/**
 * Drawing tools over the grid:
 * - drag across a row to put that period on that duty status,
 * - drag a piece of the line up or down to change its status,
 * - drag a round handle sideways to move a change (onto another change removes the piece between).
 * Handles and pieces also work with the arrow keys. Times snap to 15 minutes.
 */
function EditLayer({ entries, editing }: { entries: LogEntry[]; editing: SheetEditing }) {
  const [paint, setPaint] = useState<{ status: DutyStatus; anchor: number; current: number } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  const range = paint && { from: Math.min(paint.anchor, paint.current), to: Math.max(paint.anchor, paint.current) + STEP }

  function startBoundaryDrag(e: ReactPointerEvent<SVGElement>, index: number) {
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    e.preventDefault()
    editing.onEditStart()
    setDrag({ type: 'boundary', minute: entries[index].start })
    followDrag(
      svg,
      (p) => {
        const minute = ((p.x - GX) / HOUR) * 60
        setDrag({ type: 'boundary', minute: Math.min(DAY, Math.max(0, Math.round(minute / STEP) * STEP)) })
        editing.onMoveBoundary(index, minute)
      },
      () => {
        setDrag(null)
        editing.onEditEnd()
      },
    )
  }

  function startSegmentDrag(e: ReactPointerEvent<SVGElement>, index: number) {
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    e.preventDefault()
    editing.onEditStart()
    const entry = entries[index]
    setDrag({ type: 'segment', status: entry.status, y: rowY(entry.status) })
    followDrag(
      svg,
      (p) => {
        const status = statusAtY(p.y)
        setDrag({ type: 'segment', status, y: Math.min(GB, Math.max(GT, p.y)) })
        editing.onMoveSegment(index, status)
      },
      () => {
        setDrag(null)
        editing.onEditEnd()
      },
    )
  }

  return (
    <g>
      {DUTY_ORDER.map((status, i) => (
        <rect
          key={status}
          x={GX}
          y={GT + i * RH}
          width={GW}
          height={RH}
          fill="transparent"
          style={{ cursor: 'crosshair', touchAction: 'none' }}
          aria-hidden
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            const m = minuteAt(e)
            setPaint({ status, anchor: m, current: m })
          }}
          onPointerMove={(e) => {
            const m = minuteAt(e)
            setHover(m)
            if (paint) setPaint({ ...paint, current: m })
          }}
          onPointerLeave={() => setHover(null)}
          onPointerUp={() => {
            if (paint && range) {
              editing.onEditStart()
              editing.onPaint(paint.status, range.from, range.to)
              editing.onEditEnd()
            }
            setPaint(null)
          }}
          onPointerCancel={() => setPaint(null)}
        />
      ))}

      {hover != null && !paint && !drag && (
        <g pointerEvents="none">
          <line x1={x(hover)} x2={x(hover)} y1={GT} y2={GB} stroke={PEN} strokeWidth={1} strokeDasharray="3 3" />
          <rect x={x(hover) - 30} y={GT - 50} width={60} height={18} rx={9} fill={PEN} />
          <text x={x(hover)} y={GT - 37} fill={PAPER} fontSize={10.5} fontWeight={600} textAnchor="middle">
            {clock(hover)}
          </text>
        </g>
      )}

      {paint && range && (
        <g pointerEvents="none">
          <rect
            x={x(range.from)}
            y={rowY(paint.status) - RH / 2 + 3}
            width={x(range.to) - x(range.from)}
            height={RH - 6}
            rx={4}
            fill={PEN}
            opacity={0.22}
          />
          <rect x={x(range.from) - 2} y={GT - 54} width={Math.max(150, x(range.to) - x(range.from) + 4)} height={22} rx={11} fill={PEN} />
          <text x={x(range.from) + 8} y={GT - 39} fill={PAPER} fontSize={11} fontWeight={600}>
            {DUTY[paint.status].label}: {clock(range.from)} - {clock(range.to)}
          </text>
        </g>
      )}

      {/* Pieces of the line: drag up or down to change status. */}
      {entries.map((entry, index) => {
        const x1 = x(entry.start)
        const x2 = x(entry.end)
        const y = rowY(entry.status)
        const row = DUTY_ORDER.indexOf(entry.status)
        return (
          <g
            key={`seg-${index}`}
            role="slider"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label={`${DUTY[entry.status].label}, ${clock(entry.start)} to ${clock(entry.end)}. Up and down arrows change the status.`}
            aria-valuemin={1}
            aria-valuemax={4}
            aria-valuenow={row + 1}
            aria-valuetext={DUTY[entry.status].label}
            className="log-segment"
            style={{ cursor: 'ns-resize', touchAction: 'none', outline: 'none' }}
            onPointerDown={(e) => startSegmentDrag(e, index)}
            onKeyDown={(e) => {
              const direction = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
              if (!direction) return
              e.preventDefault()
              editing.onEditStart()
              editing.onNudgeSegment(index, direction)
              editing.onEditEnd()
            }}
          >
            <rect x={x1 + 4} y={y - 8} width={Math.max(0, x2 - x1 - 8)} height={16} fill="transparent" />
            <rect className="log-segment-glow" x={x1} y={y - 4} width={x2 - x1} height={8} rx={4} fill={PEN} pointerEvents="none" />
          </g>
        )
      })}

      {drag?.type === 'segment' && (
        <g pointerEvents="none">
          <rect x={24} y={GT + DUTY_ORDER.indexOf(drag.status) * RH} width={GX - 24} height={RH} fill={PEN} opacity={0.12} />
          <rect x={GX - 4} y={drag.y - 11} width={130} height={22} rx={11} fill={PEN} />
          <text x={GX + 6} y={drag.y + 4} fill={PAPER} fontSize={11} fontWeight={600}>
            Move to {DUTY[drag.status].label}
          </text>
        </g>
      )}

      {/* Change points: drag sideways to move. */}
      {entries.slice(1).map((entry, k) => {
        const index = k + 1
        const prev = entries[index - 1]
        const hx = x(entry.start)
        const y1 = Math.min(rowY(prev.status), rowY(entry.status))
        const y2 = Math.max(rowY(prev.status), rowY(entry.status))
        const active = drag?.type === 'boundary' && Math.abs(drag.minute - entry.start) < STEP
        return (
          <g
            key={`pt-${index}`}
            role="slider"
            tabIndex={0}
            aria-label={`Change from ${DUTY[prev.status].label} to ${DUTY[entry.status].label}`}
            aria-valuemin={prev.start}
            aria-valuemax={entry.end}
            aria-valuenow={entry.start}
            aria-valuetext={clock(entry.start)}
            className="log-handle"
            style={{ cursor: 'ew-resize', touchAction: 'none', outline: 'none' }}
            onPointerDown={(e) => startBoundaryDrag(e, index)}
            onKeyDown={(e) => {
              const delta = e.key === 'ArrowLeft' ? -STEP : e.key === 'ArrowRight' ? STEP : 0
              if (!delta) return
              e.preventDefault()
              editing.onEditStart()
              editing.onNudgeBoundary(index, delta * (e.shiftKey ? 4 : 1))
              editing.onEditEnd()
            }}
          >
            <rect x={hx - 7} y={y1 - 10} width={14} height={y2 - y1 + 20} fill="transparent" />
            <circle className="log-handle-knob" cx={hx} cy={(y1 + y2) / 2} r={active ? 7 : 5.5} fill={PAPER} stroke={PEN} strokeWidth={2.5} />
          </g>
        )
      })}

      {drag?.type === 'boundary' && (
        <g pointerEvents="none">
          <line x1={x(drag.minute)} x2={x(drag.minute)} y1={GT} y2={GB} stroke={PEN} strokeWidth={1} strokeDasharray="3 3" />
          <rect x={x(drag.minute) - 30} y={GT - 50} width={60} height={18} rx={9} fill={PEN} />
          <text x={x(drag.minute)} y={GT - 37} fill={PAPER} fontSize={10.5} fontWeight={600} textAnchor="middle">
            {clock(drag.minute)}
          </text>
        </g>
      )}
    </g>
  )
}
