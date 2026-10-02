"""Hours-of-service trip planner for a property-carrying driver (49 CFR 395).

The planner simulates the trip on a 15-minute grid, the same resolution a
paper log uses. Every limit is re-evaluated before each driving chunk:

* 11 hours of driving after 10 consecutive hours off duty (395.3(a)(3)).
* No driving after the 14th hour since coming on duty (395.3(a)(2)).
* 30 consecutive non-driving minutes after 8 cumulative hours of driving
  (395.3(a)(3)(ii)). Any non-driving status counts, so fuel, pickup and
  drop-off stops of 30+ minutes reset the counter.
* No driving after 70 on-duty hours in 8 consecutive days (395.3(b)(2)).
  A 34-hour off-duty period restarts the cycle (395.3(c)).

Trip assumptions from the brief: fuel at least every 1,000 miles and one hour
on duty for pickup and for drop-off.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

OFF_DUTY = "off_duty"
SLEEPER = "sleeper_berth"
DRIVING = "driving"
ON_DUTY = "on_duty"

STATUSES = (OFF_DUTY, SLEEPER, DRIVING, ON_DUTY)
WORK_STATUSES = (DRIVING, ON_DUTY)
REST_STATUSES = (OFF_DUTY, SLEEPER)

QUARTER = 15  # minutes, the paper-log grid resolution


@dataclass(frozen=True)
class HosRules:
    max_driving: int = 11 * 60
    duty_window: int = 14 * 60
    driving_before_break: int = 8 * 60
    break_length: int = 30
    shift_reset: int = 10 * 60
    cycle_limit: int = 70 * 60
    cycle_restart: int = 34 * 60
    fuel_interval_miles: float = 1000.0
    fuel_stop: int = 30
    pickup: int = 60
    dropoff: int = 60
    inspection: int = 15
    max_speed_mph: float = 60.0
    # When a 30-minute break is due and the tank is this far into its range,
    # fuel during the break instead of making a separate stop later.
    fuel_with_break_after_miles: float = 650.0


@dataclass
class Leg:
    """A routed leg between two stops. ``geometry`` is a list of (lon, lat)."""

    origin: str
    destination: str
    distance_miles: float
    duration_minutes: float
    geometry: list[tuple[float, float]]

    @property
    def speed_mph(self) -> float:
        if self.duration_minutes <= 0:
            return 0.0
        return self.distance_miles / (self.duration_minutes / 60)


@dataclass
class Segment:
    status: str
    kind: str
    start: int  # minutes since midnight of the first log day
    end: int
    note: str
    odometer_start: float
    odometer_end: float
    coord_start: tuple[float, float]  # (lon, lat)
    coord_end: tuple[float, float]
    leg: int | None = None

    @property
    def duration(self) -> int:
        return self.end - self.start

    @property
    def miles(self) -> float:
        return self.odometer_end - self.odometer_start


@dataclass
class PlanState:
    t: int
    odometer: float = 0.0
    shift_start: int | None = None
    shift_driving: int = 0
    driving_since_break: int = 0
    non_driving_streak: int = 0
    rest_streak: int = 0
    cycle_used: int = 0
    miles_since_fuel: float = 0.0


@dataclass
class TripPlan:
    segments: list[Segment]
    start_minute: int
    end_minute: int
    prior_cycle_minutes: int
    leg_speeds: list[float] = field(default_factory=list)


def floor_quarter(minutes: float) -> int:
    return int(math.floor(minutes / QUARTER + 1e-9)) * QUARTER


def ceil_quarter(minutes: float) -> int:
    return int(math.ceil(minutes / QUARTER - 1e-9)) * QUARTER


class PathCursor:
    """Maps a distance along a leg polyline to a coordinate."""

    def __init__(self, geometry: list[tuple[float, float]], total_miles: float):
        self.points = geometry or [(0.0, 0.0)]
        cumulative = [0.0]
        for a, b in zip(self.points, self.points[1:]):
            cumulative.append(cumulative[-1] + haversine_miles(a, b))
        measured = cumulative[-1]
        # Scale measured polyline length to the router's road distance.
        scale = (total_miles / measured) if measured > 0 else 0.0
        self.cumulative = [c * scale for c in cumulative]

    def at(self, miles: float) -> tuple[float, float]:
        pts, cum = self.points, self.cumulative
        if miles <= 0 or len(pts) == 1:
            return pts[0]
        if miles >= cum[-1]:
            return pts[-1]
        lo, hi = 0, len(cum) - 1
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if cum[mid] <= miles:
                lo = mid
            else:
                hi = mid
        span = cum[hi] - cum[lo]
        f = 0.0 if span <= 0 else (miles - cum[lo]) / span
        (x1, y1), (x2, y2) = pts[lo], pts[hi]
        return (x1 + (x2 - x1) * f, y1 + (y2 - y1) * f)


def haversine_miles(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 3958.8 * math.asin(math.sqrt(h))


class TripPlanner:
    def __init__(
        self,
        legs: list[Leg],
        cycle_used_hours: float,
        start_minute: int,
        rules: HosRules | None = None,
    ):
        if len(legs) != 2:
            raise ValueError("A trip has exactly two legs: to pickup and to drop-off.")
        self.legs = legs
        self.rules = rules or HosRules()
        self.prior_cycle = int(round(max(0.0, min(70.0, cycle_used_hours)) * 60))
        # Paper logs use 15-minute marks: snap departure to the nearest one on the same day.
        self.start_minute = min(int(round(start_minute / QUARTER)) * QUARTER, 24 * 60 - QUARTER)
        self.segments: list[Segment] = []
        # The driver starts rested: at least 10 hours off before departure.
        self.s = PlanState(t=self.start_minute, cycle_used=self.prior_cycle, rest_streak=self.rules.shift_reset)
        self.coord = legs[0].geometry[0] if legs[0].geometry else (0.0, 0.0)

    # -- public -----------------------------------------------------------

    def plan(self) -> TripPlan:
        r = self.rules
        speeds = []
        for index, leg in enumerate(self.legs):
            speeds.append(self._drive_leg(index, leg))
            if index == 0:
                self._work(ON_DUTY, "pickup", r.pickup, f"Pickup at {leg.destination}: loading")
            else:
                self._work(ON_DUTY, "dropoff", r.dropoff, f"Drop-off at {leg.destination}: unloading")
        self._work(ON_DUTY, "post_trip", r.inspection, "Post-trip inspection")
        return TripPlan(
            segments=self.segments,
            start_minute=self.start_minute,
            end_minute=self.s.t,
            prior_cycle_minutes=self.prior_cycle,
            leg_speeds=speeds,
        )

    # -- driving ----------------------------------------------------------

    def _drive_leg(self, index: int, leg: Leg) -> float:
        r = self.rules
        if leg.distance_miles < 0.25:
            if leg.geometry:
                self.coord = leg.geometry[-1]
            return 0.0

        speed = min(leg.speed_mph or r.max_speed_mph, r.max_speed_mph)
        cursor = PathCursor(leg.geometry, leg.distance_miles)
        done = 0.0

        while leg.distance_miles - done > 1e-6:
            remaining = leg.distance_miles - done
            self._prepare_to_drive(remaining, speed)

            s = self.s
            allowed = floor_quarter(
                min(
                    r.max_driving - s.shift_driving,
                    s.shift_start + r.duty_window - s.t,
                    r.driving_before_break - s.driving_since_break,
                    r.cycle_limit - s.cycle_used,
                )
            )
            fuel_left = r.fuel_interval_miles - s.miles_since_fuel
            finish = ceil_quarter(remaining / speed * 60)

            if finish <= allowed and remaining <= fuel_left + 1e-6:
                minutes, miles = finish, remaining
            else:
                minutes = allowed
                if fuel_left < remaining:
                    minutes = min(minutes, floor_quarter(fuel_left / speed * 60))
                miles = min(remaining, speed * minutes / 60)

            if minutes <= 0:  # pragma: no cover - guarded by _prepare_to_drive
                raise RuntimeError("Planner could not make progress.")

            start_coord = self.coord
            end_coord = cursor.at(done + miles)
            self._append(
                DRIVING,
                "drive",
                minutes,
                f"Driving toward {leg.destination}",
                miles=miles,
                coord_start=start_coord,
                coord_end=end_coord,
                leg=index,
            )
            done += miles
        return speed

    def _prepare_to_drive(self, remaining_miles: float, speed: float) -> None:
        """Insert whatever rest, break, fuel or inspection the rules require."""
        r = self.rules
        for _ in range(12):
            s = self.s
            if r.cycle_limit - s.cycle_used < QUARTER:
                self._rest(OFF_DUTY, "restart", r.cycle_restart, "34-hour restart: 70-hour cycle reached")
                continue
            if s.shift_start is not None:
                window_left = s.shift_start + r.duty_window - s.t
                driving_left = r.max_driving - s.shift_driving
                if min(window_left, driving_left) < QUARTER:
                    reason = "11-hour driving limit" if driving_left <= window_left else "14-hour duty window"
                    self._rest(SLEEPER, "rest", r.shift_reset, f"10-hour break in sleeper berth ({reason} reached)")
                    continue
            if s.shift_start is None:
                self._work(ON_DUTY, "pre_trip", r.inspection, "Pre-trip inspection")
                continue
            fuel_left = r.fuel_interval_miles - s.miles_since_fuel
            if fuel_left < remaining_miles and floor_quarter(fuel_left / speed * 60) < QUARTER:
                self._work(ON_DUTY, "fuel", r.fuel_stop, "Fuel stop")
                continue
            if r.driving_before_break - s.driving_since_break < QUARTER:
                if s.miles_since_fuel >= r.fuel_with_break_after_miles:
                    self._work(ON_DUTY, "fuel", r.fuel_stop, "Fuel stop (counts as 30-minute break)")
                else:
                    self._rest(OFF_DUTY, "break", r.break_length, "30-minute break (8 hours of driving reached)")
                continue
            return
        raise RuntimeError("Planner could not satisfy hours-of-service limits.")  # pragma: no cover

    # -- non-driving ------------------------------------------------------

    def _work(self, status: str, kind: str, minutes: int, note: str) -> None:
        self._append(status, kind, minutes, note)

    def _rest(self, status: str, kind: str, minutes: int, note: str) -> None:
        self._append(status, kind, minutes, note)

    def _append(
        self,
        status: str,
        kind: str,
        minutes: int,
        note: str,
        *,
        miles: float = 0.0,
        coord_start: tuple[float, float] | None = None,
        coord_end: tuple[float, float] | None = None,
        leg: int | None = None,
    ) -> None:
        r, s = self.rules, self.s
        start_coord = coord_start or self.coord
        end_coord = coord_end or self.coord
        self.segments.append(
            Segment(
                status=status,
                kind=kind,
                start=s.t,
                end=s.t + minutes,
                note=note,
                odometer_start=s.odometer,
                odometer_end=s.odometer + miles,
                coord_start=start_coord,
                coord_end=end_coord,
                leg=leg,
            )
        )

        if status in WORK_STATUSES:
            if s.shift_start is None:
                s.shift_start = s.t
            s.cycle_used += minutes
            s.rest_streak = 0
        else:
            s.rest_streak += minutes
            if s.rest_streak >= r.shift_reset:
                s.shift_start = None
                s.shift_driving = 0
                s.driving_since_break = 0
            if s.rest_streak >= r.cycle_restart:
                s.cycle_used = 0

        if status == DRIVING:
            s.shift_driving += minutes
            s.driving_since_break += minutes
            s.non_driving_streak = 0
            s.miles_since_fuel += miles
            s.odometer += miles
        else:
            s.non_driving_streak += minutes
            if s.non_driving_streak >= r.break_length:
                s.driving_since_break = 0
            if kind == "fuel":
                s.miles_since_fuel = 0.0

        s.t += minutes
        self.coord = end_coord
