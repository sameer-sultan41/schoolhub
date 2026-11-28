"""Routes for a school's usage (§16), mounted under `platform/`."""

from django.urls import path

from apps.platform_admin.usage.viewset import TenantUsageViewSet

urlpatterns = [
    path(
        "tenants/<uuid:tenant_pk>:refresh-usage",
        TenantUsageViewSet.as_view({"post": "refresh_usage"}),
        name="platform-tenant-refresh-usage",
    ),
    path(
        "tenants/<uuid:tenant_pk>/usage",
        TenantUsageViewSet.as_view({"get": "retrieve"}),
        name="platform-tenant-usage",
    ),
]
