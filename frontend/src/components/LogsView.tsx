import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  EyeIcon,
  PencilSimpleIcon,
  PrinterIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useBlocker, useSearchParams } from 'react-router-dom'
import { useLogDraft } from '../hooks/useLogDraft'
import { api, editToken, type DailyLog, type Trip } from '../lib/api'
import { EMPTY_DRIVER } from '../lib/driver'
import { DUTY, DUTY_ORDER, entryLabel } from '../lib/duty'
import { formatDay, formatHM, formatLongDate, formatMiles, formatMinuteOfDay } from '../lib/format'
import { draftLog, totals, withLocations } from '../lib/logEdit'
import { LogEditor } from './LogEditor'
import { LogSheet } from './LogSheet'

interface Props {
  trip: Trip
  onTripChange: (trip: Trip) => void
}

/** True while the browser prints, so the print-only sheets render only then. */
function usePrinting() {
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true))
    const after = () => setPrinting(false)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])
  return printing
}

export function LogsView({ trip, onTripChange }: Props) {
  if (trip.logs.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-[16px] text-body sm:px-6">
        This trip has no log sheets. <Link to="/" className="font-medium text-ink underline">Plan a new trip</Link>.
      </div>
    )
  }
  return <LogsWorkspace trip={trip} onTripChange={onTripChange} />
}

function LogsWorkspace({ trip, onTripChange }: Props) {
  const [params, setParams] = useSearchParams()
  const count = trip.logs.length
  const requested = Number.parseInt(params.get('day') ?? '1', 10)
  const index = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), count) - 1 : 0
  const log = trip.logs[index]
  const driver = useMemo(() => ({ ...EMPTY_DRIVER, ...(trip.inputs.driver ?? {}) }), [trip.inputs.driver])
  const canEdit = Boolean(editToken(trip.id))
  const [hover, setHover] = useState<number | null>(null)
  const tabs = useRef<HTMLDivElement>(null)
  const focusDay = useRef(false)
  const printing = usePrinting()
  const d = useLogDraft(trip, index, onTripChange)
  const { draft, editing } = d

  useEffect(() => {
    const current = tabs.current?.querySelector<HTMLElement>('[aria-current="page"]')
    current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (focusDay.current) current?.focus()
    focusDay.current = false
  }, [index])

  // Unsaved edits: warn on reload or tab close, and ask before in-app navigation.
  useEffect(() => {
    if (!d.dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [d.dirty])
  const blocker = useBlocker(({ currentLocation, nextLocation }) => d.dirty && currentLocation.pathname !== nextLocation.pathname)

  // Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z, unless a text field has focus.
  const { undo, redo } = d
  useEffect(() => {
    if (!editing) return
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select')) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, undo, redo])

  function go(next: number) {
    if (editing) return
    setParams({ day: String(next + 1) }, { replace: true })
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowRight' && index < count - 1) {
      focusDay.current = true
      go(index + 1)
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      focusDay.current = true
      go(index - 1)
    }
  }

  const previousStatus = index > 0 ? (trip.logs[index - 1].entries.at(-1)?.status ?? null) : null
  const preview = d.preview
  const shown: DailyLog = useMemo(
    () =>
      draft
        ? {
            ...draftLog({ ...log, ...(preview ?? {}) }, draft.entries, Number(draft.miles) || 0, previousStatus),
            from: draft.from,
            to: draft.to,
            total_mileage: Number(draft.totalMileage) || 0,
            edit: log.edit,
          }
        : log,
    [draft, preview, log, previousStatus],
  )
  const shownTotals = draft ? totals(draft.entries) : log.totals
  const viewEntries = useMemo(() => withLocations(log), [log])

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
      <div className="no-print flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[26px] leading-8 font-bold tracking-[-0.02em]">Daily log sheets</h1>
          <p className="mt-1 text-[15px] text-body">
            {count} {count === 1 ? 'sheet' : 'sheets'}, one per calendar day in home terminal time.
          </p>
        </div>
        {!editing && (
          <div className="flex gap-2 self-start sm:self-auto">
            {canEdit && (
              <button type="button" className="btn btn-subtle" onClick={() => d.start(log, driver)}>
                <PencilSimpleIcon size={18} weight="bold" aria-hidden />
                Edit Log
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>
              <PrinterIcon size={18} weight="bold" aria-hidden />
              Print All Logs
            </button>
          </div>
        )}
      </div>

      <div className="no-print flex items-center gap-2" onKeyDown={onKeyDown}>
        <button type="button" className="icon-btn bg-soft" onClick={() => go(index - 1)} disabled={editing || index === 0} aria-label="Previous day">
          <CaretLeftIcon size={18} weight="bold" aria-hidden />
        </button>
        <nav
          ref={tabs}
          aria-label="Log days"
          className="flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto overscroll-x-contain py-1 [scrollbar-width:none]"
        >
          {trip.logs.map((l, i) => (
            <button
              key={l.date}
              type="button"
              onClick={() => go(i)}
              disabled={editing && i !== index}
              aria-current={i === index ? 'page' : undefined}
              className={`flex shrink-0 snap-start flex-col items-start rounded-2xl px-4 py-2 text-left transition-colors duration-150 disabled:opacity-45 ${
                i === index ? 'bg-ink text-canvas' : 'bg-soft text-ink hover:bg-pressed'
              }`}
            >
              <span className="flex items-center gap-1.5 text-[14px] font-semibold">
                Day {i + 1}
                {(l.violations?.length ?? 0) > 0 && <WarningCircleIcon size={14} weight="fill" className="text-danger" aria-label="Has violations" />}
                {l.edit && <PencilSimpleIcon size={13} weight="bold" aria-label="Edited" />}
              </span>
              <span className={`tnum text-[12px] ${i === index ? 'text-canvas/75' : 'text-body'}`}>
                {formatDay(l.date, 0)}, {formatMiles(l.miles)}
              </span>
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="icon-btn bg-soft"
          onClick={() => go(index + 1)}
          disabled={editing || index === count - 1}
          aria-label="Next day"
        >
          <CaretRightIcon size={18} weight="bold" aria-hidden />
        </button>
      </div>

      {editing ? (
        <div className="no-print sticky top-16 z-20 -mx-2 flex flex-col gap-3 rounded-2xl border border-hairline bg-surface/95 px-4 py-3 shadow-float backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">Editing Day {index + 1}</p>
            <p className="text-[13px] text-body">Drag across a row to draw that duty status. Drag a round handle to move a change.</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" className="icon-btn" onClick={undo} disabled={!d.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
              <ArrowCounterClockwiseIcon size={18} weight="bold" aria-hidden />
            </button>
            <button type="button" className="icon-btn" onClick={redo} disabled={!d.canRedo} aria-label="Redo" title="Redo (Shift+Ctrl+Z)">
              <ArrowClockwiseIcon size={18} weight="bold" aria-hidden />
            </button>
            <button type="button" className="btn btn-subtle h-10 px-4" onClick={d.stop} disabled={d.saving}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary h-10 px-4" onClick={d.save} disabled={d.saving}>
              {d.saving && <SpinnerGapIcon size={16} weight="bold" className="animate-spin" aria-hidden />}
              {d.saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {log.edit && <EditedNotice key={index} trip={trip} index={index} canEdit={canEdit} onTripChange={onTripChange} />}
          {!canEdit && (
            <p className="no-print flex items-center gap-2 text-[14px] text-body">
              <EyeIcon size={18} weight="bold" aria-hidden />
              View only. The logs can be edited in the browser that planned this trip.
            </p>
          )}
        </>
      )}
      {d.error && (
        <p role="alert" className="no-print flex items-center gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-[14px] text-danger">
          <WarningCircleIcon size={18} weight="bold" aria-hidden />
          {d.error}
        </p>
      )}

      <section className="no-print flex flex-col gap-4" aria-labelledby="sheet-title">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 id="sheet-title" className="text-[18px] font-bold tracking-[-0.01em]">
            {formatLongDate(log.date)}
          </h2>
          <dl className="flex flex-wrap gap-x-5 gap-y-2">
            {DUTY_ORDER.map((status) => (
              <div key={status} className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: DUTY[status].color }} aria-hidden />
                <dt className="text-[13px] text-body">{DUTY[status].label}</dt>
                <dd className="tnum font-mono text-[13px] font-medium">{formatHM(shownTotals[status])}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div
          className={`overflow-x-auto overscroll-x-contain rounded-2xl border bg-[#fefefd] shadow-float ${
            editing ? 'border-ink ring-4 ring-ink/10' : 'border-hairline'
          }`}
        >
          <div className="min-w-[880px]">
            <LogSheet
              key={log.date}
              log={shown}
              driver={draft?.driver ?? driver}
              dayCount={count}
              highlight={hover}
              animate={!editing}
              editing={d.sheetEditing}
              header={d.header}
            />
          </div>
        </div>
        <p className="text-[13px] text-body sm:hidden">
          {editing ? 'Use the entry list below to edit on a small screen.' : 'Scroll sideways to see the full sheet. Print for a full-page copy.'}
        </p>
      </section>

      {draft ? (
        <LogEditor
          draft={draft}
          onChange={d.updateDraft}
          onSnapshot={d.snapshot}
          preview={preview}
          previewing={d.previewing}
          previewError={d.previewError}
          reasonError={d.reasonError}
          reasonRef={d.reasonRef}
          onHover={setHover}
        />
      ) : (
        <section className="no-print grid gap-8 lg:grid-cols-[1fr_320px]" aria-label="Day details">
          <div className="flex flex-col gap-3">
            <h2 className="text-[18px] font-bold tracking-[-0.01em]">Changes of duty status</h2>
            <ol className="flex flex-col">
              {viewEntries.map((entry, i) => {
                return (
                  <li
                    key={i}
                    onMouseEnter={() => setHover(entry.start)}
                    onMouseLeave={() => setHover(null)}
                    className="grid grid-cols-[156px_1fr_auto] items-baseline gap-3 border-b border-hairline py-2.5 last:border-b-0"
                  >
                    <span className="tnum font-mono text-[13px] whitespace-nowrap text-body">
                      {formatMinuteOfDay(entry.start)} - {formatMinuteOfDay(entry.end)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[15px] font-medium">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: DUTY[entry.status].color }} aria-hidden />
                        <span className="truncate">{entryLabel(entry)}</span>
                        {entry.continued && <span className="text-[13px] font-normal text-mute">continued</span>}
                      </span>
                      <span className="block truncate text-[13px] text-body">
                        {entry.location || DUTY[entry.status].label}
                        {entry.kind === 'drive' && entry.miles ? `, ${entry.miles} mi` : ''}
                      </span>
                    </span>
                    <span className="tnum font-mono text-[13px] text-body">{formatHM(entry.end - entry.start)}</span>
                  </li>
                )
              })}
            </ol>
          </div>
          <aside className="flex flex-col gap-3">
            <h2 className="text-[18px] font-bold tracking-[-0.01em]">70-hour / 8-day recap</h2>
            <dl className="flex flex-col gap-3 rounded-2xl bg-soft p-4">
              <Recap label="On duty today" value={formatHM(log.recap.on_duty_today)} />
              <Recap label="Last 7 days, including today" value={formatHM(log.recap.last_7_days)} />
              <Recap label="Available tomorrow" value={formatHM(log.recap.available_tomorrow)} strong />
              <Recap label="Last 8 days, including today" value={formatHM(log.recap.last_8_days)} />
            </dl>
            <p className="text-[13px] text-body">
              Hours used before the trip ({trip.summary.cycle_used_start} h) are assumed to be as recent as possible, so
              they count until they leave the window or a 34-hour restart clears them.
            </p>
          </aside>
        </section>
      )}

      {printing && (
        <div className="print-only">
          {trip.logs.map((l) => (
            <div key={l.date} className="print-sheet">
              <LogSheet log={l} driver={driver} dayCount={count} animate={false} />
            </div>
          ))}
        </div>
      )}

      {blocker.state === 'blocked' && (
        <LeaveDialog
          onStay={() => blocker.reset()}
          onLeave={() => {
            d.stop()
            blocker.proceed()
          }}
        />
      )}
    </div>
  )
}

function LeaveDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const stay = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    stay.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onStay()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStay])
  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center overscroll-contain bg-ink/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        aria-describedby="leave-text"
        className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-float"
      >
        <h2 id="leave-title" className="text-[18px] font-bold">
          Discard unsaved changes?
        </h2>
        <p id="leave-text" className="mt-2 text-[15px] text-body">
          Your edits to this log have not been saved.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={stay} type="button" className="btn btn-subtle" onClick={onStay}>
            Keep Editing
          </button>
          <button type="button" className="btn bg-danger text-[#fefefd] hover:bg-danger/90" onClick={onLeave}>
            Discard Changes
          </button>
        </div>
      </div>
    </div>
  )
}

const editedAt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })

function EditedNotice({
  trip,
  index,
  canEdit,
  onTripChange,
}: {
  trip: Trip
  index: number
  canEdit: boolean
  onTripChange: (trip: Trip) => void
}) {
  const log = trip.logs[index]
  const edit = log.edit!
  const editCount = log.edits?.length ?? 1
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const date = new Date(edit.edited_at)
  const when = Number.isNaN(date.getTime()) ? 'an earlier date' : editedAt.format(date)

  useEffect(() => {
    if (!confirming) return
    const timer = window.setTimeout(() => setConfirming(false), 8000)
    return () => window.clearTimeout(timer)
  }, [confirming])

  async function restore() {
    setBusy(true)
    setFailed(false)
    try {
      onTripChange(await api.revertLog(trip.id, index))
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="no-print flex flex-col gap-3 rounded-2xl bg-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0 text-[14px]">
        <span className="font-semibold">Edited by driver{editCount > 1 ? ` ${editCount} times` : ''}</span>
        <span className="text-body">, last on {when}: </span>
        <span className="break-words">{edit.reason}</span>
        {failed && <span className="block text-danger">Could not restore the planned log. Try again.</span>}
      </p>
      {!canEdit ? null : confirming ? (
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn btn-ghost h-9 px-4 text-[14px]" onClick={() => setConfirming(false)} disabled={busy}>
            Keep Edits
          </button>
          <button type="button" className="btn h-9 bg-danger px-4 text-[14px] text-[#fefefd] hover:bg-danger/90" onClick={restore} disabled={busy}>
            {busy ? 'Restoring…' : 'Confirm Restore'}
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-subtle h-9 shrink-0 px-4 text-[14px]" onClick={() => setConfirming(true)}>
          Restore Planned Log
        </button>
      )}
    </div>
  )
}

function Recap({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[14px] text-body">{label}</dt>
      <dd className={`tnum font-mono ${strong ? 'text-[17px] font-semibold text-ink' : 'text-[14px]'}`}>{value}</dd>
    </div>
  )
}
