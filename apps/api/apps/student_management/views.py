"""HTTP layer for the student-management module.

Thin by design: every rule that needs to look at more than the request body
lives in ``services``. See core.api.viewsets.TenantScopedViewSetMixin for what
`queryset = Student.objects` (the manager, never `.all()`) buys, and for why
`required_feature` is checked before `required_permission`.
"""

from __future__ import annotations

from apps.student_management.filters import StudentFilterSet
from apps.student_management.models import Student
from apps.student_management.serializers import StudentSerializer
from apps.student_management.services import create_student
from core.api.viewsets import TenantModelViewSet


class StudentViewSet(TenantModelViewSet):
    """Student master records (module doc §5.1-2)."""

    queryset = Student.objects
    serializer_class = StudentSerializer
    filterset_class = StudentFilterSet
    search_fields = ["first_name", "last_name", "preferred_name", "admission_number"]
    ordering_fields = ["last_name", "admission_date", "created_at"]
    scope_own_field = "user_id"
    required_feature = "module.students"
    required_permission = "students.student.view"
    required_permission_map = {
        "create": "students.student.create",
        "update": "students.student.update",
        "partial_update": "students.student.update",
        "destroy": "students.student.delete",
    }
    # §16 declares no PUT — additive edits are PATCH; a full replace is not part
    # of the documented contract.
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().select_related("campus", "house")

    def perform_create(self, serializer) -> None:
        """Delegate to the service so the API, the importer and Celery jobs agree.

        Bypasses ``ModelSerializer.save()`` entirely: admission-number
        allocation needs its own transaction boundary and a duplicate check that
        a plain ``serializer.save()`` cannot express, so this mirrors
        ``ClassSubjectViewSet.perform_create`` in school_organization.
        """
        from core.audit.services import record_audit

        data = serializer.validated_data
        serializer.instance = create_student(
            campus=data["campus"],
            house=data.get("house"),
            admission_date=data["admission_date"],
            date_of_birth=data["date_of_birth"],
            first_name=data["first_name"],
            last_name=data["last_name"],
            preferred_name=data.get("preferred_name"),
            gender=data["gender"],
            user_id=data.get("user_id"),
            photo_file_id=data.get("photo_file_id"),
            blood_group=data.get("blood_group"),
            nationality=data.get("nationality"),
            religion=data.get("religion"),
            previous_school=data.get("previous_school"),
            medical_notes=data.get("medical_notes"),
            address=data.get("address"),
            custom_fields=data.get("custom_fields"),
            actor_id=self.request.user.pk,
            tenant_id=self.request.tenant.pk,
        )
        record_audit(self.request, "create", serializer.instance, after=serializer.data)
