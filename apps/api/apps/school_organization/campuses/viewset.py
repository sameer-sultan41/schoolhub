"""`CampusViewSet` — request handling for `/campuses` (module doc §5.2).

``queryset`` is set to the *manager*, not ``manager.all()``. The tenant-scoped
manager resolves the active tenant when its queryset is built, and DRF builds it
per request; ``Model.objects.all()`` evaluated at class-definition time would be
frozen empty because no tenant context exists at import.
"""

from __future__ import annotations

from django.db import transaction

from apps.school_organization.campuses.filters import CampusFilterSet
from apps.school_organization.campuses.serializers import CampusSerializer
from apps.school_organization.campuses.services import clear_primary_campus
from apps.school_organization.models import Campus
from apps.school_organization.views import BlockingDestroyMixin
from core.api.pagination import PageNumberPagination
from core.api.viewsets import TenantModelViewSet


class CampusViewSet(BlockingDestroyMixin, TenantModelViewSet):
    """Campuses/branches of the school (module doc §5.2)."""

    # A campus-scoped principal sees the campuses they are scoped to — the row
    # *is* the campus, so the dimension is its own primary key. `campus_id`
    # (the default) is not a column here and raised FieldError.
    scope_campus_field = "id"
    queryset = Campus.objects
    serializer_class = CampusSerializer
    filterset_class = CampusFilterSet
    search_fields = ["name", "code"]
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    ordering = ["name"]
    # Everything the dashboard's campus table renders. Index-backed: `code`
    # (campuses_unique_code_per_tenant) and `created_at` (its own index).
    # Table scans: `name`, `is_active` and `is_primary` — no index covers any of
    # them, so each is a sequential scan of the tenant's campuses plus a sort.
    # `campuses_one_primary_per_tenant` does not help `is_primary`: it indexes
    # only the single `is_primary=true` row, not the ordering of the rest.
    # Allowed because this list is bounded by one school's branch count; on a
    # big table these would each want an index first.
    ordering_fields = ["name", "code", "is_active", "is_primary", "created_at"]
    required_feature = "module.school"
    required_permission = "school.campus.view"
    required_permission_map = {
        "create": "school.campus.create",
        "update": "school.campus.update",
        "partial_update": "school.campus.update",
        "destroy": "school.campus.delete",
    }

    @transaction.atomic
    def perform_create(self, serializer) -> None:
        if serializer.validated_data.get("is_primary"):
            clear_primary_campus(keep_id=None, actor_id=self.request.user.pk)
        super().perform_create(serializer)

    @transaction.atomic
    def perform_update(self, serializer) -> None:
        if serializer.validated_data.get("is_primary"):
            clear_primary_campus(keep_id=serializer.instance.pk, actor_id=self.request.user.pk)
        super().perform_update(serializer)
