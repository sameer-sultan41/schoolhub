"""`SubjectViewSet` — request handling for `/subjects` (module doc §5.6).

``queryset`` is set to the *manager*, not ``manager.all()``. The tenant-scoped
manager resolves the active tenant when its queryset is built, and DRF builds it
per request; ``Model.objects.all()`` evaluated at class-definition time would be
frozen empty because no tenant context exists at import.
"""

from __future__ import annotations

from django.db.models import F

from apps.school_organization.models import Subject
from apps.school_organization.subjects.filters import SubjectFilterSet
from apps.school_organization.subjects.serializers import SubjectSerializer
from apps.school_organization.views import BlockingDestroyMixin
from core.api.pagination import PageNumberPagination
from core.api.viewsets import TenantModelViewSet


class SubjectViewSet(BlockingDestroyMixin, TenantModelViewSet):
    """The tenant's subject catalog (module doc §5.6)."""

    # Tenant-wide, like classes.
    scope_campus_field = None
    queryset = Subject.objects
    serializer_class = SubjectSerializer
    filterset_class = SubjectFilterSet
    search_fields = ["name", "code"]
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    ordering = ["name"]
    # `department_name` is the annotation from `get_queryset`, not
    # `department__name` — see DepartmentViewSet.
    # Index-backed: `name` and `code` (each a partial unique on (tenant, <col>))
    # and `created_at`. Table scan: `department_name`, a sort over a left join;
    # `department_id` is nullable, so unassigned subjects sort last ascending.
    ordering_fields = ["name", "code", "department_name", "created_at"]
    ordering_annotations = ("department_name",)
    required_feature = "module.school"
    required_permission = "school.subject.view"
    required_permission_map = {
        "create": "school.subject.create",
        "update": "school.subject.update",
        "partial_update": "school.subject.update",
        "destroy": "school.subject.delete",
    }

    def get_queryset(self):
        # select_related keeps the list off one department fetch per row; the
        # annotation is what `?ordering=department_name` sorts on.
        return (
            super()
            .get_queryset()
            .select_related("department")
            .annotate(department_name=F("department__name"))
        )
