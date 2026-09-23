"""Routes for the StudentTransfer resource, including the
`:approve`/`:reject`/`:complete` colon-actions (module doc §16).

``trailing_slash=False`` matches the API contract elsewhere — see
school_organization/urls.py. Colon-actions are declared before
``*router.urls`` so a colon-action is not swallowed by the router's detail
pattern — same convention as the root ``apps.student_management.urls`` this
package's routes are cut from.
"""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.student_management.transfers.viewset import StudentTransferViewSet

router = SimpleRouter(trailing_slash=False)
router.register("student-transfers", StudentTransferViewSet, basename="student-transfers")

urlpatterns = [
    path(
        "student-transfers/<uuid:pk>:approve",
        StudentTransferViewSet.as_view({"post": "approve"}),
        name="student-transfers-approve",
    ),
    path(
        "student-transfers/<uuid:pk>:reject",
        StudentTransferViewSet.as_view({"post": "reject"}),
        name="student-transfers-reject",
    ),
    path(
        "student-transfers/<uuid:pk>:complete",
        StudentTransferViewSet.as_view({"post": "complete"}),
        name="student-transfers-complete",
    ),
    *router.urls,
]
