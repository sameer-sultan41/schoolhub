"""`AcademicSessionFilterSet` — `/academic-sessions` query filters (module doc §16)."""

from __future__ import annotations

import django_filters

from apps.school_organization.models import AcademicSession


class AcademicSessionFilterSet(django_filters.FilterSet):
    class Meta:
        model = AcademicSession
        fields = ["status", "is_current"]
