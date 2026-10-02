"""Builds a full trip plan: places, route, HOS schedule, logs, compliance."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from .geo import GeoError, geocode, label_many, route_trip
from .hos import DRIVING, ON_DUTY, OFF_DUTY, SLEEPER, HosRules, TripPlanner
from .logs import build_daily_logs, compliance_report, full_timeline, refresh_logs

ROLE_ORDER = ("current", "pickup", "dropoff")


def resolve_place(place: dict) -> dict:
    if place.get("lat") is not None and place.get("lon") is not None:
        return {"label": place["label"], "lat": place["lat"], "lon": place["lon"]}
    found = geocode(place["label"])
    return {"label": found["label"], "lat": found["lat"], "lon": found["lon"]}


def round_departure(departure: datetime) -> datetime:
    """Rounds up to the next 15-minute mark, the paper log's resolution, so the
    plan never starts before the time the driver gave. May roll to the next day."""
    base = departure.replace(second=0, microsecond=0)
    if base != departure:
        base += timedelta(minutes=1)
    return base + timedelta(minutes=(-base.minute) % 15)


def _key(coord: tuple[float, float]) -> tuple[float, float]:
    return (round(coord[0], 4), round(coord[1], 4))


def plan_trip(data: dict) -> dict:
    rules = HosRules()
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {role: pool.submit(resolve_place, data[role]) for role in ROLE_ORDER}
        places, errors = {}, {}
        for role, future in futures.items():
            try:
                places[role] = future.result()
            except GeoError as exc:
                errors[role] = str(exc)
    if errors:
        raise PlaceErrors(errors)

    legs, estimated = route_trip(places["current"], places["pickup"], places["dropoff"])
    departure = round_departure(data["departure"])
    start_minute = departure.hour * 60 + departure.minute
    plan = TripPlanner(legs, data["cycle_used_hours"], start_minute, rules).plan()
    timeline = full_timeline(plan)

    # Known stops keep the label the driver chose; everything else is
    # reverse geocoded to "City, ST" for the log remarks.
    known = {_key((p["lon"], p["lat"])): p["label"] for p in places.values()}
    for leg in legs:
        if leg.geometry:
            known.setdefault(_key(leg.geometry[0]), leg.origin)
            known.setdefault(_key(leg.geometry[-1]), leg.destination)
    needed = [c for s in timeline for c in (s.coord_start, s.coord_end) if _key(c) not in known]
    labels = {**label_many(needed), **known}

    def label(coord):
        return labels.get(_key(coord)) or f"{coord[1]:.3f}, {coord[0]:.3f}"

    logs = build_daily_logs(plan, departure.date(), label, rules)
    compliance = compliance_report(plan, rules)

    segments = [
        {
            "id": i,
            "status": s.status,
            "kind": s.kind,
            "start": s.start,
            "end": s.end,
            "note": s.note,
            "miles": round(s.miles, 1),
            "odometer": round(s.odometer_end, 1),
            "from": {"label": label(s.coord_start), "lon": s.coord_start[0], "lat": s.coord_start[1]},
            "to": {"label": label(s.coord_end), "lon": s.coord_end[0], "lat": s.coord_end[1]},
            "leg": s.leg,
        }
        for i, s in enumerate(plan.segments)
    ]

    def total(status):
        return sum(s.duration for s in plan.segments if s.status == status)

    driving = total(DRIVING)
    miles = sum(s.miles for s in plan.segments)
    kinds = [s.kind for s in plan.segments]
    summary = {
        "start_date": departure.date().isoformat(),
        "start_minute": plan.start_minute,
        "end_minute": plan.end_minute,
        "pickup_minute": next(s.start for s in plan.segments if s.kind == "pickup"),
        "dropoff_minute": next(s.start for s in plan.segments if s.kind == "dropoff"),
        "total_miles": round(miles, 1),
        "driving_minutes": driving,
        "on_duty_minutes": total(ON_DUTY),
        "rest_minutes": total(OFF_DUTY) + total(SLEEPER),
        "elapsed_minutes": plan.end_minute - plan.start_minute,
        "days": len(logs),
        "average_mph": round(miles / (driving / 60), 1) if driving else 0,
        "fuel_stops": kinds.count("fuel"),
        "breaks": kinds.count("break"),
        "rests": kinds.count("rest"),
        "restarts": kinds.count("restart"),
        "cycle_used_start": round(plan.prior_cycle_minutes / 60, 2),
        "estimated_route": estimated,
    }

    lons = [p[0] for leg in legs for p in leg.geometry]
    lats = [p[1] for leg in legs for p in leg.geometry]
    route = {
        "bbox": [min(lons), min(lats), max(lons), max(lats)] if lons else None,
        "legs": [
            {
                "from": leg.origin,
                "to": leg.destination,
                "miles": round(leg.distance_miles, 1),
                "router_minutes": round(leg.duration_minutes),
                "planned_mph": round(speed, 1),
                "geometry": leg.geometry,
            }
            for leg, speed in zip(legs, plan.leg_speeds)
        ],
    }

    return {
        "places": places,
        "summary": summary,
        "route": route,
        "segments": segments,
        "logs": logs,
        "compliance": compliance,
        "violations": refresh_logs(logs, plan.prior_cycle_minutes, rules)["violations"],
        "edited": False,
        "rules": {
            "max_driving": rules.max_driving,
            "duty_window": rules.duty_window,
            "driving_before_break": rules.driving_before_break,
            "cycle_limit": rules.cycle_limit,
            "fuel_interval_miles": rules.fuel_interval_miles,
            "max_speed_mph": rules.max_speed_mph,
        },
    }


class PlaceErrors(Exception):
    def __init__(self, errors: dict[str, str]):
        super().__init__("; ".join(errors.values()))
        self.errors = errors
