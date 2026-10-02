import { XIcon } from '@phosphor-icons/react'
import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { LogEntry } from '../lib/api'
import { DUTY, REMARK_ACTIVITY } from '../lib/duty'
import { formatMinuteOfDay } from '../lib/format'
import { updateEntry } from '../lib/logEdit'

interface Props {
  entries: LogEntry[]
  /** Start minutes of the changes of duty status this remark covers. */
  minutes: number[]
  onChange: (entries: LogEntry[]) => void
  /** Records the entries before a change, for undo. */
  onSnapshot: (entries: LogEntry[]) => void
  onClose: () => void
  /** Position over the sheet, as percentages of its width and height. */
  left: number
  top: number
  /** Which side of the anchor the editor opens toward. */
  align: 'left' | 'right'
}

const inputClass =
  'h-10 w-full min-w-0 rounded-[10px] bg-soft px-3 text-[14px] text-ink outline-none placeholder:text-mute focus-visible:shadow-[inset_0_0_0_2px_var(--ink)] focus-visible:outline-none'

/**
 * Edits one remark on the sheet: the place written once for the label, and
 * the remark for each change of duty status it covers. An empty remark prints
 * the default activity ("Pickup, loading").
 */
export function RemarkEditor({ entries, minutes, onChange, onSnapshot, onClose, left, top, align }: Props) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const firstInput = useRef<HTMLInputElement>(null)
  const before = useRef<LogEntry[] | null>(null)
  const indices = minutes.map((m) => entries.findIndex((e) => e.start === m)).filter((i) => i >= 0)

  useEffect(() => {
    firstInput.current?.focus()
  }, [])

  // Closing with Escape or a click elsewhere unmounts the inputs without a
  // blur, so record the undo step for a field still being edited here.
  const latest = useRef({ entries, onSnapshot })
  useLayoutEffect(() => {
    latest.current = { entries, onSnapshot }
  })
  useEffect(() => {
    return () => {
      const { entries: current, onSnapshot: snapshot } = latest.current
      if (before.current && before.current !== current) snapshot(before.current)
    }
  }, [])

  // Close on Escape or a press outside the editor (but not on another remark,
  // which opens its own editor instead).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    const onPress = (event: PointerEvent) => {
      const target = event.target as Element
      if (box.current?.contains(target) || target.closest('.log-remark')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress)
    }
  }, [onClose])

  // The entries it pointed at were merged or moved away by another edit.
  useEffect(() => {
    if (indices.length === 0) onClose()
  }, [indices.length, onClose])
  if (indices.length === 0) return null

  // One undo step per field visit, not per keystroke.
  const track = {
    onFocus: () => {
      before.current = entries
    },
    onBlur: () => {
      if (before.current && before.current !== entries) onSnapshot(before.current)
      before.current = null
    },
  }

  const location = entries[indices[0]].location

  return (
    <div
      ref={box}
      role="dialog"
      aria-labelledby={`${id}-title`}
      className="no-print absolute z-20 w-[320px] rounded-2xl border border-hairline bg-surface p-4 shadow-float"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        transform: align === 'right' ? 'translateX(-100%)' : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id={`${id}-title`} className="text-[15px] font-semibold">
          Edit remark
        </h3>
        <button type="button" className="icon-btn -mt-2 -mr-2 size-8" onClick={onClose} aria-label="Close remark editor">
          <XIcon size={16} weight="bold" aria-hidden />
        </button>
      </div>

      <label htmlFor={`${id}-location`} className="field-label mt-2 block">
        Location
      </label>
      <input
        id={`${id}-location`}
        ref={firstInput}
        type="text"
        autoComplete="off"
        maxLength={120}
        placeholder="City, ST…"
        value={location}
        onChange={(e) => {
          let next = entries
          for (const i of indices) next = updateEntry(next, i, { location: e.target.value })
          onChange(next)
        }}
        {...track}
        className={`${inputClass} mt-1.5`}
      />

      <div className="mt-3 flex flex-col gap-3">
        {indices.map((i) => {
          const entry = entries[i]
          return (
            <div key={entry.start} className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-note-${i}`} className="field-label">
                {formatMinuteOfDay(entry.start)}, {DUTY[entry.status].label.toLowerCase()}
              </label>
              <input
                id={`${id}-note-${i}`}
                type="text"
                autoComplete="off"
                maxLength={160}
                placeholder={`${REMARK_ACTIVITY[entry.kind]?.[0] ?? 'Remark'}…`}
                value={entry.note}
                onChange={(e) => onChange(updateEntry(entries, i, { note: e.target.value }))}
                {...track}
                className={inputClass}
              />
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-[12px] text-body">Leave a remark empty to print the standard activity.</p>
    </div>
  )
}
