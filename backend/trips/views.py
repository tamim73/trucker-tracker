import copy
import logging
import secrets

import requests
from django.conf import settings
from django.db import transaction
from django.http import FileResponse, HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response

from .models import Trip
from .serializers import (
    CoordinateSerializer,
    LogEditSerializer,
    LogPreviewSerializer,
    PlaceSearchSerializer,
    TripRequestSerializer,
)
from .services.geo import GeoError, reverse_label, search_places
from .services.log_edits import EditError, apply_edit, revert_day
from .services.trip import PlaceErrors, plan_trip
from .throttles import LogEditThrottle, LogPreviewThrottle, PlacesThrottle, TripCreateThrottle

log = logging.getLogger(__name__)

GEO_DOWN = "The map service is not responding. Try again in a moment."
EDIT_TOKEN_HEADER = "X-Edit-Token"
# Kept server-side to restore a day; clients never need it.
PRIVATE_RESULT_KEYS = {"planned_logs"}


def trip_payload(trip: Trip, *, include_token: bool = False) -> dict:
    payload = {
        "id": trip.id,
        "created_at": trip.created_at.isoformat(),
        "inputs": trip.inputs,
        **{k: v for k, v in trip.result.items() if k not in PRIVATE_RESULT_KEYS},
    }
    if include_token:
        payload["edit_token"] = trip.edit_token
    return payload


def _can_edit(request, trip: Trip) -> bool:
    token = request.headers.get(EDIT_TOKEN_HEADER, "")
    return bool(token) and secrets.compare_digest(token, trip.edit_token)


def _forbidden() -> Response:
    return Response(
        {"detail": "Only the device that planned this trip can edit its logs."},
        status=status.HTTP_403_FORBIDDEN,
    )


def _invalid_body() -> Response:
    return Response({"detail": "Send a JSON object."}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@throttle_classes([PlacesThrottle])
def place_search(request):
    serializer = PlaceSearchSerializer(data=request.query_params)
    serializer.is_valid(raise_exception=True)
    try:
        return Response({"results": search_places(serializer.validated_data["q"])})
    except requests.RequestException:
        log.warning("Place search failed", exc_info=True)
        return Response({"detail": GEO_DOWN}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


@api_view(["GET"])
@throttle_classes([PlacesThrottle])
def place_reverse(request):
    serializer = CoordinateSerializer(data=request.query_params)
    serializer.is_valid(raise_exception=True)
    lat, lon = serializer.validated_data["lat"], serializer.validated_data["lon"]
    return Response({"label": reverse_label(lon, lat), "lat": lat, "lon": lon})


@api_view(["POST"])
@throttle_classes([TripCreateThrottle])
def trip_create(request):
    if not isinstance(request.data, dict):
        return _invalid_body()
    serializer = TripRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        result = plan_trip(data)
    except PlaceErrors as exc:
        return Response(
            {"detail": "Some locations could not be found.", "fields": exc.errors},
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    except GeoError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
    except requests.RequestException:
        log.exception("Geo service failure while planning")
        return Response({"detail": GEO_DOWN}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    # Store only validated, normalized input, never the raw request body.
    inputs = {
        **{role: result["places"][role] for role in ("current", "pickup", "dropoff")},
        "cycle_used_hours": data["cycle_used_hours"],
        "departure": data["departure"].strftime("%Y-%m-%dT%H:%M"),
        "driver": dict(data.get("driver", {})),
    }
    trip = Trip.objects.create(inputs=inputs, result=result)
    return Response(trip_payload(trip, include_token=True), status=status.HTTP_201_CREATED)


@api_view(["GET"])
def trip_detail(request, trip_id):
    trip = get_object_or_404(Trip, pk=trip_id)
    return Response(trip_payload(trip))


def _edited_copy(trip: Trip, day: int, data: dict, reason: str) -> tuple[dict, dict]:
    result = copy.deepcopy(trip.result)
    inputs = copy.deepcopy(trip.inputs)
    apply_edit(
        result,
        day,
        data["entries"],
        data["miles"],
        reason,
        from_place=data.get("from_place"),
        to_place=data.get("to_place"),
        total_mileage=data.get("total_mileage"),
    )
    if "driver" in data:
        inputs["driver"] = dict(data["driver"])
    return result, inputs


@api_view(["PUT", "DELETE"])
@throttle_classes([LogEditThrottle])
def trip_log(request, trip_id, day):
    """PUT saves the driver's edit of one daily log. DELETE restores the planned log."""
    if request.method == "PUT":
        if not isinstance(request.data, dict):
            return _invalid_body()
        serializer = LogEditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

    # Read, change and save under one write lock so concurrent edits to the
    # same trip cannot overwrite each other.
    with transaction.atomic():
        trip = get_object_or_404(Trip.objects.select_for_update(), pk=trip_id)
        if not _can_edit(request, trip):
            return _forbidden()
        try:
            if request.method == "DELETE":
                result = copy.deepcopy(trip.result)
                revert_day(result, day)
                trip.result = result
            else:
                data = serializer.validated_data
                trip.result, trip.inputs = _edited_copy(trip, day, data, data["reason"])
        except EditError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        trip.save(update_fields=["result", "inputs"])
    return Response(trip_payload(trip))


@api_view(["POST"])
@throttle_classes([LogPreviewThrottle])
def trip_log_preview(request, trip_id, day):
    """Recomputes totals, recap and violations for an unsaved edit."""
    if not isinstance(request.data, dict):
        return _invalid_body()
    trip = get_object_or_404(Trip, pk=trip_id)
    if not _can_edit(request, trip):
        return _forbidden()
    serializer = LogPreviewSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        result, inputs = _edited_copy(trip, day, serializer.validated_data, "Preview")
    except EditError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    preview = Trip(id=trip.id, created_at=trip.created_at, inputs=inputs, result=result)
    return Response(trip_payload(preview))


@api_view(["GET"])
def health(request):
    """Liveness and database check for the hosting platform."""
    Trip.objects.exists()
    return Response({"status": "ok"})


@api_view(["GET", "POST", "PUT", "PATCH", "DELETE"])
def api_not_found(request, path=""):
    return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)


def spa_index(request):
    """Serves the built React app shell; the client router handles the path.
    The file is sent as-is (never rendered as a template)."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.is_file():
        return HttpResponse(
            "Frontend build not found. Run `npm run build` in frontend/ or use the Vite dev server.",
            content_type="text/plain",
            status=404,
        )
    response = FileResponse(index.open("rb"), content_type="text/html; charset=utf-8")
    # The shell points at hashed asset names, so it must be revalidated on every deploy.
    response["Cache-Control"] = "no-cache"
    return response
