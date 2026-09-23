"""`TermViewSet` — request handling for `/terms` (module doc §5.4).

``queryset`` is set to the *manager*, not ``manager.all()``. The tenant-scoped
manager resolves the active tenant when its queryset is built, and DRF builds it
per request; ``Model.objects.all()`` evaluated at class-definition time would be
frozen empty because no tenant context exists at import.
"""

from __future__ import annotations

from rest_framework import mixins, viewsets

from apps.school_organization.models import Term
from apps.school_organization.terms.filters import TermFilterSet
from apps.school_organization.terms.serializers import TermSerializer
from core.api.viewsets import TenantScopedViewSetMixin


class TermViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Terms of a session. Governed by the academic-session permission keys (§4)."""

    # Tenant-wide, following its session.
    scope_campus_field = None
    queryset = Term.objects
    serializer_class = TermSerializer
    filterset_class = TermFilterSet
    search_fields = ["name"]
    ordering_fields = ["sequence", "start_date"]
    required_feature = "module.school"
    required_permission = "school.academic-session.view"
    required_permission_map = {
        "create": "school.academic-session.create",
        "update": "school.academic-session.update",
        "partial_update": "school.academic-session.update",
    }

    def get_queryset(self):
        return super().get_queryset().select_related("academic_session")
