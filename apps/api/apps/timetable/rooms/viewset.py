"""`RoomViewSet` — request handling for `/rooms` (§5.4).

`STAFF_PERMISSIONS`, `FEATURE` and `SCAFFOLDING_VIEW_KEY` stay in the trimmed
root `views.py` — every resource package in this module shares them. See that
module's docstring for why reading the room list takes
`timetable.timetable.view` rather than a dedicated `timetable.room.view` (§4
declares no view key for periods or rooms).
"""

from __future__ import annotations

from django.db.models import F
from rest_framework import viewsets

from apps.timetable.models import Room
from apps.timetable.rooms.filters import RoomFilterSet
from apps.timetable.rooms.serializers import RoomSerializer
from apps.timetable.views import FEATURE, SCAFFOLDING_VIEW_KEY, STAFF_PERMISSIONS
from core.api.pagination import PageNumberPagination
from core.api.viewsets import TenantScopedViewSetMixin


class RoomViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`rooms` — physical rooms, labs and halls (§5.4)."""

    permission_classes = STAFF_PERMISSIONS
    queryset = Room.objects
    serializer_class = RoomSerializer
    filterset_class = RoomFilterSet
    search_fields = ["name", "code", "building"]
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    # Every column the room table renders, except the building/floor pair: the client
    # joins those two into one display string, and sorting on `building` alone would
    # order the rows by something other than what the header names.
    #
    # Only `created_at` has an index that an ORDER BY can walk. `code` and `room_type`
    # sit at the tail of composite indexes led by (tenant, campus), so neither is a
    # usable prefix here; `name` has `rooms_tenant_name_idx`, but `capacity` and
    # `is_active` have no index at all, and `campus_name` is joined. Those therefore
    # sort the tenant's rooms in memory — affordable only because this table is bounded
    # by one school's room count. `capacity` is nullable, so Postgres puts the unset
    # rooms last ascending and first descending.
    ordering_fields = [
        "code",
        "name",
        "room_type",
        "capacity",
        "is_active",
        "campus_name",
        "created_at",
    ]
    #: Entries in ordering_fields that are annotations from get_queryset, not model
    #: fields — tests/test_endpoint_contracts.py cannot resolve these against the model.
    ordering_annotations = ("campus_name",)
    # Room.Meta.ordering. Declared here too because DRF's ordering filter reads the
    # *view's* default, not the model's, and a list with no view default lets the
    # paginator page an unordered result.
    ordering = ["campus_id", "code"]
    scope_campus_field = "campus_id"
    required_feature = FEATURE
    required_permission = SCAFFOLDING_VIEW_KEY
    required_permission_map = {
        "create": "timetable.room.create",
        "update": "timetable.room.update",
        "partial_update": "timetable.room.update",
        "destroy": "timetable.room.delete",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        """`campus_name` is annotated, never traversed in `ordering_fields`.

        No scope narrows this table with a ``.distinct()`` today — ``Room`` declares no
        ``filter_owned_by_user`` — so `campus__name` would in fact work right now. It
        is still annotated, and tests/test_endpoint_contracts.py refuses a `__` in any
        `ordering_fields`: the day someone gives ``Room`` an own-scope hook (every one
        written so far ends in ``.distinct()``, because the joins they walk fan out),
        `SELECT DISTINCT` + `ORDER BY <joined column>` starts raising ProgrammingError
        for that principal only, and nothing in review would connect the two changes.
        The annotation costs one already-open join and removes the trap.
        ``select_related`` is what keeps it to that one join.
        """
        return (
            super().get_queryset().select_related("campus").annotate(campus_name=F("campus__name"))
        )
