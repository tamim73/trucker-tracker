import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SheetEditing } from '../components/LogEditLayer'
import type { HeaderEditing } from '../components/LogSheet'
import type { Draft } from '../components/LogEditor'
import { ApiError, api, type DailyLog, type DriverDetails, type LogEntry, type Trip } from '../lib/api'
import { DUTY_ORDER } from '../lib/duty'
import { moveBoundary, normalize, paint, setStatus, withLocations } from '../lib/logEdit'

const MAX_UNDO = 100

function editPayload(draft: Draft) {
  return {
    entries: draft.entries,
    miles: Number(draft.miles) || 0,
    total_mileage: Number(draft.totalMileage) || 0,
    from_place: draft.from,
    to_place: draft.to,
    driver: draft.driver,
  }
}

/**
 * State for editing one day's log: the draft, undo/redo, the server preview
 * (recap and violations) and saving. Sheet drags are applied to the entries
 * as they were when the drag began, so the dragged index stays valid while
 * neighbors merge; an undo step is recorded only if the entries changed.
 */
export function useLogDraft(trip: Trip, index: number, onTripChange: (trip: Trip) => void) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [past, setPast] = useState<LogEntry[][]>([])
  const [future, setFuture] = useState<LogEntry[][]>([])
  const [preview, setPreview] = useState<DailyLog | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [reasonError, setReasonError] = useState<string>()
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const [initialDraft, setInitialDraft] = useState<Draft | null>(null)
  const draftRef = useRef<Draft | null>(null)
  const editBase = useRef<LogEntry[] | null>(null)

  useLayoutEffect(() => {
    draftRef.current = draft
  })

  const editing = draft !== null
  const dirty = editing && draft !== initialDraft

  // Recompute recap and violations on the server for the unsaved edit.
  const previewKey = draft && JSON.stringify([draft.entries, draft.miles, draft.totalMileage, index])
  useEffect(() => {
    const current = draftRef.current
    if (!current || !previewKey) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setPreviewing(true)
      api
        .previewLog(trip.id, index, editPayload(current), controller.signal)
        .then((t) => {
          setPreview(t.logs[index] ?? null)
          setPreviewError('')
        })
        .catch((err) => {
          if (controller.signal.aborted) return
          setPreview(null)
          setPreviewError(err instanceof ApiError ? err.message : 'Could not check this edit.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewing(false)
        })
    }, 300)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
      setPreviewing(false)
    }
  }, [previewKey, trip.id, index])

  const start = useCallback((log: DailyLog, driver: DriverDetails) => {
    const initial: Draft = {
      entries: normalize(withLocations(log)),
      miles: String(Math.round(log.miles)),
      totalMileage: String(Math.round(log.total_mileage ?? log.miles)),
      from: log.from,
      to: log.to,
      reason: '',
      driver,
    }
    setInitialDraft(initial)
    setDraft(initial)
    setPast([])
    setFuture([])
    setPreview(log)
    setPreviewError('')
    setError('')
    setReasonError(undefined)
  }, [])

  const stop = useCallback(() => {
    setInitialDraft(null)
    setDraft(null)
    setPreview(null)
    setPreviewError('')
    setPast([])
    setFuture([])
  }, [])

  const snapshot = useCallback((entries: LogEntry[]) => {
    setPast((p) => [...p.slice(-(MAX_UNDO - 1)), entries])
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

  const sheetEditing: SheetEditing | undefined = useMemo(() => {
    if (!editing) return undefined
    const fromBase = (apply: (entries: LogEntry[]) => LogEntry[]) =>
      setDraft((d) => d && { ...d, entries: apply(editBase.current ?? d.entries) })
    const fromLatest = (apply: (entries: LogEntry[]) => LogEntry[]) => setDraft((d) => d && { ...d, entries: apply(d.entries) })
    return {
      onEditStart: () => {
        editBase.current = draftRef.current?.entries ?? null
      },
      onEditEnd: () => {
        const base = editBase.current
        editBase.current = null
        if (!base) return
        // Check after React has applied the edit; record undo only for real changes.
        window.setTimeout(() => {
          if (draftRef.current && draftRef.current.entries !== base) snapshot(base)
        }, 0)
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
  }, [editing, snapshot])

  const header: HeaderEditing | undefined = useMemo(() => {
    if (!draft) return undefined
    return {
      day: { from: draft.from, to: draft.to, miles: draft.miles, totalMileage: draft.totalMileage },
      onDayChange: (field, value) => setDraft((d) => d && { ...d, [field]: value }),
      onDriverChange: (field, value) => setDraft((d) => d && { ...d, driver: { ...d.driver, [field]: value } }),
    }
  }, [draft])

  const save = useCallback(async () => {
    if (!draft) return
    if (draft.reason.trim().length < 3) {
      setReasonError('Add a short reason for this edit before saving.')
      reasonRef.current?.focus()
      return
    }
    setSaving(true)
    setError('')
    try {
      const updated = await api.saveLog(trip.id, index, { ...editPayload(draft), reason: draft.reason.trim() })
      stop()
      onTripChange(updated)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the log. Try again.')
    } finally {
      setSaving(false)
    }
  }, [draft, trip.id, index, onTripChange, stop])

  const updateDraft = useCallback((next: Draft) => {
    setDraft(next)
    if (next.reason.trim().length >= 3) setReasonError(undefined)
  }, [])

  return {
    draft,
    editing,
    dirty,
    preview,
    previewing,
    previewError,
    saving,
    error,
    reasonError,
    reasonRef,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    start,
    stop,
    undo,
    redo,
    save,
    snapshot,
    updateDraft,
    sheetEditing,
    header,
  }
}
