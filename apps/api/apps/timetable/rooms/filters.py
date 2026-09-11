"""Filter set for `/rooms` — timetable.md §16 names no filters for this list.

Campus and type are what the grid's room picker actually narrows on, and both
are already indexed together (`rooms_campus_type_idx`), so they are exposed
rather than leaving the client to fetch every room and filter in the browser.

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

from apps.timetable.models import Room


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
