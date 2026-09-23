"""Routes for the StudentGuardian resource — nested under a student and
top-level (module doc §16). ``trailing_slash=False`` matches the API contract
elsewhere — see school_organization/urls.py.
"""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.student_management.student_guardians.viewset import (
    StudentGuardianLinkViewSet,
    StudentGuardianViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("student-guardians", StudentGuardianViewSet, basename="student-guardians")

urlpatterns = [
    path(
        "students/<uuid:student_pk>/guardians",
        StudentGuardianLinkViewSet.as_view({"get": "list", "post": "create"}),
        name="students-guardians",
    ),
    *router.urls,
]
