"""`CampusFilterSet` — `/campuses` query filters (module doc §16).

Every filterable field is listed explicitly rather than generated from the
model: an implicit ``fields = "__all__"`` turns any column added later into a
public query surface — including ones that leak information or index badly.
"""

from __future__ import annotations

import django_filters

from apps.school_organization.models import Campus


class CampusFilterSet(django_filters.FilterSet):
    class Meta:
        model = Campus
        fields = ["is_active", "is_primary"]
