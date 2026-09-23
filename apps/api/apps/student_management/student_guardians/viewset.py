"""`StudentGuardianLinkViewSet` (nested) and `StudentGuardianViewSet`
(top-level) — request handling for `/students/{student_pk}/guardians` and
`/student-guardians` (module doc §16).
"""

from __future__ import annotations

from rest_framework import mixins, viewsets

from apps.student_management.models import StudentGuardian
from apps.student_management.student_guardians.serializers import StudentGuardianSerializer
from apps.student_management.student_guardians.services import link_guardian, set_primary_guardian
from apps.student_management.views import _NestedUnderStudentMixin
from core.api.viewsets import TenantScopedViewSetMixin


class StudentGuardianViewSet(
    TenantScopedViewSetMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Top-level access to a single link, for `PATCH /student-guardians/{id}`

    (module doc §16: "link flags updatable via PATCH /api/v1/student-guardians/{id}").
    Creation happens only through the nested `StudentGuardianLinkViewSet` below,
    where the student is unambiguous from the URL.
    """

    queryset = StudentGuardian.objects
    serializer_class = StudentGuardianSerializer
    required_feature = "module.students"
    required_permission = "students.guardian.view"
    required_permission_map = {
        "update": "students.guardian.update",
        "partial_update": "students.guardian.update",
    }
    scope_campus_field = "student__campus_id"

    def perform_update(self, serializer) -> None:
        """Route a primary-flag change through the service, not a bare save.

        Promoting a link to primary must demote the incumbent first — the
        partial unique index only allows one — so this cannot be a plain
        ``serializer.save()`` the moment ``is_primary`` is part of the payload.
        """
        if serializer.validated_data.get("is_primary"):
            before = self.get_serializer(serializer.instance).data
            instance = set_primary_guardian(
                student=serializer.instance.student,
                link=serializer.instance,
                actor_id=self.request.user.pk,
            )
            # Apply any other changed fields (relationship, can_pick_up, …) on
            # top of the now-primary link, in the same request.
            remaining = {k: v for k, v in serializer.validated_data.items() if k != "is_primary"}
            for field, value in remaining.items():
                setattr(instance, field, value)
            if remaining:
                instance.updated_by = self.request.user.pk
                instance.save(update_fields=[*remaining.keys(), "updated_by", "updated_at"])
            serializer.instance = instance
            from core.audit.services import record_audit

            record_audit(self.request, "update", instance, before=before, after=serializer.data)
        else:
            super().perform_update(serializer)


class StudentGuardianLinkViewSet(
    _NestedUnderStudentMixin,
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """`GET/POST /students/{student_pk}/guardians` — links an existing guardian

    (found via `GET /guardians?search=`, or created via `POST /guardians`) to
    this student. The guardian is not created here.
    """

    queryset = StudentGuardian.objects
    serializer_class = StudentGuardianSerializer
    required_feature = "module.students"
    required_permission = "students.guardian.view"
    required_permission_map = {"create": "students.guardian.create"}
    scope_campus_field = "student__campus_id"
    # Nested under one student, so the list is a handful of rows and only ever read in
    # its own order — `created_at` alone is the allowlist rather than a shortcoming.
    # Declared explicitly because OrderingFilter is a project-wide default: a list view
    # with no allowlist does not get "no sorting", it gets every serializer field.
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return self.scoped_child_queryset()

    def perform_create(self, serializer) -> None:
        from core.audit.services import record_audit

        data = serializer.validated_data
        serializer.instance = link_guardian(
            student=self.get_student(),
            guardian=data["guardian"],
            relationship=data["relationship"],
            is_primary=data.get("is_primary", False),
            is_fee_responsible=data.get("is_fee_responsible", False),
            can_pick_up=data.get("can_pick_up", True),
            receives_communications=data.get("receives_communications", True),
            has_portal_access=data.get("has_portal_access", True),
            actor_id=self.request.user.pk,
            tenant_id=self.request.tenant.pk,
        )
        record_audit(self.request, "create", serializer.instance, after=serializer.data)
