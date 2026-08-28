"""Root URL configuration.

All application routes live under the version prefix ``/api/v1/`` per
docs/02-architecture/api-architecture.md §2.1. Health and schema endpoints sit
outside it because they are infrastructure, not product API.
"""

from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from core.api.views import health, readiness

urlpatterns = [
    path("healthz", health, name="health"),
    path("readyz", readiness, name="readiness"),
    path("admin/", admin.site.urls),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    path("api/v1/", include(("config.api_v1", "api_v1"), namespace="v1")),
]
