"""Routes for the staff-management module (module doc §16).

``trailing_slash=False`` matches the API contract elsewhere. Colon-actions
(`:invite`, `:exit`, `:verify`) and nested routes (`staff/<staff_pk>/...`) are
declared before ``*router.urls`` — same convention as student_management/urls.py.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.staff_management.views import (
    DesignationViewSet,
    StaffDocumentLinkViewSet,
    StaffDocumentViewSet,
    StaffExportViewSet,
    StaffImportViewSet,
    StaffQualificationLinkViewSet,
    StaffQualificationViewSet,
    StaffViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("staff", StaffViewSet, basename="staff")
router.register("designations", DesignationViewSet, basename="designations")
router.register("staff-qualifications", StaffQualificationViewSet, basename="staff-qualifications")
router.register("staff-documents", StaffDocumentViewSet, basename="staff-documents")

urlpatterns = [
    path(
        "staff/<uuid:staff_pk>/qualifications",
        StaffQualificationLinkViewSet.as_view({"get": "list", "post": "create"}),
        name="staff-qualifications-list",
    ),
    path(
        "staff/<uuid:staff_pk>/documents",
        StaffDocumentLinkViewSet.as_view({"get": "list", "post": "create"}),
        name="staff-documents-list",
    ),
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
        "staff-qualifications/<uuid:pk>:verify",
        StaffQualificationViewSet.as_view({"post": "verify"}),
        name="staff-qualifications-verify",
    ),
    path(
        "staff-documents/<uuid:pk>:verify",
        StaffDocumentViewSet.as_view({"post": "verify"}),
        name="staff-documents-verify",
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
