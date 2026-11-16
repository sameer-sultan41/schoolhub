"""Routes for `/platform/tenants` (platform-admin.md §16), mounted under `platform/`.

Explicit `path()`s, colon-actions before the detail route, as every module's hand-wired
routes are. `:delete` maps to the `deprovision` action: a viewset method named `delete`
would also answer the HTTP DELETE verb.
"""

from django.urls import path

from apps.platform_admin.tenants.viewset import TenantDetailViewSet, TenantViewSet

_ACTIONS = (
    ("provision", "provision"),
    ("suspend", "suspend"),
    ("reinstate", "reinstate"),
    ("delete", "deprovision"),
    ("restore", "restore"),
)

urlpatterns = [
    path(
        "tenants",
        TenantViewSet.as_view({"get": "list", "post": "create"}),
        name="platform-tenants-list",
    ),
    *(
        path(
            f"tenants/<uuid:tenant_pk>:{verb}",
            TenantDetailViewSet.as_view({"post": action}),
            name=f"platform-tenants-{verb}",
        )
        for verb, action in _ACTIONS
    ),
    path(
        "tenants/<uuid:tenant_pk>",
        TenantDetailViewSet.as_view({"get": "retrieve", "patch": "partial_update"}),
        name="platform-tenants-detail",
    ),
]
