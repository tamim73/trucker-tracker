import copy
import logging

import requests
from django.conf import settings
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.template.loader import render_to_string
from django.template import TemplateDoesNotExist
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Trip
from .serializers import LogEditSerializer, TripRequestSerializer
from .services.log_edits import EditError, apply_edit, revert_day
from .services.geo import GeoError, reverse_label, search_places
from .services.trip import PlaceErrors, plan_trip

log = logging.getLogger(__name__)

GEO_DOWN = "The map service is not responding. Try again in a moment."


def trip_payload(trip: Trip) -> dict:
    return {"id": trip.id, "created_at": trip.created_at.isoformat(), "inputs": trip.inputs, **trip.result}


@api_view(["GET"])
def place_search(request):
    query = request.query_params.get("q", "")
    try:
        return Response({"results": search_places(query)})
    except requests.RequestException:
        return Response({"detail": GEO_DOWN}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


@api_view(["GET"])
def place_reverse(request):
    try:
        lat = float(request.query_params["lat"])
        lon = float(request.query_params["lon"])
    except (KeyError, ValueError):
        return Response({"detail": "Pass numeric lat and lon."}, status=status.HTTP_400_BAD_REQUEST)
    label = reverse_label(lon, lat)
    return Response({"label": label, "lat": lat, "lon": lon})


@api_view(["POST"])
def trip_create(request):
    serializer = TripRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        result = plan_trip(data)
    except PlaceErrors as exc:
        return Response({"detail": "Some locations could not be found.", "fields": exc.errors},
                        status=status.HTTP_422_UNPROCESSABLE_ENTITY)
    except GeoError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
    except requests.RequestException:
        log.exception("Geo service failure while planning")
        return Response({"detail": GEO_DOWN}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    inputs = {**request.data, "departure": data["departure"].strftime("%Y-%m-%dT%H:%M")}
    inputs.update({role: result["places"][role] for role in ("current", "pickup", "dropoff")})
    trip = Trip.objects.create(inputs=inputs, result=result)
    return Response(trip_payload(trip), status=status.HTTP_201_CREATED)


@api_view(["GET"])
def trip_detail(request, trip_id):
    trip = get_object_or_404(Trip, pk=trip_id)
    return Response(trip_payload(trip))


def _edited_copy(trip: Trip, day: int, data) -> tuple[dict, dict]:
    result = copy.deepcopy(trip.result)
    inputs = copy.deepcopy(trip.inputs)
    apply_edit(
        result,
        day,
        data["entries"],
        data["miles"],
        data["reason"],
        from_place=data.get("from_place"),
        to_place=data.get("to_place"),
        total_mileage=data.get("total_mileage"),
    )
    if "driver" in data:
        inputs["driver"] = dict(data["driver"])
    return result, inputs


@api_view(["PUT", "DELETE"])
def trip_log(request, trip_id, day):
    """PUT saves the driver's edit of one daily log. DELETE restores the planned log."""
    trip = get_object_or_404(Trip, pk=trip_id)
    try:
        if request.method == "DELETE":
            result = copy.deepcopy(trip.result)
            revert_day(result, day)
            trip.result = result
        else:
            serializer = LogEditSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            trip.result, trip.inputs = _edited_copy(trip, day, serializer.validated_data)
    except EditError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    trip.save(update_fields=["result", "inputs"])
    return Response(trip_payload(trip))


@api_view(["POST"])
def trip_log_preview(request, trip_id, day):
    """Recomputes totals, recap and violations for an unsaved edit."""
    trip = get_object_or_404(Trip, pk=trip_id)
    serializer = LogEditSerializer(data={**request.data, "reason": "preview"})
    serializer.is_valid(raise_exception=True)
    try:
        result, inputs = _edited_copy(trip, day, serializer.validated_data)
    except EditError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    preview = Trip(id=trip.id, created_at=trip.created_at, inputs=inputs, result=result)
    return Response(trip_payload(preview))


def spa_index(request):
    try:
        return HttpResponse(render_to_string("index.html"))
    except TemplateDoesNotExist:
        return HttpResponse(
            "Frontend build not found. Run `npm run build` in frontend/ or use the Vite dev server.",
            content_type="text/plain",
            status=404 if not settings.DEBUG else 200,
        )
