"""Routes for `/platform/plans` (platform-admin.md §16), mounted under `platform/`."""

from django.urls import path

from apps.platform_admin.plans.viewset import PlanViewSet

urlpatterns = [
    path(
        "plans",
        PlanViewSet.as_view({"get": "list", "post": "create"}),
        name="platform-plans-list",
    ),
    path(
        "plans/<uuid:pk>",
        PlanViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="platform-plans-detail",
    ),
]
