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

from apps.attendance.models import AttendanceCorrection, StudentAttendance


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
