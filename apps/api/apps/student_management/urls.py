"""Routes for the student-management module (module doc §16).

``trailing_slash=False`` matches the API contract elsewhere — see
school_organization/urls.py. Colon-actions (`:enroll`, `:change-section`,
`:withdraw`, transfer routes) are declared before ``*router.urls``, same
convention.

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
    IdCardGenerateViewSet,
    StudentDocumentLinkViewSet,
    StudentDocumentViewSet,
    StudentExportViewSet,
    StudentGuardianLinkViewSet,
    StudentGuardianViewSet,
    StudentImportViewSet,
    StudentTransferViewSet,
    StudentViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("students", StudentViewSet, basename="students")
router.register("guardians", GuardianViewSet, basename="guardians")
router.register("student-guardians", StudentGuardianViewSet, basename="student-guardians")
router.register("student-documents", StudentDocumentViewSet, basename="student-documents")
router.register("student-transfers", StudentTransferViewSet, basename="student-transfers")

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
        "students/<uuid:pk>/history",
        StudentViewSet.as_view({"get": "history"}),
        name="students-history",
    ),
    path(
        "students/<uuid:pk>:enroll",
        StudentViewSet.as_view({"post": "enroll"}),
        name="students-enroll",
    ),
    path(
        "students/<uuid:pk>:change-section",
        StudentViewSet.as_view({"post": "change_section"}),
        name="students-change-section",
    ),
    path(
        "students/<uuid:pk>:withdraw",
        StudentViewSet.as_view({"post": "withdraw"}),
        name="students-withdraw",
    ),
    path(
        "student-documents/<uuid:pk>:verify",
        StudentDocumentViewSet.as_view({"post": "verify"}),
        name="student-documents-verify",
    ),
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
    path(
        "student-imports",
        StudentImportViewSet.as_view({"post": "create"}),
        name="student-imports",
    ),
    path(
        "student-exports",
        StudentExportViewSet.as_view({"post": "create"}),
        name="student-exports",
    ),
    path(
        "id-cards:generate",
        IdCardGenerateViewSet.as_view({"post": "create"}),
        name="id-cards-generate",
    ),
    *router.urls,
]
