"""Console routes for impersonation (§16), mounted under `platform/`."""

from django.urls import path

from apps.platform_admin.impersonation.viewset import (
    ImpersonationGrantViewSet,
    TenantImpersonationViewSet,
    TenantUserViewSet,
)

urlpatterns = [
    path(
        "tenants/<uuid:tenant_pk>:impersonate",
        TenantImpersonationViewSet.as_view({"post": "impersonate"}),
        name="platform-tenants-impersonate",
    ),
    path(
        "tenants/<uuid:tenant_pk>/users",
        TenantUserViewSet.as_view({"get": "list"}),
        name="platform-tenant-users",
    ),
    path(
        "impersonation-grants/<uuid:pk>",
        ImpersonationGrantViewSet.as_view({"delete": "destroy"}),
        name="platform-impersonation-grants-detail",
    ),
]
