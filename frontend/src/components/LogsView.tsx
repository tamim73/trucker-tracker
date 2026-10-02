import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  PencilSimpleIcon,
  PrinterIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError, api, type DailyLog, type LogEntry, type Trip } from '../lib/api'
import { EMPTY_DRIVER } from '../lib/driver'
import { DUTY, DUTY_ORDER, KIND } from '../lib/duty'
import { formatClock, formatDay, formatHM, formatLongDate, formatMiles } from '../lib/format'
import { draftLog, moveBoundary, normalize, paint, setStatus, totals, withLocations } from '../lib/logEdit'
import { LogEditor, type Draft } from './LogEditor'
import { LogSheet, type SheetEditing } from './LogSheet'

interface Props {
  trip: Trip
  onTripChange: (trip: Trip) => void
}

export function LogsView({ trip, onTripChange }: Props) {
  const [params, setParams] = useSearchParams()
  const count = trip.logs.length
  const requested = Number.parseInt(params.get('day') ?? '1', 10)
  const index = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), count) - 1 : 0
  const log = trip.logs[index]
  const driver = { ...EMPTY_DRIVER, ...(trip.inputs.driver ?? {}) }
  const [hover, setHover] = useState<number | null>(null)
  const tabs = useRef<HTMLDivElement>(null)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [past, setPast] = useState<LogEntry[][]>([])
  const [future, setFuture] = useState<LogEntry[][]>([])
  const [preview, setPreview] = useState<DailyLog | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [reasonError, setReasonError] = useState<string>()
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const editing = draft !== null
  const dirty = editing && (past.length > 0 || draft.reason.trim() !== '' || Number(draft.miles) !== log.miles)

  useEffect(() => {
    tabs.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [index])

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Server preview: recap and violations for the unsaved edit.
  const previewKey = draft && JSON.stringify([draft.entries, draft.miles, index])
  useEffect(() => {
    if (!draft || !previewKey) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setPreviewing(true)
      api
        .previewLog(trip.id, index, { entries: draft.entries, miles: Number(draft.miles) || 0, driver: draft.driver }, controller.signal)
        .then((t) => setPreview(t.logs[index]))
        .catch(() => undefined)
        .finally(() => !controller.signal.aborted && setPreviewing(false))
    }, 300)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey])

  function go(next: number) {
    if (editing) return
    setParams({ day: String(next + 1) }, { replace: true })
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowRight' && index < count - 1) go(index + 1)
    if (event.key === 'ArrowLeft' && index > 0) go(index - 1)
  }

  function startEditing() {
    setDraft({ entries: normalize(withLocations(log)), miles: String(log.miles), reason: '', driver })
    setPast([])
    setFuture([])
    setPreview(log)
    setError('')
    setReasonError(undefined)
  }

  function stopEditing() {
    setDraft(null)
    setPreview(null)
    setPast([])
    setFuture([])
  }

  const snapshot = useCallback((entries: LogEntry[]) => {
    setPast((p) => [...p.slice(-99), entries])
    setFuture([])
  }, [])

  const undo = useCallback(() => {
    if (!draft || past.length === 0) return
    setFuture((f) => [draft.entries, ...f])
    setDraft({ ...draft, entries: past[past.length - 1] })
    setPast((p) => p.slice(0, -1))
  }, [draft, past])

  const redo = useCallback(() => {
    if (!draft || future.length === 0) return
    setPast((p) => [...p, draft.entries])
    setDraft({ ...draft, entries: future[0] })
    setFuture((f) => f.slice(1))
  }, [draft, future])

  // Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z, unless a text field has focus.
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

  // A drag is applied to the entries as they were when it began, so the
  // dragged index stays valid while neighbors merge and split again.
  const dragBase = useRef<LogEntry[] | null>(null)
  const sheetEditing: SheetEditing | undefined = useMemo(() => {
    if (!draft) return undefined
    const fromBase = (apply: (entries: LogEntry[]) => LogEntry[]) =>
      setDraft((d) => d && { ...d, entries: apply(dragBase.current ?? d.entries) })
    const fromLatest = (apply: (entries: LogEntry[]) => LogEntry[]) => setDraft((d) => d && { ...d, entries: apply(d.entries) })
    return {
      onEditStart: () => {
        snapshot(draft.entries)
        dragBase.current = draft.entries
      },
      onEditEnd: () => {
        dragBase.current = null
      },
      onPaint: (status, from, to) => fromLatest((entries) => paint(entries, status, from, to)),
      onMoveBoundary: (i, minute) => fromBase((entries) => moveBoundary(entries, i, minute)),
      onMoveSegment: (i, status) => fromBase((entries) => setStatus(entries, i, status)),
      onNudgeBoundary: (i, delta) => fromLatest((entries) => moveBoundary(entries, i, (entries[i]?.start ?? 0) + delta)),
      onNudgeSegment: (i, direction) =>
        fromLatest((entries) => {
          const row = DUTY_ORDER.indexOf(entries[i]?.status) + direction
          return row < 0 || row >= DUTY_ORDER.length ? entries : setStatus(entries, i, DUTY_ORDER[row])
        }),
    }
  }, [draft, snapshot])

  async function save() {
    if (!draft) return
    if (draft.reason.trim().length < 3) {
      setReasonError('Add a short reason for this edit before saving.')
      reasonRef.current?.focus()
      return
    }
    setSaving(true)
    setError('')
    try {
      const updated = await api.saveLog(trip.id, index, {
        entries: draft.entries,
        miles: Number(draft.miles) || 0,
        reason: draft.reason.trim(),
        driver: draft.driver,
      })
      onTripChange(updated)
      stopEditing()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the log. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const previousStatus = index > 0 ? (trip.logs[index - 1].entries.at(-1)?.status ?? null) : null
  const shown: DailyLog = draft
    ? {
        ...draftLog({ ...log, ...(preview ?? {}) }, draft.entries, Number(draft.miles) || 0, previousStatus),
        edit: log.edit,
      }
    : log
  const shownDriver = draft?.driver ?? driver
  const shownTotals = draft ? totals(draft.entries) : log.totals

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
            <button type="button" className="btn btn-subtle" onClick={startEditing}>
              <PencilSimpleIcon size={18} weight="bold" aria-hidden />
              Edit Log
            </button>
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
            <button type="button" className="icon-btn" onClick={undo} disabled={past.length === 0} aria-label="Undo" title="Undo (Ctrl+Z)">
              <ArrowCounterClockwiseIcon size={18} weight="bold" aria-hidden />
            </button>
            <button type="button" className="icon-btn" onClick={redo} disabled={future.length === 0} aria-label="Redo" title="Redo (Shift+Ctrl+Z)">
              <ArrowClockwiseIcon size={18} weight="bold" aria-hidden />
            </button>
            <button type="button" className="btn btn-subtle h-10 px-4" onClick={stopEditing} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary h-10 px-4" onClick={save} disabled={saving}>
              {saving && <SpinnerGapIcon size={16} weight="bold" className="animate-spin" aria-hidden />}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      ) : (
        log.edit && <EditedNotice trip={trip} index={index} onTripChange={onTripChange} />
      )}
      {error && (
        <p role="alert" className="no-print flex items-center gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-[14px] text-danger">
          <WarningCircleIcon size={18} weight="bold" aria-hidden />
          {error}
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
              driver={shownDriver}
              dayCount={count}
              highlight={hover}
              animate={!editing}
              editing={sheetEditing}
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
          onChange={setDraft}
          onSnapshot={snapshot}
          preview={preview}
          previewing={previewing}
          reasonError={reasonError}
          reasonRef={reasonRef}
          onHover={setHover}
        />
      ) : (
        <section className="no-print grid gap-8 lg:grid-cols-[1fr_320px]" aria-label="Day details">
          <div className="flex flex-col gap-3">
            <h2 className="text-[18px] font-bold tracking-[-0.01em]">Changes of duty status</h2>
            <ol className="flex flex-col">
              {log.entries.map((entry, i) => {
                const location = entry.location ?? log.remarks.find((r) => r.minute === entry.start)?.location
                const label = entry.note && ['off_duty', 'sleeper', 'on_duty'].includes(entry.kind) ? entry.note : entry.kind === 'drive' ? 'Driving' : KIND[entry.kind].title
                return (
                  <li
                    key={i}
                    onMouseEnter={() => setHover(entry.start)}
                    onMouseLeave={() => setHover(null)}
                    className="grid grid-cols-[156px_1fr_auto] items-baseline gap-3 border-b border-hairline py-2.5 last:border-b-0"
                  >
                    <span className="tnum font-mono text-[13px] whitespace-nowrap text-body">
                      {formatClock(log.date, entry.start)} - {formatClock(log.date, entry.end)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[15px] font-medium">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: DUTY[entry.status].color }} aria-hidden />
                        <span className="truncate">{label}</span>
                        {entry.continued && <span className="text-[13px] font-normal text-mute">continued</span>}
                      </span>
                      <span className="block truncate text-[13px] text-body">
                        {location || DUTY[entry.status].label}
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
              Hours used before the trip ({trip.summary.cycle_used_start} h) stay in the window until a 34-hour restart, since
              their exact days are unknown.
            </p>
          </aside>
        </section>
      )}

      <div className="print-only">
        {trip.logs.map((l) => (
          <div key={l.date} className="print-sheet">
            <LogSheet log={l} driver={driver} dayCount={count} animate={false} />
          </div>
        ))}
      </div>
    </div>
  )
}

function EditedNotice({ trip, index, onTripChange }: { trip: Trip; index: number; onTripChange: (trip: Trip) => void }) {
  const edit = trip.logs[index].edit!
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(edit.edited_at))

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
        <span className="font-semibold">Edited by driver</span>
        <span className="text-body"> on {when}: </span>
        <span className="break-words">{edit.reason}</span>
        {failed && <span className="block text-danger">Could not restore the planned log. Try again.</span>}
      </p>
      {confirming ? (
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
