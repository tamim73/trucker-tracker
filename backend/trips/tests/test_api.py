from unittest import mock

from django.test import TestCase

from trips.services.hos import Leg

PLACES = {
    "Chicago, IL": {"label": "Chicago, IL", "lat": 41.88, "lon": -87.63},
    "Indianapolis, IN": {"label": "Indianapolis, IN", "lat": 39.77, "lon": -86.16},
    "Denver, CO": {"label": "Denver, CO", "lat": 39.74, "lon": -104.99},
}


def fake_route(current, pickup, dropoff):
    return [
        Leg(current["label"], pickup["label"], 181.0, 200.0,
            [(current["lon"], current["lat"]), (pickup["lon"], pickup["lat"])]),
        Leg(pickup["label"], dropoff["label"], 1074.0, 1000.0,
            [(pickup["lon"], pickup["lat"]), (dropoff["lon"], dropoff["lat"])]),
    ], False


def fake_geocode(query):
    from trips.services.geo import GeoError

    if query not in PLACES:
        raise GeoError(f"No US location matches “{query}”.")
    return PLACES[query]


@mock.patch("trips.services.trip.label_many", lambda coords: {})
@mock.patch("trips.services.trip.route_trip", fake_route)
@mock.patch("trips.services.trip.geocode", fake_geocode)
class TripApiTests(TestCase):
    body = {
        "current": {"label": "Chicago, IL"},
        "pickup": {"label": "Indianapolis, IN", "lat": 39.77, "lon": -86.16},
        "dropoff": {"label": "Denver, CO"},
        "cycle_used_hours": 20,
        "departure": "2026-10-02T07:30",
        "driver": {"name": "Marisol Okafor", "carrier": "Prairie Line Freight"},
    }

    def test_create_and_fetch_trip(self):
        response = self.client.post("/api/trips", self.body, content_type="application/json")
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual(data["summary"]["total_miles"], 1255.0)
        self.assertGreaterEqual(len(data["logs"]), 2)
        self.assertTrue(all(c["ok"] for c in data["compliance"]))
        self.assertEqual(data["inputs"]["driver"]["carrier"], "Prairie Line Freight")

        fetched = self.client.get(f"/api/trips/{data['id']}")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["summary"], data["summary"])

    def test_unknown_place_reports_field_error(self):
        body = {**self.body, "dropoff": {"label": "Atlantis"}}
        response = self.client.post("/api/trips", body, content_type="application/json")
        self.assertEqual(response.status_code, 422)
        self.assertIn("dropoff", response.json()["fields"])

    def test_cycle_hours_are_validated(self):
        body = {**self.body, "cycle_used_hours": 71}
        response = self.client.post("/api/trips", body, content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("cycle_used_hours", response.json())

    def test_missing_trip_is_404(self):
        self.assertEqual(self.client.get("/api/trips/nope").status_code, 404)
