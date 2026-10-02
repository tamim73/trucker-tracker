from django.urls import path

from . import views

urlpatterns = [
    path("places/search", views.place_search),
    path("places/reverse", views.place_reverse),
    path("trips", views.trip_create),
    path("trips/<str:trip_id>", views.trip_detail),
    path("trips/<str:trip_id>/logs/<int:day>", views.trip_log),
    path("trips/<str:trip_id>/logs/<int:day>/preview", views.trip_log_preview),
]
