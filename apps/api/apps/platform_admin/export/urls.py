"""Routes for a school's export and its job poll (§16), mounted under `platform/`."""

from django.urls import path

from apps.platform_admin.export.viewset import TenantExportViewSet

urlpatterns = [
    path(
        "tenants/<uuid:tenant_pk>:export",
        TenantExportViewSet.as_view({"post": "export"}),
        name="platform-tenants-export",
    ),
    path(
        "tenants/<uuid:tenant_pk>/jobs/<uuid:job_id>:download",
        TenantExportViewSet.as_view({"post": "download"}),
        name="platform-tenant-job-download",
    ),
    path(
        "tenants/<uuid:tenant_pk>/jobs/<uuid:job_id>",
        TenantExportViewSet.as_view({"get": "retrieve"}),
        name="platform-tenant-job",
    ),
]
