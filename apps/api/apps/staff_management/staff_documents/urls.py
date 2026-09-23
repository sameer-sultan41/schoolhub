"""Routes for the StaffDocument resource — nested under a staff member and
top-level, including the `:verify` colon-action (module doc §16).
"""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.staff_management.staff_documents.viewset import (
    StaffDocumentLinkViewSet,
    StaffDocumentViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("staff-documents", StaffDocumentViewSet, basename="staff-documents")

urlpatterns = [
    path(
        "staff/<uuid:staff_pk>/documents",
        StaffDocumentLinkViewSet.as_view({"get": "list", "post": "create"}),
        name="staff-documents-list",
    ),
    path(
        "staff-documents/<uuid:pk>:verify",
        StaffDocumentViewSet.as_view({"post": "verify"}),
        name="staff-documents-verify",
    ),
    *router.urls,
]
