"""Routes for `/staff`, `/staff-imports`, and `/staff-exports` (module doc §16).

``trailing_slash=False`` matches the API contract elsewhere. Colon-actions
(`:invite`, `:exit`) are declared before ``*router.urls`` — same convention as
the root `apps.staff_management.urls` this package's routes are cut from.
"""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.staff_management.staff.viewset import (
    StaffExportViewSet,
    StaffImportViewSet,
    StaffViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("staff", StaffViewSet, basename="staff")

urlpatterns = [
    path(
        "staff/<uuid:pk>:invite",
        StaffViewSet.as_view({"post": "invite"}),
        name="staff-invite",
    ),
    path(
        "staff/<uuid:pk>:exit",
        StaffViewSet.as_view({"post": "exit"}),
        name="staff-exit",
    ),
    path(
        "staff-imports",
        StaffImportViewSet.as_view({"post": "create"}),
        name="staff-imports",
    ),
    path(
        "staff-exports",
        StaffExportViewSet.as_view({"post": "create"}),
        name="staff-exports",
    ),
    *router.urls,
]
