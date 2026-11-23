"""Routes of the feature-flag console (platform-admin.md §16), mounted under `platform/`."""

from django.urls import path

from apps.platform_admin.flags.viewset import FeatureFlagViewSet, TenantFeatureOverrideViewSet

urlpatterns = [
    path(
        "feature-flags",
        FeatureFlagViewSet.as_view({"get": "list"}),
        name="platform-feature-flags-list",
    ),
    path(
        "feature-flags/<uuid:pk>",
        FeatureFlagViewSet.as_view({"get": "retrieve", "patch": "partial_update"}),
        name="platform-feature-flags-detail",
    ),
    path(
        "tenants/<uuid:tenant_pk>/feature-overrides",
        TenantFeatureOverrideViewSet.as_view({"get": "list", "post": "create"}),
        name="platform-tenant-feature-overrides-list",
    ),
    path(
        "tenants/<uuid:tenant_pk>/feature-overrides/<uuid:pk>",
        TenantFeatureOverrideViewSet.as_view({"delete": "destroy"}),
        name="platform-tenant-feature-overrides-detail",
    ),
]
