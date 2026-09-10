"""`HouseViewSet` — request handling for `/houses` (module doc §5.7).

``queryset`` is set to the *manager*, not ``manager.all()``. The tenant-scoped
manager resolves the active tenant when its queryset is built, and DRF builds it
per request; ``Model.objects.all()`` evaluated at class-definition time would be
frozen empty because no tenant context exists at import.
"""

from __future__ import annotations

from apps.school_organization.houses.filters import HouseFilterSet
from apps.school_organization.houses.serializers import HouseSerializer
from apps.school_organization.models import House
from apps.school_organization.views import BlockingDestroyMixin
from core.api.pagination import PageNumberPagination
from core.api.viewsets import TenantModelViewSet


class HouseViewSet(BlockingDestroyMixin, TenantModelViewSet):
    """Houses/groups used for sports, discipline and points (module doc §5.7)."""

    # Tenant-wide: houses span campuses by design.
    scope_campus_field = None
    queryset = House.objects
    serializer_class = HouseSerializer
    filterset_class = HouseFilterSet
    search_fields = ["name", "code"]
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    ordering = ["name"]
    # `name` rides houses_unique_name_per_tenant and `created_at` its own index.
    # `code` is nullable and houses_unique_code_per_tenant excludes NULL, so
    # sorting by it is a table scan plus a sort.
    ordering_fields = ["name", "code", "created_at"]
    required_feature = "module.school"
    required_permission = "school.house.view"
    required_permission_map = {
        "create": "school.house.create",
        "update": "school.house.update",
        "partial_update": "school.house.update",
        "destroy": "school.house.delete",
    }
