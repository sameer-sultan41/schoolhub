"""`EmergencyContactLinkViewSet` — request handling for
`/students/{student_pk}/emergency-contacts` (module doc §16).
"""

from __future__ import annotations

from rest_framework import mixins, viewsets

from apps.student_management.emergency_contacts.serializers import EmergencyContactSerializer
from apps.student_management.emergency_contacts.services import add_emergency_contact
from apps.student_management.models import EmergencyContact
from apps.student_management.views import _NestedUnderStudentMixin
from core.api.viewsets import TenantScopedViewSetMixin


class EmergencyContactLinkViewSet(
    _NestedUnderStudentMixin,
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """`GET/POST /students/{student_pk}/emergency-contacts`.

    Reuses ``students.student.view``/``.update`` — §4 declares no dedicated
    ``students.emergency-contact.*`` key even though §16 exposes this endpoint,
    matching the ``ClassSubjectViewSet`` precedent in school_organization for
    an endpoint whose parent resource already owns the permission story.
    """

    queryset = EmergencyContact.objects
    serializer_class = EmergencyContactSerializer
    required_feature = "module.students"
    required_permission = "students.student.view"
    required_permission_map = {"create": "students.student.update"}
    scope_campus_field = "student__campus_id"
    ordering_fields = ["priority"]

    def get_queryset(self):
        return self.scoped_child_queryset()

    def perform_create(self, serializer) -> None:
        from core.audit.services import record_audit

        data = serializer.validated_data
        serializer.instance = add_emergency_contact(
            student=self.get_student(),
            name=data["name"],
            relationship=data["relationship"],
            phone=data["phone"],
            alt_phone=data.get("alt_phone"),
            priority=data.get("priority", 1),
            notes=data.get("notes"),
            actor_id=self.request.user.pk,
            tenant_id=self.request.tenant.pk,
        )
        record_audit(self.request, "create", serializer.instance, after=serializer.data)
