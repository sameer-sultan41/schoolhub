"""Whitelisted filters for `/periods` — timetable.md §16 names none.

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
from django.db.models import Q

from apps.timetable.models import Period


class PeriodFilterSet(django_filters.FilterSet):
    """`campus_id` here means "periods declared for this campus" and deliberately
    excludes the tenant-wide ones (`campus_id IS NULL`), which do also apply to
    it. A caller drawing one campus's day wants the union, and asks for it with
    `for_campus`.
    """

    campus_id = django_filters.UUIDFilter(field_name="campus_id")
    # The union `campus_id` leaves out: the periods that actually run at one campus,
    # its own plus the tenant-wide ones. This is the row set a section's week grid is
    # drawn on.
    for_campus = django_filters.UUIDFilter(method="filter_for_campus")

    class Meta:
        model = Period
        fields = {
            "is_break": ["exact"],
        }

    def filter_for_campus(self, queryset, name, value):
        return queryset.filter(Q(campus_id=value) | Q(campus__isnull=True))
