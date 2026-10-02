from django.urls import include, path, re_path

from trips.views import spa_index

urlpatterns = [
    path("api/", include("trips.urls")),
    # Everything else is handled by the React router.
    re_path(r"^(?!api/|static/).*$", spa_index),
]
