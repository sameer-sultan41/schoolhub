"""Routes for `/platform/tenants/{tenant_pk}/subscription` (§16), mounted under `platform/`.

Colon-actions before the resource, as every module's hand-wired routes are.
"""

from django.urls import path

from apps.platform_admin.subscriptions.viewset import TenantSubscriptionViewSet

_ACTIONS = (
    ("activate", "activate"),
    ("record-payment", "record_payment"),
    ("mark-payment-failed", "mark_payment_failed"),
    ("change-plan", "change_plan"),
)

urlpatterns = [
    *(
        path(
            f"tenants/<uuid:tenant_pk>/subscription:{verb}",
            TenantSubscriptionViewSet.as_view({"post": action}),
            name=f"platform-tenant-subscription-{verb}",
        )
        for verb, action in _ACTIONS
    ),
    path(
        "tenants/<uuid:tenant_pk>/subscription",
        TenantSubscriptionViewSet.as_view({"get": "retrieve", "patch": "partial_update"}),
        name="platform-tenant-subscription",
    ),
]
