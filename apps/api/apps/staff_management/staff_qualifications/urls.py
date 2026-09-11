"""Routes for `/staff/{staff_pk}/qualifications` and `/staff-qualifications`
(module doc §16).

``trailing_slash=False`` matches the API contract elsewhere. The nested route
and the `:verify` colon-action are declared before ``*router.urls`` — same
convention as the module root's ``urls.py``.
"""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.staff_management.staff_qualifications.viewset import (
    StaffQualificationLinkViewSet,
    StaffQualificationViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("staff-qualifications", StaffQualificationViewSet, basename="staff-qualifications")

urlpatterns = [
    path(
        "staff/<uuid:staff_pk>/qualifications",
        StaffQualificationLinkViewSet.as_view({"get": "list", "post": "create"}),
        name="staff-qualifications-list",
    ),
    path(
        "staff-qualifications/<uuid:pk>:verify",
        StaffQualificationViewSet.as_view({"post": "verify"}),
        name="staff-qualifications-verify",
    ),
    *router.urls,
]
