"""Driver edits to daily log sheets.

The first edit keeps a copy of the planned sheets so any day can be reverted.
Every edit carries the driver's reason, as ELD records require (395.30).
After an edit all sheets are refreshed, because hours on one day change the
recap and the limits of the days after it.
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone

from .hos import DRIVING, OFF_DUTY, ON_DUTY, SLEEPER
from .logs import DAY, refresh_logs

QUARTER = 15
MAX_EDIT_HISTORY = 50
# These checks come from the route plan (fuel stops, dock time), which log
# edits do not change.
PLAN_ONLY_CHECKS = {"fuel", "dock"}

KIND_STATUS = {
    "pre_trip": ON_DUTY,
    "post_trip": ON_DUTY,
    "pickup": ON_DUTY,
    "dropoff": ON_DUTY,
    "fuel": ON_DUTY,
    "on_duty": ON_DUTY,
    "drive": DRIVING,
    "break": OFF_DUTY,
    "restart": OFF_DUTY,
    "off_duty": OFF_DUTY,
    "rest": SLEEPER,
    "sleeper": SLEEPER,
}
GENERIC_KIND = {OFF_DUTY: "off_duty", SLEEPER: "sleeper", DRIVING: "drive", ON_DUTY: "on_duty"}


class EditError(ValueError):
    pass


def normalize_entries(entries: list[dict]) -> list[dict]:
    """Checks a day's entries cover midnight to midnight on the 15-minute grid
    and merges neighbors that say the same thing."""
    if not entries:
        raise EditError("A log needs at least one duty status.")
    cursor = 0
    clean: list[dict] = []
    for e in entries:
        start, end = e["start"], e["end"]
        if start % QUARTER or end % QUARTER:
            raise EditError("Times must fall on 15-minute marks.")
        if start != cursor:
            raise EditError("Duty statuses must follow each other with no gaps or overlaps.")
        if end <= start:
            raise EditError("Each duty status must last at least 15 minutes.")
        kind = e.get("kind") or ""
        if KIND_STATUS.get(kind) != e["status"]:
            kind = GENERIC_KIND[e["status"]]
        item = {
            "status": e["status"],
            "kind": kind,
            "start": start,
            "end": end,
            "note": (e.get("note") or "").strip(),
            "location": (e.get("location") or "").strip(),
            "miles": round(float(e.get("miles") or 0), 1) if e["status"] == DRIVING else 0.0,
        }
        last = clean[-1] if clean else None
        if last and all(last[k] == item[k] for k in ("status", "kind", "note", "location")):
            last["end"] = end
            last["miles"] = round(last["miles"] + item["miles"], 1)
        else:
            clean.append(item)
        cursor = end
    if cursor != DAY:
        raise EditError("The log must cover all 24 hours, midnight to midnight.")
    return clean


def refresh_result(result: dict) -> None:
    prior = round(result["summary"]["cycle_used_start"] * 60)
    check = refresh_logs(result["logs"], prior)
    by_key = {c["key"]: c for c in check["checks"]}
    result["compliance"] = [by_key.get(c["key"], c) for c in result["compliance"]]
    result["violations"] = check["violations"]
    result["edited"] = any("edit" in log for log in result["logs"])
    for c in result["compliance"]:
        if c["key"] in PLAN_ONLY_CHECKS and result["edited"]:
            c["basis"] = "plan"
        else:
            c.pop("basis", None)


def apply_edit(
    result: dict,
    day: int,
    entries: list[dict],
    miles: float,
    reason: str,
    *,
    from_place: str | None = None,
    to_place: str | None = None,
    total_mileage: float | None = None,
) -> None:
    logs = result["logs"]
    if not 0 <= day < len(logs):
        raise EditError("That day is not part of this trip.")
    result.setdefault("planned_logs", copy.deepcopy(logs))
    log = logs[day]
    log["entries"] = normalize_entries(entries)
    log["miles"] = round(miles, 1)
    # Total mileage counts every mile the vehicle moved, so it can exceed this driver's miles.
    log["total_mileage"] = round(total_mileage if total_mileage is not None else miles, 1)
    log["from"] = (from_place or "").strip() or log["entries"][0]["location"] or log["from"]
    log["to"] = (to_place or "").strip() or log["entries"][-1]["location"] or log["to"]
    edit = {"reason": reason.strip(), "edited_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    log["edit"] = edit
    # Every edit stays on record (395.30); the latest one is also under "edit".
    log["edits"] = [*log.get("edits", []), edit][-MAX_EDIT_HISTORY:]
    refresh_result(result)


def revert_day(result: dict, day: int) -> None:
    planned = result.get("planned_logs")
    if not planned or not 0 <= day < len(planned):
        raise EditError("This day has no edits to undo.")
    result["logs"][day] = copy.deepcopy(planned[day])
    refresh_result(result)
