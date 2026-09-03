"""Routes for the student-management module (module doc §16).

``trailing_slash=False`` matches the API contract elsewhere — see
school_organization/urls.py. Colon-actions (`:enroll`, `:change-section`,
`:withdraw`, transfer routes) arrive in a later PR and are declared before
``*router.urls``, same convention.

Nested routes (``students/<student_pk>/...``) are declared as explicit
``path()`` entries for the same reason: a ``SimpleRouter`` has no
nested-resource support, and api-architecture.md §4 caps sub-resources at one
level deep anyway.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.student_management.views import (
    EmergencyContactLinkViewSet,
    GuardianViewSet,
    StudentDocumentLinkViewSet,
    StudentDocumentViewSet,
    StudentGuardianLinkViewSet,
    StudentGuardianViewSet,
    StudentViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("students", StudentViewSet, basename="students")
router.register("guardians", GuardianViewSet, basename="guardians")
router.register("student-guardians", StudentGuardianViewSet, basename="student-guardians")
router.register("student-documents", StudentDocumentViewSet, basename="student-documents")

urlpatterns = [
    path(
        "students/<uuid:student_pk>/guardians",
        StudentGuardianLinkViewSet.as_view({"get": "list", "post": "create"}),
        name="students-guardians",
    ),
    path(
        "students/<uuid:student_pk>/emergency-contacts",
        EmergencyContactLinkViewSet.as_view({"get": "list", "post": "create"}),
        name="students-emergency-contacts",
    ),
    path(
        "students/<uuid:student_pk>/documents",
        StudentDocumentLinkViewSet.as_view({"get": "list", "post": "create"}),
        name="students-documents",
    ),
    path(
        "student-documents/<uuid:pk>:verify",
        StudentDocumentViewSet.as_view({"post": "verify"}),
        name="student-documents-verify",
    ),
    *router.urls,
]
