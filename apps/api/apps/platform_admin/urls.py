"""Routes of the platform console, mounted at ``/api/v1/platform/`` by config/api_v1.py.

Platform users only (`core.api.platform.PlatformViewSet`). The module's tenant-facing routes
(a school's own subscription and onboarding) live under a separate include, not here.
"""

from django.urls import include, path

urlpatterns = [
    path("", include("apps.platform_admin.tenants.urls")),
]
