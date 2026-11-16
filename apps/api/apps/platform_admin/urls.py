"""Routes of the platform console, mounted at ``/api/v1/platform/`` by config/api_v1.py.

Platform users only (`core.api.platform.PlatformViewSet`). The module's tenant-facing routes
(a school's own subscription and onboarding) live in `tenant_urls.py`, a separate include.
"""

from django.urls import include, path

urlpatterns = [
    path("", include("apps.platform_admin.plans.urls")),
    path("", include("apps.platform_admin.subscriptions.urls")),
    path("", include("apps.platform_admin.tenants.urls")),
]
