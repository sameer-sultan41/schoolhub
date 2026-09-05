"""Whitelisted filters — timetable.md §16 names the fields each list accepts.

Whitelisted, not `fields = "__all__"`: a filter backend that accepts any column
turns a list endpoint into an ad-hoc query API over the whole row, including the
columns a record scope was meant to keep out of reach.

**Every foreign key is an explicit `UUIDFilter`, never a `Meta.fields` entry.**
Declaring `fields = {"campus_id": ["exact"]}` against an FK makes django-filter
generate a `ModelChoiceFilter`, which *validates* the id against the related
model before filtering. That is wrong here twice over:

- a filter narrows a list, it does not assert the value exists, so an id the
  caller cannot see should match nothing rather than answer 400 "Select a valid
  choice";
- the choice queryset is built without a bound tenant, so under RLS it resolves
  no rows at all and **even the caller's own ids fail validation**. That stayed
  invisible while CI connected as a superuser — a superuser bypasses RLS even
  with FORCE — and surfaced the moment CI started using the non-owning,
  NOBYPASSRLS role. `/rooms?campus_id=<your own campus>` was answering 400.

`student_management`, `school_organization` and `academics` all use explicit
`UUIDFilter`s for this reason.
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

    campus_id = django_filters.UUIDFilter(field_name="campus_id")

    class Meta:
        model = Room
        fields = {
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

    campus_id = django_filters.UUIDFilter(field_name="campus_id")

    class Meta:
        model = Period
        fields = {
            "is_break": ["exact"],
        }


class TimetableSlotFilterSet(django_filters.FilterSet):
    # §16 spells these `teacher_id` and `weekday`; the columns are `staff_id`
    # and `day_of_week`, named for the tables they join to rather than for the
    # role the row happens to play.
    teacher_id = django_filters.UUIDFilter(field_name="staff_id")
    weekday = django_filters.NumberFilter(field_name="day_of_week")
    section_id = django_filters.UUIDFilter(field_name="section_id")
    room_id = django_filters.UUIDFilter(field_name="room_id")
    academic_session_id = django_filters.UUIDFilter(field_name="academic_session_id")

    class Meta:
        model = TimetableSlot
        fields = {
            "status": ["exact"],
        }


class TeacherSubstitutionFilterSet(django_filters.FilterSet):
    substitute_staff_id = django_filters.UUIDFilter(field_name="substitute_staff_id")
    absent_staff_id = django_filters.UUIDFilter(field_name="absent_staff_id")

    class Meta:
        model = TeacherSubstitution
        fields = {
            # `gte`/`lte` as well as `exact`: §13's substitution report is a date
            # range, and the vice principal's morning list is a single day.
            "date": ["exact", "gte", "lte"],
            "status": ["exact"],
        }
