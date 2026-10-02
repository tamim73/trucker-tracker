from django.urls import path, re_path

from . import views

urlpatterns = [
    path("health", views.health),
    path("places/search", views.place_search),
    path("places/reverse", views.place_reverse),
    path("trips", views.trip_create),
    path("trips/<str:trip_id>", views.trip_detail),
    path("trips/<str:trip_id>/logs/<int:day>", views.trip_log),
    path("trips/<str:trip_id>/logs/<int:day>/preview", views.trip_log_preview),
    # Unknown API paths answer in JSON, like the rest of the API.
    re_path(r"^(?P<path>.*)$", views.api_not_found),
]
