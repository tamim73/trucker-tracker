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


@mock.patch("trips.services.trip.label_many", lambda coords: {})
@mock.patch("trips.services.trip.route_trip", fake_route)
@mock.patch("trips.services.trip.geocode", fake_geocode)
class TripInputTests(TestCase):
    body = TripApiTests.body

    def setUp(self):
        from django.core.cache import cache

        cache.clear()

    def post(self, body):
        return self.client.post("/api/trips", body, content_type="application/json")

    def test_only_validated_input_is_stored(self):
        body = {**self.body, "junk": "x" * 1000, "driver": {"name": "Ana", "evil": {"nested": 1}}}
        data = self.post(body).json()
        self.assertEqual(set(data["inputs"]), {"current", "pickup", "dropoff", "cycle_used_hours", "departure", "driver"})
        self.assertNotIn("evil", data["inputs"]["driver"])
        self.assertIn("edit_token", data)

    def test_non_object_body_is_rejected(self):
        self.assertEqual(self.client.post("/api/trips", [1], content_type="application/json").status_code, 400)

    def test_oversized_body_is_rejected(self):
        body = {**self.body, "junk": "x" * 70_000}
        self.assertEqual(self.post(body).status_code, 400)

    def test_places_outside_the_us_are_rejected(self):
        body = {**self.body, "dropoff": {"label": "Sydney", "lat": -33.87, "lon": 151.21}}
        response = self.post(body)
        self.assertEqual(response.status_code, 400)
        self.assertIn("dropoff", response.json())

    def test_half_a_coordinate_is_rejected(self):
        body = {**self.body, "pickup": {"label": "Somewhere", "lat": 40.0}}
        self.assertEqual(self.post(body).status_code, 400)

    def test_geocoder_outage_is_reported_as_unavailable(self):
        import requests

        def down(query):
            raise requests.ConnectionError("down")

        with mock.patch("trips.services.trip.geocode", down), self.assertLogs("trips.views", level="ERROR"):
            response = self.post(self.body)
        self.assertEqual(response.status_code, 503)


class GeoServiceTests(TestCase):
    def setUp(self):
        from django.core.cache import cache

        cache.clear()

    def test_no_route_is_an_error_not_an_estimate(self):
        from trips.services.geo import GeoError, route_leg

        a = {"label": "Honolulu, HI", "lat": 21.31, "lon": -157.86}
        b = {"label": "Chicago, IL", "lat": 41.88, "lon": -87.63}
        with mock.patch("trips.services.geo._get", return_value={"code": "NoRoute", "routes": []}):
            with self.assertRaises(GeoError):
                route_leg(a, b)

    def test_router_outage_falls_back_to_an_estimate(self):
        import requests

        from trips.services.geo import route_leg

        a = PLACES["Chicago, IL"]
        b = PLACES["Indianapolis, IN"]
        with mock.patch("trips.services.geo._get", side_effect=requests.Timeout()):
            leg, estimated = route_leg(a, b)
        self.assertTrue(estimated)
        self.assertGreater(leg.distance_miles, 100)

    def test_osrm_400_body_is_read(self):
        from trips.services.geo import _get

        response = mock.Mock(status_code=400, json=lambda: {"code": "NoRoute"})
        with mock.patch("trips.services.geo.requests.get", return_value=response):
            self.assertEqual(_get("https://osrm.test", {}, json_errors=True), {"code": "NoRoute"})

    def test_labeling_keeps_coordinates_when_out_of_time(self):
        import time

        from trips.services.geo import label_many

        def slow(lon, lat):
            time.sleep(0.5)
            return "Late, ST"

        with mock.patch("trips.services.geo.reverse_label", slow), self.settings(GEO_LABEL_BUDGET_SECONDS=0.05):
            labels = label_many([(-87.6, 41.9)])
        self.assertEqual(labels[(-87.6, 41.9)], "41.900, -87.600")


class EndpointTests(TestCase):
    def setUp(self):
        from django.core.cache import cache

        cache.clear()

    def test_reverse_rejects_non_finite_coordinates(self):
        for query in ("lat=nan&lon=1", "lat=1&lon=inf", "lat=200&lon=1", "lat=x&lon=1", ""):
            self.assertEqual(self.client.get(f"/api/places/reverse?{query}").status_code, 400, query)

    def test_search_query_is_capped(self):
        self.assertEqual(self.client.get("/api/places/search?q=" + "a" * 201).status_code, 400)

    def test_short_search_skips_the_service(self):
        with mock.patch("trips.services.geo._get") as get:
            response = self.client.get("/api/places/search?q=a")
        self.assertEqual(response.json(), {"results": []})
        get.assert_not_called()

    def test_unknown_api_path_is_json_404(self):
        response = self.client.get("/api/nope")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response["Content-Type"], "application/json")

    def test_health(self):
        self.assertEqual(self.client.get("/api/health").json(), {"status": "ok"})

    def test_security_headers(self):
        response = self.client.get("/api/health")
        self.assertIn("default-src 'self'", response["Content-Security-Policy"])
        self.assertEqual(response["X-Frame-Options"], "DENY")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
