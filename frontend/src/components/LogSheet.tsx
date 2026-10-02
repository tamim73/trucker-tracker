import { memo, type ReactNode } from 'react'
import type { DailyLog, DriverDetails, DutyStatus, LogRemark } from '../lib/api'
import { DUTY_ORDER, remarkText } from '../lib/duty'
import { formatHM, formatNumber } from '../lib/format'
import { DANGER, FAINT, GB, GT, GX, H, HOUR, PAPER, PEN, PRINT, RB, RH, RULE, rowY, TX, W, x } from '../lib/sheetGeometry'
import { EditLayer, type SheetEditing } from './LogEditLayer'

/*
  A recreation of the FMCSA paper "Driver's Daily Log (24 hours)" from the
  Interstate Truck Driver's Guide to Hours of Service: header, 24-hour grid
  with the four duty-status lines, remarks with locations at every change of
  duty status, shipping documents, and the 70-hour / 8-day recap.
*/


const VIOLATION_LABEL: Record<string, string> = {
  driving: 'Over 11 hr driving',
  window: 'Past 14-hr window',
  break: 'No 30-min break',
  cycle: 'Over 70-hr cycle',
}
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



export type { SheetEditing } from './LogEditLayer'

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
  remarks?: RemarkEditing
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

export interface RemarkGroup {
  minute: number
  /** Start minutes of every change of duty status the label covers. */
  minutes: number[]
  location: string
  labels: [string, string][]
}

/** Remark labels become buttons while editing; selecting one opens its editor. */
export interface RemarkEditing {
  selected: number | null
  onSelect: (group: RemarkGroup, anchor: { x: number; y: number }) => void
}

/** One label per place: changes at the same location within two hours share it. */
function groupRemarks(remarks: LogRemark[]): RemarkGroup[] {
  const groups: RemarkGroup[] = []
  for (const r of remarks) {
    const last = groups[groups.length - 1]
    const label = remarkText(r)
    if (last && last.location === r.location && r.minute - last.minute <= 120) {
      last.minutes.push(r.minute)
      if (!last.labels.some((l) => l[0] === label[0])) last.labels.push(label)
    } else {
      groups.push({ minute: r.minute, minutes: [r.minute], location: r.location, labels: [label] })
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

export const LogSheet = memo(function LogSheet({ log, driver, dayCount, animate = true, highlight, editing, header, remarks }: Props) {
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
      {placed.map((g, i) => {
        const label = (
          <text transform={`translate(${g.lx + 4} ${RB + 14}) rotate(-90)`} textAnchor="end" fontSize={11}>
            <tspan fill={PEN} fontWeight={600}>
              {clip(g.location || 'Add location')}
            </tspan>
            <tspan x={0} dy={13} fill={PRINT}>
              {activityText(g.labels)}
            </tspan>
          </text>
        )
        const select = () => remarks?.onSelect(g, { x: g.lx, y: RB })
        return (
          <g key={i}>
            <line x1={g.tick} x2={g.tick} y1={GB} y2={RB} stroke={PEN} strokeWidth={0.8} strokeDasharray="2 3" opacity={0.55} />
            <path d={`M${g.tick},${RB}L${g.lx},${RB + 10}`} stroke={PEN} strokeWidth={1.2} fill="none" />
            {remarks ? (
              <g
                role="button"
                tabIndex={0}
                aria-label={`Edit remark: ${g.location}, ${g.labels.map((l) => l[0]).join(', ')}`}
                aria-expanded={remarks.selected === g.minute}
                className="log-remark"
                style={{ cursor: 'pointer', outline: 'none' }}
                onClick={select}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    select()
                  }
                }}
              >
                <rect
                  className={`log-remark-box ${remarks.selected === g.minute ? 'is-selected' : ''}`}
                  x={g.lx - 11}
                  y={RB + 8}
                  width={30}
                  height={188}
                  rx={6}
                />
                {label}
              </g>
            ) : (
              label
            )}
          </g>
        )
      })}

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
