from datetime import date

from django.test import SimpleTestCase

from trips.services.hos import DRIVING, ON_DUTY, SLEEPER, HosRules, Leg, TripPlanner
from trips.services.logs import DAY, build_daily_logs, compliance_report

GEOMETRY = [(-87.63, 41.88), (-86.16, 39.77), (-104.99, 39.74)]


def leg(miles, mph=55.0, a="A", b="B"):
    return Leg(a, b, miles, miles / mph * 60, GEOMETRY)


def plan(to_pickup, to_dropoff, cycle_used=0.0, start=8 * 60, mph=55.0):
    return TripPlanner([leg(to_pickup, mph), leg(to_dropoff, mph)], cycle_used, start).plan()


def kinds(trip_plan):
    return [s.kind for s in trip_plan.segments]


class PlannerTests(SimpleTestCase):
    def test_short_trip_has_inspection_pickup_dropoff(self):
        p = plan(55, 110)
        self.assertEqual(kinds(p), ["pre_trip", "drive", "pickup", "drive", "dropoff", "post_trip"])
        pickup = next(s for s in p.segments if s.kind == "pickup")
        dropoff = next(s for s in p.segments if s.kind == "dropoff")
        self.assertEqual((pickup.status, pickup.duration), (ON_DUTY, 60))
        self.assertEqual((dropoff.status, dropoff.duration), (ON_DUTY, 60))
        self.assertAlmostEqual(sum(s.miles for s in p.segments), 165)

    def test_every_boundary_is_on_the_quarter_hour_grid(self):
        p = plan(173.3, 1488.8, start=7 * 60 + 5)
        for s in p.segments:
            self.assertEqual(s.start % 15, 0)
            self.assertEqual(s.end % 15, 0)

    def test_30_minute_break_after_8_hours_of_driving(self):
        p = plan(0, 9 * 55)  # 9 hours of driving after pickup
        drives = [s for s in p.segments if s.status == DRIVING]
        self.assertEqual(drives[0].duration, 8 * 60)
        self.assertIn("break", kinds(p))
        brk = next(s for s in p.segments if s.kind == "break")
        self.assertEqual(brk.duration, 30)

    def test_pickup_counts_as_the_30_minute_break(self):
        p = plan(5 * 55, 5 * 55)  # 5h + 5h with a 1h pickup in between
        self.assertNotIn("break", kinds(p))

    def test_11_hour_limit_forces_10_hour_sleeper_break(self):
        p = plan(0, 15 * 55)
        rest = next(s for s in p.segments if s.kind == "rest")
        self.assertEqual((rest.status, rest.duration), (SLEEPER, 600))
        before = [s for s in p.segments if s.status == DRIVING and s.end <= rest.start]
        self.assertEqual(sum(s.duration for s in before), 11 * 60)

    def test_14_hour_window_binds_when_on_duty_time_is_long(self):
        # A 4-hour loading stop: the window closes before 11h of driving.
        p = TripPlanner([leg(2 * 55), leg(10 * 55)], 0, 6 * 60, HosRules(pickup=240)).plan()
        rest = next(s for s in p.segments if s.kind == "rest")
        shift_start = p.segments[0].start
        self.assertLessEqual(rest.start - shift_start, 14 * 60)
        self.assertIn("14-hour", rest.note)

    def test_fuel_at_least_every_1000_miles(self):
        p = plan(100, 2400, mph=60)
        odometer_at_fuel = [s.odometer_start for s in p.segments if s.kind == "fuel"]
        self.assertGreaterEqual(len(odometer_at_fuel), 2)
        marks = [0.0, *odometer_at_fuel, 2500.0]
        for a, b in zip(marks, marks[1:]):
            self.assertLessEqual(b - a, 1000.0 + 1e-6)

    def test_cycle_limit_triggers_34_hour_restart(self):
        p = plan(55, 6 * 55, cycle_used=66)
        restart = next(s for s in p.segments if s.kind == "restart")
        self.assertEqual(restart.duration, 34 * 60)
        work_before = sum(s.duration for s in p.segments if s.status in (DRIVING, ON_DUTY) and s.end <= restart.start)
        self.assertLessEqual(66 * 60 + work_before, 70 * 60)

    def test_full_cycle_starts_with_restart(self):
        p = plan(55, 55, cycle_used=70)
        self.assertEqual(p.segments[0].kind, "restart")

    def test_late_departure_stays_on_the_same_day(self):
        p = plan(50, 50, start=23 * 60 + 50)
        self.assertEqual(p.start_minute, 23 * 60 + 45)

    def test_speed_is_capped(self):
        p = plan(0, 700, mph=75)
        self.assertEqual(p.leg_speeds[1], 60.0)

    def test_compliance_report_passes_for_long_trips(self):
        for args in [(180, 1100, 10), (50, 2000, 62), (900, 2100, 35), (0, 30, 69.5)]:
            report = compliance_report(plan(*args))
            self.assertTrue(all(c["ok"] for c in report), (args, report))


class DailyLogTests(SimpleTestCase):
    def setUp(self):
        self.plan = plan(180, 1100, cycle_used=10, start=6 * 60)
        self.logs = build_daily_logs(self.plan, date(2026, 10, 2), lambda c: "Somewhere, KS")

    def test_each_day_totals_24_hours(self):
        for log in self.logs:
            self.assertEqual(sum(log["totals"].values()), DAY)

    def test_dates_are_consecutive(self):
        self.assertEqual([log["date"] for log in self.logs][:2], ["2026-10-02", "2026-10-03"])

    def test_miles_add_up(self):
        self.assertAlmostEqual(sum(log["miles"] for log in self.logs), 1280, delta=0.5)

    def test_entries_cover_the_day_without_gaps(self):
        for log in self.logs:
            cursor = 0
            for entry in log["entries"]:
                self.assertEqual(entry["start"], cursor)
                cursor = entry["end"]
            self.assertEqual(cursor, DAY)

    def test_remarks_record_every_change_of_duty_status(self):
        first = self.logs[0]
        changes = [e for e in first["entries"] if not e["continued"] and e["start"] > 0]
        self.assertEqual(len(first["remarks"]), len(changes))
        self.assertTrue(all(r["location"] for r in first["remarks"]))

    def test_recap_counts_prior_cycle_hours(self):
        recap = self.logs[0]["recap"]
        self.assertEqual(recap["last_7_days"], 10 * 60 + recap["on_duty_today"])
        self.assertEqual(recap["available_tomorrow"], 70 * 60 - recap["last_7_days"])

    def test_recap_resets_after_restart(self):
        p = plan(55, 6 * 55, cycle_used=66)
        logs = build_daily_logs(p, date(2026, 10, 2), lambda c: "X")
        restart_logs = [log for log in logs if log["recap"]["restart_completed"]]
        self.assertTrue(restart_logs)
        after = restart_logs[0]["recap"]
        self.assertLess(after["last_7_days"], 70 * 60 - 60 * 60)
