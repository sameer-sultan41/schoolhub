"""`SectionViewSet` — request handling for `/sections` (module doc §5.5).

``queryset`` is set to the *manager*, not ``manager.all()``. The tenant-scoped
manager resolves the active tenant when its queryset is built, and DRF builds it
per request; ``Model.objects.all()`` evaluated at class-definition time would be
frozen empty because no tenant context exists at import.

Capacity checks (``section_seats_remaining``, ``assert_section_capacity``,
``assert_capacity_not_below_occupancy``) live in the module root's
``apps.school_organization.services``, not here — ``assert_section_capacity``
is imported directly by ``apps/student_management/services.py``, so the whole
capacity family stays where that cross-app import already points.
"""

from __future__ import annotations

from django.db.models import F

from apps.school_organization.models import Section
from apps.school_organization.sections.filters import SectionFilterSet
from apps.school_organization.sections.serializers import SectionSerializer
from apps.school_organization.views import BlockingDestroyMixin
from core.api.pagination import PageNumberPagination
from core.api.viewsets import TenantModelViewSet


class SectionViewSet(BlockingDestroyMixin, TenantModelViewSet):
    """Divisions of a class at a campus, with capacity (module doc §5.5)."""

    queryset = Section.objects
    serializer_class = SectionSerializer
    filterset_class = SectionFilterSet
    search_fields = ["name"]
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    ordering = ["school_class_id", "name"]
    # `class_name`/`campus_name` are the annotations from `get_queryset`, not
    # `school_class__name`/`campus__name` — see DepartmentViewSet for why a `__`
    # traversal here is a 500 for scoped principals.
    # Only `created_at` is index-backed. sections_unique_name_per_class_campus
    # leads with (tenant, class, campus), so it does nothing for a sort on
    # `name` alone, and nothing indexes `capacity` (nullable — "unlimited" sorts
    # last ascending). So `name`, `capacity`, `class_name` and `campus_name` are
    # all a table scan plus a sort, with a join first for the annotated two.
    ordering_fields = ["name", "capacity", "class_name", "campus_name", "created_at"]
    ordering_annotations = ("class_name", "campus_name")
    required_feature = "module.school"
    required_permission = "school.section.view"
    required_permission_map = {
        "create": "school.section.create",
        "update": "school.section.update",
        "partial_update": "school.section.update",
        "destroy": "school.section.delete",
    }

    def get_queryset(self):
        # select_related keeps the list off a class/campus fetch per row; the
        # annotations are what `?ordering=class_name|campus_name` sort on.
        return (
            super()
            .get_queryset()
            .select_related("school_class", "campus")
            .annotate(class_name=F("school_class__name"), campus_name=F("campus__name"))
        )
