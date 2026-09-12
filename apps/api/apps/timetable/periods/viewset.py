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
from apps.timetable.periods.filters import PeriodFilterSet
from apps.timetable.periods.serializers import PeriodSerializer
from apps.timetable.views import FEATURE, SCAFFOLDING_VIEW_KEY, STAFF_PERMISSIONS
from core.api.pagination import PageNumberPagination
from core.api.viewsets import TenantScopedViewSetMixin
from core.rbac.models import RecordScope
from core.rbac.permissions import user_scopes


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
    required_feature = FEATURE
    required_permission = SCAFFOLDING_VIEW_KEY
    required_permission_map = {
        "create": "timetable.period.create",
        "update": "timetable.period.update",
        "partial_update": "timetable.period.update",
        "destroy": "timetable.period.delete",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        """Campus scoping must not hide the tenant-wide periods.

        ``scope_queryset`` narrows to ``campus_id IN (...)``, which drops
        ``campus_id IS NULL`` — and a null campus on a period means "every
        campus" (models.py). Left alone, a campus-scoped admin would lose exactly
        the rows that do apply to them, and the day template would render with
        lunch missing. The scoped queryset is combined back with the tenant-wide
        rows rather than the campus filter being reimplemented here.

        ``_with_campus_name`` is applied *after* that combine rather than to each
        side of it. ``QuerySet.__or__`` keeps only the left-hand query's
        annotations, so annotating both sides would be one wasted join and one
        silent dependence on which operand is on the left.
        """
        scoped = super().get_queryset()

        scopes = user_scopes(self.request.user)
        campus_ids = [ref for ref in scopes.get(RecordScope.CAMPUS, []) if ref]
        # `not campus_ids` covers a campus scope with no `scope_ref`, which
        # `scope_queryset` treats as granting nothing; widening that back to the
        # tenant-wide rows would turn a malformed assignment into extra access.
        if RecordScope.ALL in scopes or not campus_ids:
            return self._with_campus_name(scoped)

        tenant_wide = Period.objects.alive().filter(campus__isnull=True)
        return self._with_campus_name((scoped | tenant_wide).distinct())

    @staticmethod
    def _with_campus_name(queryset):
        """Make the campus sortable without putting a `__` in `ordering_fields`.

        This queryset is ``.distinct()`` on the campus-scoped path above, and
        Postgres rejects ``SELECT DISTINCT`` with an ``ORDER BY`` on a joined column
        that is not in the select list — so `campus__name` in `ordering_fields`
        would be a 500 for exactly the principals that branch exists to serve. The
        annotation is in the select list, which is what makes the alias safe.

        ``select_related`` is not redundant with the annotation: without it the
        serializer's campus fields would re-fetch the row per period.
        """
        return queryset.select_related("campus").annotate(campus_name=F("campus__name"))
