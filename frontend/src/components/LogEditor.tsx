import { CaretDownIcon, CheckCircleIcon, SpinnerGapIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useId, useRef, type Ref } from 'react'
import type { DailyLog, DriverDetails, DutyStatus, LogEntry } from '../lib/api'
import { DRIVER_FIELDS } from '../lib/driver'
import { DUTY, DUTY_ORDER, KIND } from '../lib/duty'
import { formatHM } from '../lib/format'
import { DAY, fromTimeValue, moveBoundary, removeEntry, setStatus, STEP, toTimeValue, updateEntry } from '../lib/logEdit'

export interface Draft {
  entries: LogEntry[]
  miles: string
  reason: string
  driver: DriverDetails
}

interface Props {
  draft: Draft
  onChange: (draft: Draft) => void
  /** Records the entries as they were before a change, for undo. */
  onSnapshot: (entries: LogEntry[]) => void
  preview: DailyLog | null
  previewing: boolean
  reasonError?: string
  reasonRef: Ref<HTMLTextAreaElement>
  onHover: (minute: number | null) => void
}

const inputClass =
  'h-10 w-full min-w-0 rounded-[10px] bg-soft px-3 text-[14px] text-ink outline-none placeholder:text-mute focus-visible:shadow-[inset_0_0_0_2px_var(--ink)] focus-visible:outline-none disabled:opacity-60'

function clock(minute: number) {
  if (minute === DAY) return 'Midnight'
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function LogEditor({ draft, onChange, onSnapshot, preview, previewing, reasonError, reasonRef, onHover }: Props) {
  const ids = { reason: useId(), miles: useId() }
  const entries = draft.entries
  const focusSnapshot = useRef<LogEntry[] | null>(null)

  function change(next: LogEntry[], snapshot = true) {
    if (next === entries) return
    if (snapshot) onSnapshot(entries)
    onChange({ ...draft, entries: next })
  }

  // Text fields record one undo step per focus, not one per keystroke.
  const textHandlers = {
    onFocus: () => {
      focusSnapshot.current = entries
    },
    onBlur: () => {
      if (focusSnapshot.current && focusSnapshot.current !== entries) onSnapshot(focusSnapshot.current)
      focusSnapshot.current = null
    },
  }

  const violations = preview?.violations ?? []

  return (
    <section className="no-print grid gap-8 lg:grid-cols-[1fr_340px]" aria-label="Edit log entries">
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <h2 className="text-[18px] font-bold tracking-[-0.01em]">Duty status entries</h2>
          <p className="mt-1 text-[14px] text-body">
            Each entry runs until the next one starts. Times snap to 15-minute marks. Neighbors with the same status join into one entry.
          </p>
        </div>
        <div
          className="hidden grid-cols-[196px_128px_72px_1fr_1fr_44px] gap-2 px-3 text-[12px] font-medium text-body lg:grid"
          aria-hidden
        >
          <span>Status</span>
          <span>Start</span>
          <span>End</span>
          <span>Location</span>
          <span>Note</span>
          <span />
        </div>
        <ol className="flex flex-col gap-2">
          {entries.map((entry, i) => (
            <li
              key={i}
              onMouseEnter={() => onHover(entry.start)}
              onMouseLeave={() => onHover(null)}
              className="grid grid-cols-2 items-center gap-2 rounded-2xl border border-hairline p-2.5 lg:grid-cols-[196px_128px_72px_1fr_1fr_44px]"
            >
              <div className="col-span-2 flex items-center gap-2 lg:col-span-1">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: DUTY[entry.status].color }} aria-hidden />
                <select
                  aria-label={`Entry ${i + 1} duty status`}
                  value={entry.status}
                  onChange={(e) => change(setStatus(entries, i, e.target.value as DutyStatus))}
                  className={`${inputClass} cursor-pointer`}
                >
                  {DUTY_ORDER.map((status) => (
                    <option key={status} value={status}>
                      {DUTY[status].label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                key={`start-${entry.start}`}
                type="time"
                step={STEP * 60}
                aria-label={`Entry ${i + 1} start time`}
                defaultValue={toTimeValue(entry.start)}
                disabled={i === 0}
                onBlur={(e) => {
                  const minute = fromTimeValue(e.target.value)
                  if (minute == null) return
                  const next = moveBoundary(entries, i, minute)
                  if (next === entries) e.target.value = toTimeValue(entry.start)
                  else change(next)
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className={`${inputClass} tnum font-mono`}
              />
              <span className="tnum font-mono text-[13px] text-body">
                <span className="lg:hidden">to </span>
                {clock(entry.end)}
              </span>
              <input
                type="text"
                aria-label={`Entry ${i + 1} location`}
                placeholder="City, ST…"
                autoComplete="off"
                value={entry.location}
                maxLength={120}
                onChange={(e) => change(updateEntry(entries, i, { location: e.target.value }), false)}
                {...textHandlers}
                className={`${inputClass} col-span-2 lg:col-span-1`}
              />
              <input
                type="text"
                aria-label={`Entry ${i + 1} note`}
                placeholder={`${KIND[entry.kind]?.title ?? DUTY[entry.status].label}…`}
                autoComplete="off"
                value={entry.note}
                maxLength={160}
                onChange={(e) => change(updateEntry(entries, i, { note: e.target.value }), false)}
                {...textHandlers}
                className={`${inputClass} col-span-2 lg:col-span-1`}
              />
              <div className="col-span-2 flex justify-end gap-1 lg:col-span-1">
                <button
                  type="button"
                  className="icon-btn size-9"
                  onClick={() => change(removeEntry(entries, i))}
                  disabled={entries.length === 1}
                  aria-label={`Remove entry ${i + 1}`}
                  title="Remove (the previous entry takes its time)"
                >
                  <TrashIcon size={17} weight="bold" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <aside className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label htmlFor={ids.reason} className="field-label">
            Reason for edit
          </label>
          <textarea
            id={ids.reason}
            ref={reasonRef}
            name="reason"
            rows={3}
            maxLength={200}
            placeholder="Example: left the shipper 30 minutes later than planned…"
            value={draft.reason}
            onChange={(e) => onChange({ ...draft, reason: e.target.value })}
            aria-invalid={Boolean(reasonError)}
            aria-describedby={`${ids.reason}-help`}
            className={`w-full resize-y rounded-[10px] bg-soft px-3.5 py-2.5 text-[15px] text-ink outline-none placeholder:text-mute focus-visible:shadow-[inset_0_0_0_2px_var(--ink)] focus-visible:outline-none ${
              reasonError ? 'shadow-[inset_0_0_0_1.5px_var(--danger)]' : ''
            }`}
          />
          <p id={`${ids.reason}-help`} className={`text-[13px] ${reasonError ? 'text-danger' : 'text-body'}`} aria-live="polite">
            {reasonError ?? 'Required. Saved with the log, as electronic logs require for every edit.'}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={ids.miles} className="field-label">
            Total miles driving today
          </label>
          <input
            id={ids.miles}
            type="number"
            inputMode="decimal"
            min={0}
            max={1500}
            step={1}
            autoComplete="off"
            value={draft.miles}
            onChange={(e) => onChange({ ...draft, miles: e.target.value })}
            className={`${inputClass} tnum h-11 font-mono text-[15px]`}
          />
        </div>

        <div className="flex flex-col gap-3" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[16px] font-bold">Hours of service</h2>
            {previewing && (
              <span className="flex items-center gap-1.5 text-[13px] text-body">
                <SpinnerGapIcon size={14} weight="bold" className="animate-spin" aria-hidden />
                Checking…
              </span>
            )}
          </div>
          {violations.length === 0 ? (
            <p className="flex items-center gap-2 rounded-2xl bg-accent-soft px-4 py-3 text-[14px] font-medium text-accent">
              <CheckCircleIcon size={18} weight="fill" aria-hidden />
              No violations on this day
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {violations.map((v, i) => (
                <li key={i} className="flex items-start gap-2.5 rounded-2xl bg-danger-soft px-4 py-3 text-[14px] text-danger">
                  <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" aria-hidden />
                  <span>
                    <span className="block font-medium">{v.title}</span>
                    <span className="tnum font-mono text-[13px]">
                      Driving {clock(v.start)} - {clock(v.end)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {preview && (
            <dl className="flex flex-col gap-2 rounded-2xl bg-soft p-4 text-[14px]">
              <Row label="On duty today" value={formatHM(preview.recap.on_duty_today)} />
              <Row label="Last 7 days, including today" value={formatHM(preview.recap.last_7_days)} />
              <Row label="Available tomorrow" value={formatHM(preview.recap.available_tomorrow)} />
            </dl>
          )}
        </div>

        <details className="group rounded-2xl border border-hairline">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 hover:bg-softer [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-[15px] font-medium">Sheet header</span>
              <span className="block text-[13px] text-body">Driver, carrier and equipment. Applies to every sheet.</span>
            </span>
            <CaretDownIcon size={18} weight="bold" className="shrink-0 transition-transform duration-200 group-open:rotate-180" aria-hidden />
          </summary>
          <div className="flex flex-col gap-3 px-4 pt-1 pb-4">
            {DRIVER_FIELDS.map((field) => (
              <HeaderField
                key={field.key}
                label={field.label}
                placeholder={field.placeholder}
                value={draft.driver[field.key]}
                onChange={(value) => onChange({ ...draft, driver: { ...draft.driver, [field.key]: value } })}
              />
            ))}
          </div>
        </details>
      </aside>
    </section>
  )
}

function HeaderField({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        maxLength={160}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-body">{label}</dt>
      <dd className="tnum font-mono">{value}</dd>
    </div>
  )
}
