"""Whitelisted filters — timetable.md §16 names the fields each list accepts.

Whitelisted, not `fields = "__all__"`: a filter backend that accepts any column
turns a list endpoint into an ad-hoc query API over the whole row, including the
columns a record scope was meant to keep out of reach.
"""

from __future__ import annotations

import django_filters

from apps.timetable.models import Period, Room, TeacherSubstitution, TimetableSlot


class RoomFilterSet(django_filters.FilterSet):
    """§16 names no filters for `/rooms`.

    Campus and type are what the grid's room picker actually narrows on, and
    both are already indexed together (`rooms_campus_type_idx`), so they are
    exposed rather than leaving the client to fetch every room and filter in
    the browser.
    """

    class Meta:
        model = Room
        fields = {
            "campus_id": ["exact"],
            "room_type": ["exact"],
            "is_active": ["exact"],
        }


class PeriodFilterSet(django_filters.FilterSet):
    """§16 names no filters for `/periods` either.

    `campus_id` here means "periods declared for this campus" and deliberately
    excludes the tenant-wide ones (`campus_id IS NULL`), which do also apply to
    it — a caller building one campus's day template wants the union, and gets
    it by simply not passing the filter.
    """

    class Meta:
        model = Period
        fields = {
            "campus_id": ["exact"],
            "is_break": ["exact"],
        }


class TimetableSlotFilterSet(django_filters.FilterSet):
    # §16 spells these `teacher_id` and `weekday`; the columns are `staff_id`
    # and `day_of_week`, named for the tables they join to rather than for the
    # role the row happens to play.
    teacher_id = django_filters.UUIDFilter(field_name="staff_id")
    weekday = django_filters.NumberFilter(field_name="day_of_week")

    class Meta:
        model = TimetableSlot
        fields = {
            "section_id": ["exact"],
            "room_id": ["exact"],
            "status": ["exact"],
            "academic_session_id": ["exact"],
        }


class TeacherSubstitutionFilterSet(django_filters.FilterSet):
    class Meta:
        model = TeacherSubstitution
        fields = {
            # `gte`/`lte` as well as `exact`: §13's substitution report is a date
            # range, and the vice principal's morning list is a single day.
            "date": ["exact", "gte", "lte"],
            "status": ["exact"],
            "substitute_staff_id": ["exact"],
            "absent_staff_id": ["exact"],
        }
