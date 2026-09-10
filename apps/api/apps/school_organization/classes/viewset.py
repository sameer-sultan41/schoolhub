"""`ClassViewSet` — request handling for `/classes` (module doc §5.5).

``queryset`` is set to the *manager*, not ``manager.all()``. The tenant-scoped
manager resolves the active tenant when its queryset is built, and DRF builds it
per request; ``Model.objects.all()`` evaluated at class-definition time would be
frozen empty because no tenant context exists at import.
"""

from __future__ import annotations

from apps.school_organization.classes.filters import ClassFilterSet
from apps.school_organization.classes.serializers import ClassSerializer
from apps.school_organization.models import Class
from apps.school_organization.views import BlockingDestroyMixin
from core.api.pagination import PageNumberPagination
from core.api.viewsets import TenantModelViewSet


class ClassViewSet(BlockingDestroyMixin, TenantModelViewSet):
    """Grade levels; ``level`` is the promotion ladder (module doc §5.5)."""

    # Tenant-wide: "Grade 6" is defined once and every campus uses it. A campus
    # admin must see it to create a section in it.
    scope_campus_field = None
    queryset = Class.objects
    serializer_class = ClassSerializer
    filterset_class = ClassFilterSet
    search_fields = ["name", "code"]
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    ordering = ["level"]
    # `level` and `name` each ride a partial unique on (tenant, <col>), and
    # `created_at` has its own index. `code` is nullable and
    # classes_unique_code_per_tenant excludes NULL rows, so an unfiltered
    # `?ordering=code` cannot use it — that one is a table scan plus a sort.
    ordering_fields = ["level", "name", "code", "created_at"]
    required_feature = "module.school"
    required_permission = "school.class.view"
    required_permission_map = {
        "create": "school.class.create",
        "update": "school.class.update",
        "partial_update": "school.class.update",
        "destroy": "school.class.delete",
    }
