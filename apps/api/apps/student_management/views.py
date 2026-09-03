"""HTTP layer for the student-management module.

Thin by design: every rule that needs to look at more than the request body
lives in ``services``. See core.api.viewsets.TenantScopedViewSetMixin for what
`queryset = Student.objects` (the manager, never `.all()`) buys, and for why
`required_feature` is checked before `required_permission`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.http import Http404
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.response import Response

if TYPE_CHECKING:
    from rest_framework.request import Request

from apps.student_management.filters import StudentFilterSet
from apps.student_management.models import (
    EmergencyContact,
    Guardian,
    Student,
    StudentDocument,
    StudentGuardian,
    StudentTransfer,
)
from apps.student_management.serializers import (
    ChangeSectionRequestSerializer,
    DocumentVerifyRequestSerializer,
    EmergencyContactSerializer,
    EnrollRequestSerializer,
    GuardianSerializer,
    StudentDocumentSerializer,
    StudentEnrollmentSerializer,
    StudentGuardianSerializer,
    StudentSerializer,
    StudentTransferSerializer,
    TransferCompleteRequestSerializer,
    WithdrawRequestSerializer,
)
from apps.student_management.services import (
    active_enrollment,
    add_emergency_contact,
    add_student_document,
    approve_transfer,
    build_history,
    complete_transfer,
    create_student,
    enroll_student,
    link_guardian,
    reject_transfer,
    request_transfer,
    verify_document,
    withdraw_student,
)
from apps.student_management.services import (
    change_section as change_section_service,
)
from core.api.viewsets import ActionResponse, TenantModelViewSet, TenantScopedViewSetMixin
from core.idempotency.services import replay_or_execute
from core.rbac.permissions import has_permission_key


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
        "enroll": "students.enrollment.enroll",
        "change_section": "students.enrollment.update",
        "withdraw": "students.student.withdraw",
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
            photo_file=data.get("photo_file"),
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

    @extend_schema(
        summary="Enroll a student into a session/class/section",
        request=EnrollRequestSerializer,
        responses={200: StudentEnrollmentSerializer},
    )
    def enroll(self, request, pk=None) -> Response:
        student = self.get_object()
        payload = EnrollRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        def execute() -> Response:
            from core.audit.services import record_audit

            enrollment = enroll_student(
                student=student,
                academic_session=data["academic_session"],
                school_class=data["school_class"],
                section=data["section"],
                enrollment_date=data["enrollment_date"],
                roll_number=data.get("roll_number"),
                capacity_override_reason=data.get("capacity_override_reason"),
                actor_has_capacity_override=has_permission_key(
                    request.user, "students.student.update"
                ),
                actor_id=request.user.pk,
                tenant_id=request.tenant.pk,
            )
            after = StudentEnrollmentSerializer(enrollment).data
            audit_extra = (
                {"capacity_override_reason": data["capacity_override_reason"]}
                if data.get("capacity_override_reason")
                else {}
            )
            record_audit(request, "enroll", enrollment, after={**after, **audit_extra})
            return ActionResponse.ok(after, message="Student enrolled.", status=201)

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="students:enroll",
            execute=execute,
        )

    @extend_schema(
        summary="Change a student's section allocation",
        request=ChangeSectionRequestSerializer,
        responses={200: StudentEnrollmentSerializer},
    )
    def change_section(self, request, pk=None) -> Response:
        student = self.get_object()
        payload = ChangeSectionRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        enrollment = active_enrollment(student)
        if enrollment is None:
            raise Http404

        def execute() -> Response:
            from core.audit.services import record_audit

            before = StudentEnrollmentSerializer(enrollment).data
            updated = change_section_service(
                enrollment=enrollment,
                section=data["section"],
                roll_number=data.get("roll_number"),
                capacity_override_reason=data.get("capacity_override_reason"),
                actor_has_capacity_override=has_permission_key(
                    request.user, "students.student.update"
                ),
                actor_id=request.user.pk,
            )
            after = StudentEnrollmentSerializer(updated).data
            audit_extra = (
                {"capacity_override_reason": data["capacity_override_reason"]}
                if data.get("capacity_override_reason")
                else {}
            )
            record_audit(
                request, "change-section", updated, before=before, after={**after, **audit_extra}
            )
            return ActionResponse.ok(after, message="Section changed.")

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="students:change-section",
            execute=execute,
        )

    @extend_schema(
        summary="Withdraw a student",
        request=WithdrawRequestSerializer,
        responses={200: StudentSerializer},
    )
    def withdraw(self, request, pk=None) -> Response:
        student = self.get_object()
        payload = WithdrawRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        def execute() -> Response:
            from core.audit.services import record_audit

            before = self.get_serializer(student).data
            withdrawn = withdraw_student(
                student=student,
                reason=data["reason"],
                effective_date=data["effective_date"],
                waive_clearance=data.get("waive_clearance", False),
                actor_has_withdrawal_approval=has_permission_key(
                    request.user, "students.withdrawal.approve"
                ),
                actor_id=request.user.pk,
            )
            after = self.get_serializer(withdrawn).data
            record_audit(
                request,
                "withdraw",
                withdrawn,
                before=before,
                after={**after, "reason": data["reason"]},
            )
            return ActionResponse.ok(after, message="Student withdrawn.")

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="students:withdraw",
            execute=execute,
        )

    @extend_schema(
        summary="Assemble a student's chronological history",
        responses={200: OpenApiResponse(description="Timeline of enrollment and transfer events")},
    )
    def history(self, request, pk=None) -> Response:
        student = self.get_object()
        return ActionResponse.ok(build_history(student))


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
            from apps.student_management.services import set_primary_guardian

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


class _NestedUnderStudentMixin:
    """Resolves the parent student from the URL, 404ing exactly the way a

    direct `/students/{id}` lookup would for a foreign or unknown id — the
    tenant-scoped, scope-narrowed manager is the same one `StudentViewSet`
    itself reads from, so a caller cannot see a nested resource under a
    student they could not otherwise see directly.
    """

    # This mixin is only ever combined with a GenericAPIView subclass, which
    # is what actually supplies these at runtime — declared here purely so
    # mypy knows about them on this class in isolation.
    if TYPE_CHECKING:
        request: Request
        kwargs: dict[str, str]

    def get_student(self) -> Student:
        from core.rbac.permissions import scope_queryset

        queryset = scope_queryset(Student.objects.alive(), self.request.user, own_field="user_id")
        try:
            return get_object_or_404(queryset, pk=self.kwargs["student_pk"])
        except (ValueError, TypeError) as exc:
            # A malformed UUID in the path is a 404, not a 500 — same
            # not-found story as a well-formed but nonexistent id.
            raise Http404 from exc


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

    def get_queryset(self):
        return super().get_queryset().filter(student=self.get_student())

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
        return super().get_queryset().filter(student=self.get_student())

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


class StudentDocumentLinkViewSet(
    _NestedUnderStudentMixin,
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """`GET/POST /students/{student_pk}/documents`."""

    queryset = StudentDocument.objects
    serializer_class = StudentDocumentSerializer
    required_feature = "module.students"
    required_permission = "students.document.view"
    required_permission_map = {"create": "students.document.create"}
    scope_campus_field = "student__campus_id"

    def get_queryset(self):
        return super().get_queryset().filter(student=self.get_student())

    def perform_create(self, serializer) -> None:
        from core.audit.services import record_audit

        data = serializer.validated_data
        serializer.instance = add_student_document(
            student=self.get_student(),
            file=data["file"],
            document_type=data["document_type"],
            title=data["title"],
            notes=data.get("notes"),
            expires_at=data.get("expires_at"),
            actor_id=self.request.user.pk,
            tenant_id=self.request.tenant.pk,
        )
        record_audit(self.request, "create", serializer.instance, after=serializer.data)


class StudentDocumentViewSet(
    TenantScopedViewSetMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Top-level access for `DELETE /student-documents/{id}` and the

    `:verify` colon-action. §4 declares ``students.document.delete`` but §16
    names no endpoint for it — added here so the key is reachable; the module
    doc gets the corresponding update in this PR.
    """

    queryset = StudentDocument.objects
    serializer_class = StudentDocumentSerializer
    required_feature = "module.students"
    required_permission = "students.document.view"
    required_permission_map = {
        "destroy": "students.document.delete",
        "verify": "students.document.verify",
    }
    scope_campus_field = "student__campus_id"

    @extend_schema(
        summary="Verify or reject a student document",
        request=DocumentVerifyRequestSerializer,
        responses={
            200: StudentDocumentSerializer,
            409: OpenApiResponse(description="Already decided"),
        },
    )
    def verify(self, request, pk=None) -> Response:
        from core.audit.services import record_audit

        payload = DocumentVerifyRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        document = self.get_object()
        before = self.get_serializer(document).data
        document = verify_document(
            document=document,
            decision=payload.validated_data["decision"],
            actor_id=request.user.pk,
        )
        after = self.get_serializer(document).data
        record_audit(request, "verify", document, before=before, after=after)
        return ActionResponse.ok(after, message=f"Document {document.verification_status}.")


class StudentTransferViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`GET/POST /student-transfers` plus the `:approve`/`:reject`/`:complete`

    colon-actions (module doc §16). No update/destroy — a transfer's state
    only ever moves through those three actions. §4 declares no
    ``students.transfer.view`` key, so list/retrieve reuse
    ``students.student.view`` — the same ``ClassSubjectViewSet`` precedent
    used elsewhere in this module — since a `principal` deciding on a
    transfer needs to see it, not just the `school_admin` who created it.
    """

    queryset = StudentTransfer.objects
    serializer_class = StudentTransferSerializer
    required_feature = "module.students"
    required_permission = "students.student.view"
    required_permission_map = {
        "create": "students.transfer.create",
        "approve": "students.transfer.approve",
        "reject": "students.transfer.approve",
        # complete executes an already-approved transfer — an operational
        # step for the same role that requested it, not a second decision, so
        # it reuses the create key rather than the approve one.
        "complete": "students.transfer.create",
    }

    def perform_create(self, serializer) -> None:
        from core.audit.services import record_audit

        data = serializer.validated_data
        serializer.instance = request_transfer(
            student=data["student"],
            transfer_type=data["transfer_type"],
            reason=data["reason"],
            effective_date=data["effective_date"],
            from_campus=data.get("from_campus"),
            to_campus=data.get("to_campus"),
            external_school_name=data.get("external_school_name"),
            actor_id=self.request.user.pk,
            tenant_id=self.request.tenant.pk,
        )
        record_audit(self.request, "create", serializer.instance, after=serializer.data)

    @extend_schema(
        summary="Approve a student transfer",
        request=None,
        responses={
            200: StudentTransferSerializer,
            409: OpenApiResponse(description="Already decided"),
        },
    )
    def approve(self, request, pk=None) -> Response:
        transfer = self.get_object()

        def execute() -> Response:
            from core.audit.services import record_audit

            before = self.get_serializer(transfer).data
            approved = approve_transfer(transfer=transfer, actor_id=request.user.pk)
            after = self.get_serializer(approved).data
            record_audit(request, "approve", approved, before=before, after=after)
            return ActionResponse.ok(after, message="Transfer approved.")

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="student-transfers:approve",
            execute=execute,
        )

    @extend_schema(
        summary="Reject a student transfer",
        request=None,
        responses={
            200: StudentTransferSerializer,
            409: OpenApiResponse(description="Already decided"),
        },
    )
    def reject(self, request, pk=None) -> Response:
        transfer = self.get_object()

        def execute() -> Response:
            from core.audit.services import record_audit

            before = self.get_serializer(transfer).data
            rejected = reject_transfer(transfer=transfer, actor_id=request.user.pk)
            after = self.get_serializer(rejected).data
            record_audit(request, "reject", rejected, before=before, after=after)
            return ActionResponse.ok(after, message="Transfer rejected.")

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="student-transfers:reject",
            execute=execute,
        )

    @extend_schema(
        summary="Execute an approved student transfer",
        request=TransferCompleteRequestSerializer,
        responses={
            200: StudentTransferSerializer,
            409: OpenApiResponse(description="Not yet approved"),
        },
    )
    def complete(self, request, pk=None) -> Response:
        transfer = self.get_object()
        payload = TransferCompleteRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        def execute() -> Response:
            from core.audit.services import record_audit

            before = self.get_serializer(transfer).data
            completed = complete_transfer(
                transfer=transfer,
                section=payload.validated_data.get("section"),
                actor_id=request.user.pk,
            )
            after = self.get_serializer(completed).data
            record_audit(request, "complete", completed, before=before, after=after)
            return ActionResponse.ok(after, message="Transfer completed.")

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="student-transfers:complete",
            execute=execute,
        )
