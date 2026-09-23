"""`DepartmentViewSet` — request handling for `/departments` (module doc §5.3).

``queryset`` is set to the *manager*, not ``manager.all()``. The tenant-scoped
manager resolves the active tenant when its queryset is built, and DRF builds it
per request; ``Model.objects.all()`` evaluated at class-definition time would be
frozen empty because no tenant context exists at import.
"""

from __future__ import annotations

from django.db.models import F

from apps.school_organization.departments.filters import DepartmentFilterSet
from apps.school_organization.departments.serializers import DepartmentSerializer
from apps.school_organization.models import Department
from apps.school_organization.views import BlockingDestroyMixin
from core.api.pagination import PageNumberPagination
from core.api.viewsets import TenantModelViewSet


class DepartmentViewSet(BlockingDestroyMixin, TenantModelViewSet):
    """Academic and administrative departments (module doc §5.3)."""

    # `departments.campus_id` is nullable and means "spans every campus"
    # (models.py). Without this a campus-scoped principal loses exactly those
    # shared departments from the list — silently, since NULL is simply not in
    # an `IN (...)`.
    scope_campus_allows_null = True
    queryset = Department.objects
    serializer_class = DepartmentSerializer
    filterset_class = DepartmentFilterSet
    search_fields = ["name", "code"]
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    ordering = ["name"]
    # `campus_name` is the annotation added in `get_queryset`, never
    # `campus__name`: `scope_queryset` hands an OWN/ASSIGNED principal a
    # `.distinct()` queryset, and Postgres rejects `SELECT DISTINCT` ordered by
    # a joined column that is not in the select list. An annotation is in the
    # select list, so it sorts for every principal instead of 500-ing for some.
    # Index-backed: `code` (departments_unique_code_per_tenant),
    # `department_type` (departments_tenant_type_idx), `created_at`.
    # Table scans: `name`, and `campus_name`, which sorts a left join —
    # `campus_id` is nullable ("spans every campus"), so those rows sort last
    # ascending and first descending.
    ordering_fields = ["name", "code", "department_type", "campus_name", "created_at"]
    #: Entries in ordering_fields that are annotations from get_queryset, not model
    #: fields — tests/test_endpoint_contracts.py cannot resolve these against the model.
    ordering_annotations = ("campus_name",)
    required_feature = "module.school"
    required_permission = "school.department.view"
    required_permission_map = {
        "create": "school.department.create",
        "update": "school.department.update",
        "partial_update": "school.department.update",
        "destroy": "school.department.delete",
    }

    def get_queryset(self):
        # select_related keeps the list off one campus fetch per row; the
        # annotation is what `?ordering=campus_name` actually sorts on.
        return (
            super().get_queryset().select_related("campus").annotate(campus_name=F("campus__name"))
        )
