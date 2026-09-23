"""`TermFilterSet` — `/terms` query filters (module doc §16)."""

from __future__ import annotations

import django_filters

from apps.school_organization.models import Term


class TermFilterSet(django_filters.FilterSet):
    academic_session_id = django_filters.UUIDFilter(field_name="academic_session_id")

    class Meta:
        model = Term
        fields = ["academic_session_id"]
