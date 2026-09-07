"""Routes for the attendance module — attendance.md §16.

Explicit ``path()`` entries come before ``*router.urls`` so a colon-action is not
swallowed by the router's detail pattern (``attendance-corrections/<pk>`` matches
``<uuid>:approve`` quite happily otherwise), matching every other module.

``student-attendance:bulk-mark`` is a colon-action on the *collection*, not on a
detail route: a register is submitted for a section and a date, not for one row.
It is declared before the router registers ``student-attendance`` so the literal
path wins over the list route.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.attendance.views import (
    AttendanceCorrectionViewSet,
    AttendanceImportViewSet,
    AttendanceReportView,
    LeaveRequestViewSet,
    LeaveTypeViewSet,
    StaffAttendanceViewSet,
    StudentAttendanceViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("student-attendance", StudentAttendanceViewSet, basename="student-attendance")
router.register(
    "attendance-corrections", AttendanceCorrectionViewSet, basename="attendance-corrections"
)
router.register("leave-types", LeaveTypeViewSet, basename="leave-types")
router.register("leave-requests", LeaveRequestViewSet, basename="leave-requests")
router.register("staff-attendance", StaffAttendanceViewSet, basename="staff-attendance")

urlpatterns = [
    path(
        "student-attendance-imports",
        AttendanceImportViewSet.as_view({"post": "create"}),
        name="student-attendance-imports",
    ),
    path(
        "reports/attendance-summary",
        AttendanceReportView.as_view(),
        name="attendance-report-summary",
    ),
    path(
        "student-attendance:bulk-mark",
        StudentAttendanceViewSet.as_view({"post": "bulk_mark"}),
        name="student-attendance-bulk-mark",
    ),
    path(
        "attendance-corrections/<uuid:pk>:approve",
        AttendanceCorrectionViewSet.as_view({"post": "approve"}),
        name="attendance-corrections-approve",
    ),
    path(
        "attendance-corrections/<uuid:pk>:reject",
        AttendanceCorrectionViewSet.as_view({"post": "reject"}),
        name="attendance-corrections-reject",
    ),
    path(
        "leave-requests/<uuid:pk>:approve",
        LeaveRequestViewSet.as_view({"post": "approve"}),
        name="leave-requests-approve",
    ),
    path(
        "leave-requests/<uuid:pk>:reject",
        LeaveRequestViewSet.as_view({"post": "reject"}),
        name="leave-requests-reject",
    ),
    path(
        "staff-attendance/<uuid:pk>:check-out",
        StaffAttendanceViewSet.as_view({"post": "check_out"}),
        name="staff-attendance-check-out",
    ),
    path(
        "leave-requests/<uuid:pk>:cancel",
        LeaveRequestViewSet.as_view({"post": "cancel"}),
        name="leave-requests-cancel",
    ),
    *router.urls,
]
