"""HTTP layer for `periods` — the bell schedule (§5.1).

Thin by design: every rule that needs more than the request body lives in
``services``. See core.api.viewsets.TenantScopedViewSetMixin for what
`queryset = Model.objects` (the manager, never `.all()`) buys, and for why
`required_feature` is checked before `required_permission`.

**§4 declares no `timetable.period.view` key.** It has
`timetable.period.create/update/delete`, but nothing to read the bell schedule
with. Reading it is reading the timetable's scaffolding, so the list takes
`timetable.timetable.view` instead — academics' curriculum viewset is in
exactly the same position and resolves it the same way. Inventing
`timetable.period.view` would put a key in the registry that no module doc
declares and no seeded role holds.

`FEATURE`, `STAFF_PERMISSIONS` and `SCAFFOLDING_VIEW_KEY` are imported from
the module root's `views.py`, shared by every viewset in every one of the
four resource packages — see that file's own docstring.
"""

from __future__ import annotations

from django.db.models import F
from rest_framework import viewsets

from apps.timetable.models import Period
from apps.timetable.periods import services
from apps.timetable.periods.filters import PeriodFilterSet
from apps.timetable.periods.serializers import PeriodSerializer
from apps.timetable.views import FEATURE, SCAFFOLDING_VIEW_KEY, STAFF_PERMISSIONS
from core.api.pagination import PageNumberPagination
from core.api.viewsets import TenantScopedViewSetMixin


class PeriodViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`periods` — the bell schedule (§5.1)."""

    permission_classes = STAFF_PERMISSIONS
    queryset = Period.objects
    serializer_class = PeriodSerializer
    filterset_class = PeriodFilterSet
    search_fields = ["name"]
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    # Every column the bell-schedule table renders except `weekdays`, which is an
    # array — there is no ordering of it a reader would recognise as the one the
    # header promises.
    #
    # Only `created_at` has an index an ORDER BY can walk: `periods_tenant_campus_idx`
    # is led by (tenant, campus), so nothing else here is a usable prefix, and
    # `sequence`, `name`, `start_time`, `end_time` and `is_break` all sort the tenant's
    # periods in memory. A bell schedule is a few dozen rows, so that is the cheap
    # half of the trade. `campus_name` is joined *and* nullable — a null campus means
    # "every campus" (models.py), so those rows land last ascending, first descending.
    ordering_fields = [
        "sequence",
        "name",
        "start_time",
        "end_time",
        "is_break",
        "campus_name",
        "created_at",
    ]
    ordering_annotations = ("campus_name",)
    # Period.Meta.ordering; see RoomViewSet for why the view repeats the model's.
    ordering = ["sequence"]
    scope_campus_field = "campus_id"
    # A null campus on a period means "every campus" (models.py), so a campus-scoped
    # reader must keep the tenant-wide periods, or the day template loses lunch.
    scope_campus_allows_null = True
    required_feature = FEATURE
    required_permission = SCAFFOLDING_VIEW_KEY
    required_permission_map = {
        "create": "timetable.period.create",
        "update": "timetable.period.update",
        "partial_update": "timetable.period.update",
        "destroy": "timetable.period.delete",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def perform_destroy(self, instance):
        """Refuse removing a period the timetable still uses (`assert_period_not_in_use`)."""
        services.assert_period_not_in_use(instance)
        super().perform_destroy(instance)

    def get_queryset(self):
        return self._with_campus_name(super().get_queryset())

    @staticmethod
    def _with_campus_name(queryset):
        """Make the campus sortable without putting a `__` in `ordering_fields`.

        `ordering_fields` never traverses a relation (tests/test_endpoint_contracts.py:
        Postgres rejects `SELECT DISTINCT` with an `ORDER BY` on a joined column that
        is not in the select list), so the campus name is an annotation, which is.

        ``select_related`` is not redundant with the annotation: without it the
        serializer's campus fields would re-fetch the row per period.
        """
        return queryset.select_related("campus").annotate(campus_name=F("campus__name"))
