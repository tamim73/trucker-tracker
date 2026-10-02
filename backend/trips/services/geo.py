"""Key-free geo services: Photon (OpenStreetMap) for places, OSRM for routes."""

from __future__ import annotations

import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor

import requests
from django.conf import settings
from django.core.cache import cache

from .hos import Leg, haversine_miles

log = logging.getLogger(__name__)

METERS_PER_MILE = 1609.344
# Used only when the routing service is unreachable.
ROAD_FACTOR = 1.22
FALLBACK_SPEED_MPH = 55.0

STATE_ABBR = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
    "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
    "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA",
    "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}

CITY_TYPES = {"city", "town", "village", "hamlet", "locality", "district"}


class GeoError(Exception):
    """Raised when a place or route cannot be resolved."""


def _get(url: str, params) -> dict:
    response = requests.get(
        url,
        params=params,
        headers={"User-Agent": settings.GEO_USER_AGENT, "Accept-Language": "en"},
        timeout=settings.GEO_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def _cache_key(prefix: str, *parts) -> str:
    raw = "|".join(str(p) for p in parts)
    return f"{prefix}:{hashlib.sha1(raw.encode()).hexdigest()}"


# -- places -----------------------------------------------------------------


def _state(props: dict) -> str:
    state = props.get("state") or ""
    return STATE_ABBR.get(state, state)


def _place_from_feature(feature: dict) -> dict:
    props = feature["properties"]
    lon, lat = feature["geometry"]["coordinates"]
    name = props.get("name") or props.get("street") or props.get("city") or ""
    if props.get("housenumber") and props.get("street") and not props.get("name"):
        name = f"{props['housenumber']} {props['street']}"
    city = props.get("city") or ""
    state = _state(props)
    is_city = props.get("type") in CITY_TYPES and props.get("osm_key") == "place"

    parts = [name]
    if city and city != name and not is_city:
        parts.append(city)
    if state:
        parts.append(state)
    label = ", ".join(p for p in parts if p)

    detail_parts = [p for p in (props.get("street") if name != props.get("street") else None,
                                city if not is_city else props.get("county"), props.get("postcode")) if p]
    return {
        "id": f"{props.get('osm_type', '')}{props.get('osm_id', '')}",
        "label": label,
        "name": name,
        "detail": ", ".join(detail_parts),
        "kind": "city" if is_city else (props.get("osm_value") or props.get("type") or "place"),
        "lat": round(lat, 6),
        "lon": round(lon, 6),
    }


def search_places(query: str, limit: int = 6) -> list[dict]:
    query = query.strip()
    if len(query) < 2:
        return []
    key = _cache_key("search", query.lower(), limit)
    cached = cache.get(key)
    if cached is not None:
        return cached
    data = _get(f"{settings.PHOTON_URL}/api/", {"q": query, "limit": limit * 3, "lang": "en"})
    results, seen = [], set()
    for feature in data.get("features", []):
        if feature.get("properties", {}).get("countrycode") != "US":
            continue
        place = _place_from_feature(feature)
        if place["label"] in seen:
            continue
        seen.add(place["label"])
        results.append(place)
        if len(results) == limit:
            break
    cache.set(key, results)
    return results


def geocode(query: str) -> dict:
    try:
        results = search_places(query, limit=1)
    except requests.RequestException as exc:
        raise GeoError("The place search service is not responding. Try again in a moment.") from exc
    if not results:
        raise GeoError(f"No US location matches “{query}”. Try a city and state, like “Joliet, IL”.")
    return results[0]


def reverse_label(lon: float, lat: float) -> str:
    """Returns a "City, ST" label for remarks on the log sheet."""
    key = _cache_key("reverse", round(lon, 3), round(lat, 3))
    cached = cache.get(key)
    if cached is not None:
        return cached
    label = f"{lat:.3f}, {lon:.3f}"
    try:
        # Prefer the nearest named town, which is what a driver writes in remarks.
        towns = _get(
            f"{settings.PHOTON_URL}/reverse",
            [("lon", lon), ("lat", lat), ("lang", "en"), ("radius", 40), ("limit", 1),
             ("osm_tag", "place:city"), ("osm_tag", "place:town"), ("osm_tag", "place:village")],
        ).get("features") or []
        data = {"features": towns} if towns else _get(
            f"{settings.PHOTON_URL}/reverse", {"lon": lon, "lat": lat, "lang": "en", "radius": 25}
        )
        features = data.get("features") or []
        if features:
            props = features[0]["properties"]
            is_place = props.get("osm_key") == "place"
            place = (props.get("name") if is_place else None) or props.get("city")
            if not place and props.get("county"):
                county = props["county"]
                place = county if county.lower().endswith(("county", "parish")) else f"{county} County"
            if place:
                label = ", ".join(p for p in (place, _state(props)) if p)
    except requests.RequestException:
        log.warning("Reverse geocoding failed for %s,%s", lat, lon)
        return label  # do not cache failures
    cache.set(key, label)
    return label


def label_many(coords: list[tuple[float, float]]) -> dict[tuple[float, float], str]:
    unique = list(dict.fromkeys((round(lon, 4), round(lat, 4)) for lon, lat in coords))
    with ThreadPoolExecutor(max_workers=6) as pool:
        labels = list(pool.map(lambda c: reverse_label(*c), unique))
    return dict(zip(unique, labels))


# -- routing ----------------------------------------------------------------


def simplify(points: list[tuple[float, float]], tolerance: float = 0.0004) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker in degrees; keeps the drawn route light."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    tol2 = tolerance * tolerance
    while stack:
        first, last = stack.pop()
        (x1, y1), (x2, y2) = points[first], points[last]
        dx, dy = x2 - x1, y2 - y1
        norm = dx * dx + dy * dy
        worst, index = 0.0, None
        for i in range(first + 1, last):
            px, py = points[i]
            if norm == 0:
                d2 = (px - x1) ** 2 + (py - y1) ** 2
            else:
                t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / norm))
                d2 = (px - x1 - t * dx) ** 2 + (py - y1 - t * dy) ** 2
            if d2 > worst:
                worst, index = d2, i
        if index is not None and worst > tol2:
            keep[index] = True
            stack.extend(((first, index), (index, last)))
    return [p for p, k in zip(points, keep) if k]


def route_leg(origin: dict, destination: dict) -> tuple[Leg, bool]:
    """Returns the leg and whether it is an estimate (router unavailable)."""
    a = (origin["lon"], origin["lat"])
    b = (destination["lon"], destination["lat"])
    if haversine_miles(a, b) < 0.2:
        return Leg(origin["label"], destination["label"], 0.0, 0.0, [a, b]), False

    key = _cache_key("route", *a, *b)
    cached = cache.get(key)
    if cached is not None:
        return Leg(**cached), False
    try:
        data = _get(
            f"{settings.OSRM_URL}/route/v1/driving/{a[0]},{a[1]};{b[0]},{b[1]}",
            {"overview": "full", "geometries": "geojson", "steps": "false"},
        )
        if data.get("code") != "Ok" or not data.get("routes"):
            raise GeoError(
                f"No drivable route between {origin['label']} and {destination['label']}."
            )
        route = data["routes"][0]
        geometry = simplify([tuple(p) for p in route["geometry"]["coordinates"]])
        leg = Leg(
            origin["label"],
            destination["label"],
            route["distance"] / METERS_PER_MILE,
            route["duration"] / 60,
            [(round(x, 5), round(y, 5)) for x, y in geometry],
        )
        cache.set(key, leg.__dict__)
        return leg, False
    except requests.RequestException:
        log.warning("Routing service unavailable, estimating %s -> %s", origin["label"], destination["label"])
        miles = haversine_miles(a, b) * ROAD_FACTOR
        return Leg(origin["label"], destination["label"], miles, miles / FALLBACK_SPEED_MPH * 60, [a, b]), True


def route_trip(current: dict, pickup: dict, dropoff: dict) -> tuple[list[Leg], bool]:
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda pair: route_leg(*pair), [(current, pickup), (pickup, dropoff)]))
    legs = [leg for leg, _ in results]
    return legs, any(estimated for _, estimated in results)
