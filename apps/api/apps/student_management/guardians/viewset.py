"""`GuardianViewSet` — request handling for `/guardians`."""

from __future__ import annotations

from rest_framework import mixins, viewsets

from apps.student_management.guardians.serializers import GuardianSerializer
from apps.student_management.models import Guardian
from core.api.viewsets import TenantScopedViewSetMixin


class GuardianViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Guardian persons (module doc §16). No destroy — a guardian with no

    remaining student links simply stops appearing in any student's roster;
    hard removal is a retention operation, not documented as an API action.
    """

    queryset = Guardian.objects
    serializer_class = GuardianSerializer
    search_fields = ["first_name", "last_name", "phone", "email"]
    ordering_fields = ["last_name", "created_at"]
    required_feature = "module.students"
    required_permission = "students.guardian.view"
    required_permission_map = {
        "create": "students.guardian.create",
        "update": "students.guardian.update",
        "partial_update": "students.guardian.update",
    }
    # A guardian has no campus of its own; scope through the students they are
    # linked to. distinct() because that traversal is one-to-many.
    scope_campus_field = "student_links__student__campus_id"

    def get_queryset(self):
        return super().get_queryset().distinct()
