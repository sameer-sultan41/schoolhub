"""Routes of the platform console, mounted at ``/api/v1/platform/`` by config/api_v1.py.

Platform users only (`core.api.platform.PlatformViewSet`), except the billing provider's
webhook, which its signature authenticates instead (`billing/view.py`). The module's
tenant-facing routes (a school's own subscription and onboarding) live in `tenant_urls.py`.
"""

from django.urls import include, path

urlpatterns = [
    path("", include("apps.platform_admin.billing.urls")),
    path("", include("apps.platform_admin.export.urls")),
    path("", include("apps.platform_admin.flags.urls")),
    path("", include("apps.platform_admin.impersonation.urls")),
    path("", include("apps.platform_admin.plans.urls")),
    path("", include("apps.platform_admin.reports.urls")),
    path("", include("apps.platform_admin.subscriptions.urls")),
    path("", include("apps.platform_admin.tenants.urls")),
    path("", include("apps.platform_admin.usage.urls")),
]
