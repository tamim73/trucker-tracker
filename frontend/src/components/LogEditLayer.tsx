import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { DutyStatus, LogEntry } from '../lib/api'
import { DUTY, DUTY_ORDER } from '../lib/duty'
import { DAY, formatMinuteOfDay as clock } from '../lib/format'
import { STEP } from '../lib/logEdit'
import { GB, GT, GW, GX, HOUR, PAPER, PEN, RH, rowY, x } from '../lib/sheetGeometry'

/** Callbacks the sheet calls while the driver draws on it. */
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
/** Pointer travel (screen px) before a press on the grid counts as drawing. */
const DRAW_THRESHOLD = 4

export function EditLayer({ entries, editing }: { entries: LogEntry[]; editing: SheetEditing }) {
  const [paint, setPaint] = useState<{ status: DutyStatus; anchor: number; current: number; moved: boolean } | null>(null)
  const pressX = useRef(0)
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const layer = useRef<SVGGElement>(null)
  // After a keyboard edit, entries can merge or split and the focused element
  // can disappear; this puts focus back on the piece or change that was edited.
  const refocus = useRef<{ type: 'segment' | 'boundary'; minute: number } | null>(null)

  useEffect(() => {
    const target = refocus.current
    if (!target || !layer.current) return
    refocus.current = null
    let selector: string
    if (target.type === 'segment') {
      const index = entries.findIndex((e) => e.start <= target.minute && target.minute < e.end)
      selector = `[data-segment="${Math.max(0, index)}"]`
    } else {
      const starts = entries.slice(1).map((e) => e.start)
      if (starts.length === 0) return
      const nearest = starts.reduce((a, b) => (Math.abs(b - target.minute) < Math.abs(a - target.minute) ? b : a))
      selector = `[data-boundary="${nearest}"]`
    }
    layer.current.querySelector<SVGGElement>(selector)?.focus()
  }, [entries])

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
    <g ref={layer}>
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
            pressX.current = e.clientX
            setPaint({ status, anchor: m, current: m, moved: false })
          }}
          onPointerMove={(e) => {
            const m = minuteAt(e)
            setHover(m)
            if (paint) setPaint({ ...paint, current: m, moved: paint.moved || Math.abs(e.clientX - pressX.current) >= DRAW_THRESHOLD })
          }}
          onPointerLeave={() => setHover(null)}
          onPointerUp={() => {
            // A plain click does nothing; drawing needs a drag.
            if (paint?.moved && range) {
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

      {paint?.moved && range && (
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
            data-segment={index}
            role="slider"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label={`${DUTY[entry.status].label}, ${clock(entry.start)} to ${clock(entry.end)}. Up and down arrows change the status.`}
            aria-valuemin={1}
            aria-valuemax={DUTY_ORDER.length}
            aria-valuenow={DUTY_ORDER.length - row}
            aria-valuetext={DUTY[entry.status].label}
            className="log-segment"
            style={{ cursor: 'ns-resize', touchAction: 'none', outline: 'none' }}
            onPointerDown={(e) => startSegmentDrag(e, index)}
            onKeyDown={(e) => {
              const direction = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
              if (!direction) return
              e.preventDefault()
              editing.onEditStart()
              refocus.current = { type: 'segment', minute: entry.start }
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
            data-boundary={entry.start}
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
              refocus.current = { type: 'boundary', minute: entry.start + delta * (e.shiftKey ? 4 : 1) }
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
