"""Daily log sheets, the 70-hour recap and the hours-of-service check.

Everything after the initial build works from the log entries alone, so the
same code recomputes totals, remarks, recap and violations after a driver
edits a sheet.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Callable, Iterable

from .hos import (
    DRIVING,
    OFF_DUTY,
    ON_DUTY,
    REST_STATUSES,
    STATUSES,
    WORK_STATUSES,
    HosRules,
    Segment,
    TripPlan,
)

DAY = 24 * 60

Labeler = Callable[[tuple[float, float]], str]

HOS_CHECKS = {
    "driving": ("11-hour driving limit", "395.3(a)(3)"),
    "window": ("14-hour duty window", "395.3(a)(2)"),
    "break": ("30-minute break after 8 hours driving", "395.3(a)(3)(ii)"),
    "cycle": ("70-hour / 8-day limit", "395.3(b)(2)"),
}


@dataclass
class Record:
    """A duty status period in absolute minutes from the first log midnight."""

    status: str
    start: int
    end: int

    @property
    def duration(self) -> int:
        return self.end - self.start


# -- initial build from a plan -------------------------------------------------


def full_timeline(plan: TripPlan) -> list[Segment]:
    """Pads the plan with off-duty time so it covers whole calendar days."""
    segments = plan.segments
    first, last = segments[0], segments[-1]
    padded: list[Segment] = []
    if plan.start_minute > 0:
        padded.append(
            Segment(OFF_DUTY, "off_duty", 0, plan.start_minute, "Off duty before departure",
                    0.0, 0.0, first.coord_start, first.coord_start)
        )
    padded.extend(segments)
    day_end = -(-plan.end_minute // DAY) * DAY
    if day_end > plan.end_minute:
        padded.append(
            Segment(OFF_DUTY, "off_duty", plan.end_minute, day_end, "Off duty, trip complete",
                    last.odometer_end, last.odometer_end, last.coord_end, last.coord_end)
        )
    return padded


def build_daily_logs(
    plan: TripPlan,
    start_date: date,
    label: Labeler,
    rules: HosRules | None = None,
) -> list[dict]:
    rules = rules or HosRules()
    timeline = full_timeline(plan)
    day_count = timeline[-1].end // DAY

    logs = []
    for d in range(day_count):
        day_start, day_end = d * DAY, (d + 1) * DAY
        entries = []
        miles = 0.0
        for seg in timeline:
            start, end = max(seg.start, day_start), min(seg.end, day_end)
            if start >= end:
                continue
            share = (end - start) / seg.duration if seg.duration else 0
            seg_miles = seg.miles * share
            if seg.status == DRIVING:
                miles += seg_miles
            entries.append(
                {
                    "status": seg.status,
                    "kind": seg.kind,
                    "start": start - day_start,
                    "end": end - day_start,
                    "note": seg.note,
                    "location": label(seg.coord_start if seg.start >= day_start else _coord_at(seg, day_start)),
                    "miles": round(seg_miles, 1),
                }
            )

        last = next(s for s in reversed(timeline) if s.start < day_end)
        logs.append(
            {
                "index": d,
                "date": (start_date + timedelta(days=d)).isoformat(),
                "entries": entries,
                "miles": round(miles, 1),
                "from": entries[0]["location"],
                "to": label(last.coord_end if last.end <= day_end else _coord_at(last, day_end)),
            }
        )
    refresh_logs(logs, plan.prior_cycle_minutes, rules)
    return logs


def _coord_at(seg: Segment, minute: int) -> tuple[float, float]:
    if seg.status != DRIVING or seg.duration == 0:
        return seg.coord_end if minute >= seg.end else seg.coord_start
    f = (minute - seg.start) / seg.duration
    (x1, y1), (x2, y2) = seg.coord_start, seg.coord_end
    return (x1 + (x2 - x1) * f, y1 + (y2 - y1) * f)


# -- derived fields, shared by planning and editing ----------------------------


def records_from_logs(logs: list[dict]) -> list[Record]:
    records: list[Record] = []
    for d, log in enumerate(logs):
        for e in log["entries"]:
            start, end = d * DAY + e["start"], d * DAY + e["end"]
            if records and records[-1].status == e["status"] and records[-1].end == start:
                records[-1].end = end
            else:
                records.append(Record(e["status"], start, end))
    return records


def refresh_logs(logs: list[dict], prior_cycle: int, rules: HosRules | None = None) -> dict:
    """Recomputes totals, remarks, recap and violations for every sheet.
    Returns the hours-of-service check across all sheets."""
    rules = rules or HosRules()
    records = records_from_logs(logs)
    restarts = _restart_ends(records, rules)
    check = hos_check(records, prior_cycle, rules)

    previous_status = None
    for d, log in enumerate(logs):
        day_start, day_end = d * DAY, (d + 1) * DAY
        totals = {status: 0 for status in STATUSES}
        remarks = []
        for i, e in enumerate(log["entries"]):
            totals[e["status"]] += e["end"] - e["start"]
            continued = i == 0 and (d == 0 or e["status"] == previous_status)
            e["continued"] = continued and d > 0
            if not continued:
                remarks.append(
                    {
                        "minute": e["start"],
                        "end_minute": e["end"],
                        "status": e["status"],
                        "kind": e["kind"],
                        "location": e.get("location", ""),
                        "note": e.get("note", ""),
                    }
                )
        previous_status = log["entries"][-1]["status"]
        log["totals"] = totals
        log["remarks"] = remarks
        log["recap"] = _recap(d, records, prior_cycle, restarts, rules)
        log["violations"] = [
            {**v, "start": max(v["start"], day_start) - day_start, "end": min(v["end"], day_end) - day_start}
            for v in check["violations"]
            if v["start"] < day_end and v["end"] > day_start
        ]
    return check


def _restart_ends(records: list[Record], rules: HosRules) -> list[int]:
    """End times of rest periods long enough to restart the cycle."""
    ends, streak = [], 0
    for r in records:
        if r.status in REST_STATUSES:
            streak += r.duration
        else:
            if streak >= rules.cycle_restart:
                ends.append(r.start)
            streak = 0
    if streak >= rules.cycle_restart and records:
        ends.append(records[-1].end)
    return ends


def _worked(records: Iterable[Record], lo: int, hi: int) -> int:
    return sum(max(0, min(r.end, hi) - max(r.start, lo)) for r in records if r.status in WORK_STATUSES)


def _recap(d: int, records: list[Record], prior: int, restarts: list[int], rules: HosRules) -> dict:
    """70-hour / 8-day recap at the end of day ``d``.

    Hours used before the trip stay inside the window for the whole trip
    (conservative, since their exact days are unknown) until a 34-hour
    restart clears the cycle. Work before the latest restart never counts."""
    day_start, day_end = d * DAY, (d + 1) * DAY
    done = [t for t in restarts if t <= day_end]
    cutoff = max(done) if done else None
    carry = prior if cutoff is None else 0
    floor = cutoff if cutoff is not None else -10**9
    last7 = carry + _worked(records, max((d - 6) * DAY, floor), day_end)
    last8 = carry + _worked(records, max((d - 7) * DAY, floor), day_end)
    return {
        "on_duty_today": _worked(records, day_start, day_end),
        "last_7_days": last7,
        "available_tomorrow": max(0, rules.cycle_limit - last7),
        "last_8_days": last8,
        "restart_completed": any(day_start < t <= day_end for t in restarts),
    }


def hos_check(records: list[Record], prior_cycle: int, rules: HosRules) -> dict:
    """Worst value for each limit plus every period of driving that breaks one.
    The driver is assumed rested before the first record."""
    shift_start = None
    shift_driving = since_break = non_driving = 0
    rest = rules.shift_reset
    cycle = prior_cycle
    worst = {key: 0 for key in HOS_CHECKS}
    violations: list[dict] = []

    def flag(key: str, start: int, end: int):
        last = violations[-1] if violations else None
        if last and last["key"] == key and last["end"] == start:
            last["end"] = end
        else:
            violations.append({"key": key, "title": HOS_CHECKS[key][0], "start": start, "end": end})

    for r in records:
        dur = r.duration
        if r.status in WORK_STATUSES:
            if shift_start is None:
                shift_start = r.start
            rest = 0
        else:
            rest += dur
            if rest >= rules.shift_reset:
                shift_start, shift_driving, since_break = None, 0, 0
            if rest >= rules.cycle_restart:
                cycle = 0

        if r.status == DRIVING:
            non_driving = 0
            if shift_driving + dur > rules.max_driving:
                flag("driving", r.start + max(0, rules.max_driving - shift_driving), r.end)
            if r.end > shift_start + rules.duty_window:
                flag("window", max(r.start, shift_start + rules.duty_window), r.end)
            if since_break + dur > rules.driving_before_break:
                flag("break", r.start + max(0, rules.driving_before_break - since_break), r.end)
            if cycle + dur > rules.cycle_limit:
                flag("cycle", r.start + max(0, rules.cycle_limit - cycle), r.end)
            shift_driving += dur
            since_break += dur
            cycle += dur
            worst["driving"] = max(worst["driving"], shift_driving)
            worst["window"] = max(worst["window"], r.end - shift_start)
            worst["break"] = max(worst["break"], since_break)
            worst["cycle"] = max(worst["cycle"], cycle)
        else:
            if r.status == ON_DUTY:
                cycle += dur
            non_driving += dur
            if non_driving >= rules.break_length:
                since_break = 0

    limits = {
        "driving": rules.max_driving,
        "window": rules.duty_window,
        "break": rules.driving_before_break,
        "cycle": rules.cycle_limit,
    }
    checks = [
        {
            "key": key,
            "title": title,
            "value": worst[key],
            "limit": limits[key],
            "unit": "minutes",
            "rule": rule,
            "ok": not any(v["key"] == key for v in violations),
        }
        for key, (title, rule) in HOS_CHECKS.items()
    ]
    return {"checks": checks, "violations": violations}


def compliance_report(plan: TripPlan, rules: HosRules | None = None) -> list[dict]:
    """Re-checks the planned timeline against each limit and trip assumption."""
    rules = rules or HosRules()
    records = [Record(s.status, s.start, s.end) for s in plan.segments]
    hos = hos_check(records, plan.prior_cycle_minutes, rules)

    miles_since_fuel = worst_fuel_gap = 0.0
    pickup = dropoff = 0
    for seg in plan.segments:
        if seg.status == DRIVING:
            miles_since_fuel += seg.miles
            worst_fuel_gap = max(worst_fuel_gap, miles_since_fuel)
        if seg.kind == "fuel":
            miles_since_fuel = 0.0
        if seg.kind == "pickup":
            pickup += seg.duration
        if seg.kind == "dropoff":
            dropoff += seg.duration

    return [
        *hos["checks"],
        {
            "key": "fuel",
            "title": "Fuel at least every 1,000 miles",
            "value": round(worst_fuel_gap, 1),
            "limit": rules.fuel_interval_miles,
            "unit": "miles",
            "rule": "Trip assumption",
            "ok": worst_fuel_gap <= rules.fuel_interval_miles,
        },
        {
            "key": "dock",
            "title": "1 hour each for pickup and drop-off",
            "value": min(pickup, dropoff),
            "limit": rules.pickup,
            "unit": "minutes",
            "rule": "Trip assumption",
            "ok": pickup == rules.pickup and dropoff == rules.dropoff,
        },
    ]
