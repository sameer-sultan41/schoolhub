"""`DesignationViewSet` — request handling for `/designations`."""

from __future__ import annotations

from rest_framework import viewsets

from apps.staff_management.designations.serializers import DesignationSerializer
from apps.staff_management.designations.services import assert_designation_deactivatable
from apps.staff_management.models import Designation
from apps.staff_management.views import _StaffModuleViewSetMixin
from core.api.pagination import PageNumberPagination


class DesignationViewSet(_StaffModuleViewSetMixin, viewsets.ModelViewSet):
    """Tenant-defined designation catalog (module doc §5.4)."""

    # Tenant-wide: a designation ("Head of Department") is defined once for the
    # school, not per campus. See `scope_queryset` on why this passes through.
    scope_campus_field = None
    queryset = Designation.objects
    serializer_class = DesignationSerializer
    search_fields = ["name", "code"]
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    # This endpoint declared no allowlist at all, which is not the same as "not
    # sortable": `OrderingFilter` is a project-wide default and falls back to
    # every serializer field when a view names none, so `?ordering=level` has
    # been live — on an unindexed nullable column, documented nowhere. These are
    # the columns the dashboard's designation table renders, and nothing else.
    # Index-backed: `name` (designations_unique_name_per_tenant, whose
    # `deleted_at IS NULL` condition is what this list already filters on) and
    # `created_at` (its own index).
    # Table scans: `code`, because designations_unique_code_per_tenant is partial
    # (`WHERE code IS NOT NULL`) and so cannot order a list that also contains the
    # rows it excludes; and `level`, which nothing indexes and which is nullable,
    # so designations with no seniority sort last ascending and first descending.
    ordering_fields = ["name", "code", "level", "created_at"]
    required_feature = "module.staff"
    required_permission = "staff.designation.view"
    required_permission_map = {
        "create": "staff.designation.create",
        "update": "staff.designation.update",
        "partial_update": "staff.designation.update",
        "destroy": "staff.designation.delete",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def perform_destroy(self, instance) -> None:
        assert_designation_deactivatable(designation=instance)
        super().perform_destroy(instance)
