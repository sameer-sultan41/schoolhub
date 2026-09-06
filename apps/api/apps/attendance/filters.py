"""Whitelisted filters — attendance.md §16 names the fields each list accepts.

Whitelisted, not ``fields = "__all__"``: a filter backend that accepts any column
turns a list endpoint into an ad-hoc query API over the whole row, including the
columns a record scope was meant to keep out of reach. On this table that matters
more than most — it is a per-child, per-day record of where a named minor was.

**Every foreign key is an explicit ``UUIDFilter``, never a ``Meta.fields``
entry**, for the reason timetable/filters.py sets out at length: declaring an FK
in ``Meta.fields`` makes django-filter generate a ``ModelChoiceFilter``, whose
choice queryset is built without a bound tenant, so under RLS it resolves no rows
and *even the caller's own ids fail validation* with a 400.
"""

from __future__ import annotations

import django_filters

from apps.attendance.models import (
    AttendanceCorrection,
    LeaveRequest,
    LeaveType,
    StaffAttendance,
    StudentAttendance,
)


class StudentAttendanceFilterSet(django_filters.FilterSet):
    section_id = django_filters.UUIDFilter(field_name="section_id")
    student_id = django_filters.UUIDFilter(field_name="student_id")
    academic_session_id = django_filters.UUIDFilter(field_name="academic_session_id")
    period_id = django_filters.UUIDFilter(field_name="period_id")
    # §16 names `date`; the column is `attendance_date`. The wire name follows
    # the doc, the field follows the schema.
    date = django_filters.DateFilter(field_name="attendance_date")
    date__gte = django_filters.DateFilter(field_name="attendance_date", lookup_expr="gte")
    date__lte = django_filters.DateFilter(field_name="attendance_date", lookup_expr="lte")

    class Meta:
        model = StudentAttendance
        fields = {"status": ["exact"], "is_locked": ["exact"]}


class AttendanceCorrectionFilterSet(django_filters.FilterSet):
    """§16 names no filters for `/attendance-corrections`.

    Status is what an approver's queue narrows on and is already indexed
    (`att_corr_status_idx`), so it is exposed rather than leaving the client to
    fetch every correction ever raised and filter in the browser.
    """

    student_attendance_id = django_filters.UUIDFilter(field_name="student_attendance_id")

    class Meta:
        model = AttendanceCorrection
        fields = {"status": ["exact"], "subject_type": ["exact"]}


class LeaveRequestFilterSet(django_filters.FilterSet):
    """§16 names no filters for `/leave-requests`.

    Status is what an approver's morning queue narrows on and is already indexed
    (`leave_req_status_idx`); student and date range are what a guardian's own
    history needs. Both are exposed rather than leaving a client to fetch every
    request the tenant has ever raised and filter in the browser.
    """

    student_id = django_filters.UUIDFilter(field_name="student_id")
    leave_type_id = django_filters.UUIDFilter(field_name="leave_type_id")
    date__gte = django_filters.DateFilter(field_name="start_date", lookup_expr="gte")
    date__lte = django_filters.DateFilter(field_name="end_date", lookup_expr="lte")

    class Meta:
        model = LeaveRequest
        fields = {"status": ["exact"], "requester_type": ["exact"]}


class LeaveTypeFilterSet(django_filters.FilterSet):
    class Meta:
        model = LeaveType
        fields = {"applies_to": ["exact"], "is_active": ["exact"]}


class StaffAttendanceFilterSet(django_filters.FilterSet):
    """§16 names no filters for `/staff-attendance`.

    Staff, status and a date range are what §13's punctuality report and an HR
    clerk's day view narrow on, and both are indexed
    (`staff_att_staff_date_idx`, `staff_att_date_status_idx`).
    """

    staff_id = django_filters.UUIDFilter(field_name="staff_id")
    date = django_filters.DateFilter(field_name="attendance_date")
    date__gte = django_filters.DateFilter(field_name="attendance_date", lookup_expr="gte")
    date__lte = django_filters.DateFilter(field_name="attendance_date", lookup_expr="lte")

    class Meta:
        model = StaffAttendance
        fields = {"status": ["exact"], "source": ["exact"]}
