from unittest import mock

from django.test import TestCase

from trips.tests.test_api import fake_geocode, fake_route


def entries_of(log):
    return [{k: e[k] for k in ("status", "kind", "start", "end", "location", "note", "miles")} for e in log["entries"]]


class LogEditApiTests(TestCase):
    def setUp(self):
        for target, fake in [
            ("trips.services.trip.label_many", lambda coords: {}),
            ("trips.services.trip.route_trip", fake_route),
            ("trips.services.trip.geocode", fake_geocode),
        ]:
            patcher = mock.patch(target, fake)
            patcher.start()
            self.addCleanup(patcher.stop)
        body = {
            "current": {"label": "Chicago, IL"},
            "pickup": {"label": "Indianapolis, IN"},
            "dropoff": {"label": "Denver, CO"},
            "cycle_used_hours": 20,
            "departure": "2026-10-02T07:30",
        }
        self.trip = self.client.post("/api/trips", body, content_type="application/json").json()
        self.url = f"/api/trips/{self.trip['id']}/logs/0"

    def shifted(self, minutes=60):
        """Day 1 with departure moved later: off duty longer, pre-trip shifted, driving shorter."""
        entries = entries_of(self.trip["logs"][0])
        entries[0]["end"] += minutes
        entries[1]["start"] += minutes
        entries[1]["end"] += minutes
        entries[2]["start"] += minutes
        return entries

    def put(self, entries, **extra):
        body = {"entries": entries, "miles": 500, "reason": "Corrected departure time", **extra}
        return self.client.put(self.url, body, content_type="application/json")

    def test_edit_recomputes_totals_and_keeps_reason(self):
        response = self.put(self.shifted())
        self.assertEqual(response.status_code, 200, response.content)
        log = response.json()["logs"][0]
        self.assertEqual(sum(log["totals"].values()), 1440)
        self.assertEqual(log["totals"]["off_duty"], self.trip["logs"][0]["totals"]["off_duty"] + 60)
        self.assertEqual(log["edit"]["reason"], "Corrected departure time")
        self.assertEqual(log["miles"], 500)
        self.assertTrue(response.json()["edited"])

    def test_extra_driving_is_flagged_as_violation(self):
        entries = entries_of(self.trip["logs"][0])
        # Turn the whole evening into driving: more than 11 hours in the shift.
        last = entries[-1]
        entries[-1] = {**last, "status": "driving", "kind": "drive"}
        data = self.put(entries).json()
        log = data["logs"][0]
        self.assertTrue(log["violations"])
        self.assertIn("driving", {v["key"] for v in log["violations"]})
        driving_check = next(c for c in data["compliance"] if c["key"] == "driving")
        self.assertFalse(driving_check["ok"])

    def test_preview_does_not_save(self):
        entries = entries_of(self.trip["logs"][0])
        entries[-1] = {**entries[-1], "status": "on_duty", "kind": ""}
        preview = self.client.post(f"{self.url}/preview", {"entries": entries, "miles": 1}, content_type="application/json")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json()["logs"][0]["entries"][-1]["kind"], "on_duty")
        saved = self.client.get(f"/api/trips/{self.trip['id']}").json()
        self.assertNotIn("edit", saved["logs"][0])

    def test_gaps_and_off_grid_times_are_rejected(self):
        entries = entries_of(self.trip["logs"][0])
        entries[0]["end"] -= 15
        self.assertEqual(self.put(entries).status_code, 400)
        entries = entries_of(self.trip["logs"][0])
        entries[0]["end"] += 5
        entries[1]["start"] += 5
        self.assertEqual(self.put(entries).status_code, 400)

    def test_reason_is_required(self):
        response = self.put(entries_of(self.trip["logs"][0]), reason="")
        self.assertEqual(response.status_code, 400)
        self.assertIn("reason", response.json())

    def test_revert_restores_planned_log(self):
        self.assertEqual(self.put(self.shifted()).status_code, 200)
        reverted = self.client.delete(self.url).json()
        self.assertEqual(reverted["logs"][0]["totals"], self.trip["logs"][0]["totals"])
        self.assertNotIn("edit", reverted["logs"][0])
        self.assertFalse(reverted["edited"])

    def test_header_fields_are_saved(self):
        response = self.put(
            entries_of(self.trip["logs"][0]),
            from_place="Joliet Terminal, IL",
            to_place="Victor, IA",
            total_mileage=640,
        )
        log = response.json()["logs"][0]
        self.assertEqual((log["from"], log["to"], log["total_mileage"], log["miles"]), ("Joliet Terminal, IL", "Victor, IA", 640, 500))

    def test_driver_details_are_saved_with_the_edit(self):
        response = self.put(entries_of(self.trip["logs"][0]), driver={"name": "Rosa Delgado", "carrier": "Prairie Line"})
        self.assertEqual(response.json()["inputs"]["driver"]["carrier"], "Prairie Line")
