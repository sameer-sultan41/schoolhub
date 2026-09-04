"""HTTP layer for the staff-management module.

Thin by design: every rule that needs to look at more than the request body
lives in ``services``. See core.api.viewsets.TenantScopedViewSetMixin for what
`queryset = Staff.objects` (the manager, never `.all()`) buys, and for why
`required_feature` is checked before `required_permission`.

Every viewset here adds ``DenyRestrictedPrincipals`` on top of the base
tenant-scoped permission stack — this module is its first real consumer
(previously zero call sites anywhere in the codebase): students and guardians
must never reach a staff endpoint, even via a hypothetical custom role that
somehow carries a ``staff.*`` key.
"""

from __future__ import annotations

import base64
from typing import TYPE_CHECKING

from django.http import Http404
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

if TYPE_CHECKING:
    from rest_framework.request import Request

from apps.staff_management.filters import StaffFilterSet
from apps.staff_management.models import Designation, Staff, StaffDocument, StaffQualification
from apps.staff_management.serializers import (
    DesignationSerializer,
    ExitRequestSerializer,
    InviteRequestSerializer,
    StaffDocumentSerializer,
    StaffImportRequestSerializer,
    StaffQualificationSerializer,
    StaffSerializer,
    VerifyRequestSerializer,
)
from apps.staff_management.services import (
    add_staff_document,
    add_staff_qualification,
    create_staff,
    exit_staff,
    invite_staff,
    verify_document,
    verify_qualification,
)
from apps.staff_management.tasks import export_staff_task, import_staff_task
from core.api.exceptions import DomainRuleViolation
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.idempotency.services import replay_or_execute
from core.jobs.services import attach_celery_task_id, create_job
from core.rbac.permissions import DenyRestrictedPrincipals, HasPermissionKey

_MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024


class _StaffModuleViewSetMixin(TenantScopedViewSetMixin):
    """Adds ``DenyRestrictedPrincipals`` to the base tenant-scoped stack — see

    this module's docstring for why every staff endpoint needs it.
    """

    permission_classes = [
        IsAuthenticated,
        RequiresModuleFeature,
        HasPermissionKey,
        DenyRestrictedPrincipals,
    ]


class StaffViewSet(_StaffModuleViewSetMixin, viewsets.ModelViewSet):
    """Staff master records (module doc §5.1)."""

    queryset = Staff.objects
    serializer_class = StaffSerializer
    filterset_class = StaffFilterSet
    search_fields = ["first_name", "last_name", "employee_number", "email", "phone"]
    ordering_fields = ["last_name", "joining_date", "created_at"]
    scope_own_field = "user_id"
    required_feature = "module.staff"
    required_permission = "staff.staff.view"
    required_permission_map = {
        "create": "staff.staff.create",
        "update": "staff.staff.update",
        "partial_update": "staff.staff.update",
        "destroy": "staff.staff.delete",
        "invite": "staff.staff.update",
        "exit": "staff.staff.delete",
    }
    # §16 declares no PUT — additive edits are PATCH.
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().select_related("campus", "department", "designation")

    def perform_create(self, serializer) -> None:
        """Delegate to the service so the API and the bulk importer agree.

        Bypasses ``ModelSerializer.save()`` entirely — employee-number
        allocation needs its own transaction boundary, mirroring
        ``StudentViewSet.perform_create`` exactly.
        """
        from core.audit.services import record_audit

        data = serializer.validated_data
        serializer.instance = create_staff(
            campus=data["campus"],
            department=data.get("department"),
            designation=data.get("designation"),
            reports_to=data.get("reports_to"),
            joining_date=data["joining_date"],
            first_name=data["first_name"],
            last_name=data["last_name"],
            staff_type=data["staff_type"],
            phone=data["phone"],
            user_id=data.get("user_id"),
            photo_file=data.get("photo_file"),
            gender=data.get("gender"),
            date_of_birth=data.get("date_of_birth"),
            employment_type=data.get("employment_type"),
            email=data.get("email"),
            national_id=data.get("national_id"),
            public_bio=data.get("public_bio"),
            address=data.get("address"),
            custom_fields=data.get("custom_fields"),
            actor_id=self.request.user.pk,
            tenant_id=self.request.tenant.pk,
        )
        record_audit(self.request, "create", serializer.instance, after=serializer.data)

    @extend_schema(
        summary="Create a portal account for this staff member and assign roles",
        request=InviteRequestSerializer,
        responses={200: StaffSerializer, 409: OpenApiResponse(description="Already linked")},
    )
    def invite(self, request, pk=None) -> Response:
        staff = self.get_object()
        payload = InviteRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        def execute() -> Response:
            from core.audit.services import record_audit

            before = self.get_serializer(staff).data
            updated = invite_staff(staff=staff, role_ids=data["role_ids"], actor_id=request.user.pk)
            after = self.get_serializer(updated).data
            record_audit(request, "invite", updated, before=before, after=after)
            return ActionResponse.ok(after, message="Account created and linked.")

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="staff:invite",
            execute=execute,
        )

    @extend_schema(
        summary="Exit a staff member (clearance-checked)",
        request=ExitRequestSerializer,
        responses={
            200: StaffSerializer,
            409: OpenApiResponse(description="Already exited"),
            422: OpenApiResponse(description="Clearance blockers or invalid dates"),
        },
    )
    def exit(self, request, pk=None) -> Response:
        staff = self.get_object()
        payload = ExitRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        def execute() -> Response:
            from core.audit.services import record_audit

            before = self.get_serializer(staff).data
            updated = exit_staff(
                staff=staff,
                exit_date=data["exit_date"],
                exit_reason=data["exit_reason"],
                actor_id=request.user.pk,
            )
            after = self.get_serializer(updated).data
            record_audit(request, "exit", updated, before=before, after=after)
            return ActionResponse.ok(after, message="Staff member exited.")

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="staff:exit",
            execute=execute,
        )


class DesignationViewSet(_StaffModuleViewSetMixin, viewsets.ModelViewSet):
    """Tenant-defined designation catalog (module doc §5.4)."""

    queryset = Designation.objects
    serializer_class = DesignationSerializer
    search_fields = ["name", "code"]
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
        from apps.staff_management.services import assert_designation_deactivatable

        assert_designation_deactivatable(designation=instance)
        super().perform_destroy(instance)


class _NestedUnderStaffMixin:
    """Resolves the parent staff record from the URL — mirrors

    student_management's ``_NestedUnderStudentMixin`` exactly, including the
    malformed-UUID-is-a-404 handling.
    """

    if TYPE_CHECKING:
        request: Request
        kwargs: dict[str, str]

    def get_staff(self) -> Staff:
        from core.rbac.permissions import scope_queryset

        queryset = scope_queryset(Staff.objects.alive(), self.request.user, own_field="user_id")
        try:
            return get_object_or_404(queryset, pk=self.kwargs["staff_pk"])
        except (ValueError, TypeError) as exc:
            raise Http404 from exc


class StaffQualificationLinkViewSet(
    _NestedUnderStaffMixin,
    _StaffModuleViewSetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """`GET/POST /staff/{staff_pk}/qualifications`."""

    queryset = StaffQualification.objects
    serializer_class = StaffQualificationSerializer
    required_feature = "module.staff"
    required_permission = "staff.qualification.view"
    required_permission_map = {"create": "staff.qualification.create"}
    scope_campus_field = "staff__campus_id"

    def get_queryset(self):
        return super().get_queryset().filter(staff=self.get_staff())

    def perform_create(self, serializer) -> None:
        from core.audit.services import record_audit

        data = serializer.validated_data
        serializer.instance = add_staff_qualification(
            staff=self.get_staff(),
            qualification_type=data["qualification_type"],
            title=data["title"],
            institution=data.get("institution"),
            field_of_study=data.get("field_of_study"),
            year_awarded=data.get("year_awarded"),
            grade=data.get("grade"),
            document_file=data.get("document_file"),
            actor_id=self.request.user.pk,
            tenant_id=self.request.tenant.pk,
        )
        record_audit(self.request, "create", serializer.instance, after=serializer.data)


class StaffQualificationViewSet(
    _StaffModuleViewSetMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Top-level access for `PATCH /staff-qualifications/{id}` and `:verify`."""

    queryset = StaffQualification.objects
    serializer_class = StaffQualificationSerializer
    required_feature = "module.staff"
    required_permission = "staff.qualification.view"
    required_permission_map = {
        "update": "staff.qualification.update",
        "partial_update": "staff.qualification.update",
        "verify": "staff.qualification.verify",
    }
    scope_campus_field = "staff__campus_id"
    http_method_names = ["get", "patch", "head", "options"]

    @extend_schema(
        summary="Verify or reject a staff qualification",
        request=VerifyRequestSerializer,
        responses={
            200: StaffQualificationSerializer,
            409: OpenApiResponse(description="Already decided"),
        },
    )
    def verify(self, request, pk=None) -> Response:
        from core.audit.services import record_audit

        payload = VerifyRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        qualification = self.get_object()
        before = self.get_serializer(qualification).data
        qualification = verify_qualification(
            qualification=qualification,
            decision=payload.validated_data["decision"],
            actor_id=request.user.pk,
        )
        after = self.get_serializer(qualification).data
        record_audit(request, "verify", qualification, before=before, after=after)
        return ActionResponse.ok(
            after, message=f"Qualification {qualification.verification_status}."
        )


class StaffDocumentLinkViewSet(
    _NestedUnderStaffMixin,
    _StaffModuleViewSetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """`GET/POST /staff/{staff_pk}/documents`."""

    queryset = StaffDocument.objects
    serializer_class = StaffDocumentSerializer
    required_feature = "module.staff"
    required_permission = "staff.document.view"
    required_permission_map = {"create": "staff.document.create"}
    scope_campus_field = "staff__campus_id"

    def get_queryset(self):
        return super().get_queryset().filter(staff=self.get_staff())

    def perform_create(self, serializer) -> None:
        from core.audit.services import record_audit

        data = serializer.validated_data
        serializer.instance = add_staff_document(
            staff=self.get_staff(),
            file=data["file"],
            document_type=data["document_type"],
            title=data["title"],
            notes=data.get("notes"),
            expires_at=data.get("expires_at"),
            actor_id=self.request.user.pk,
            tenant_id=self.request.tenant.pk,
        )
        record_audit(self.request, "create", serializer.instance, after=serializer.data)


class StaffDocumentViewSet(
    _StaffModuleViewSetMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Top-level access for `DELETE /staff-documents/{id}` and `:verify`."""

    queryset = StaffDocument.objects
    serializer_class = StaffDocumentSerializer
    required_feature = "module.staff"
    required_permission = "staff.document.view"
    required_permission_map = {
        "destroy": "staff.document.delete",
        "verify": "staff.document.verify",
    }
    scope_campus_field = "staff__campus_id"

    @extend_schema(
        summary="Verify or reject a staff document",
        request=VerifyRequestSerializer,
        responses={
            200: StaffDocumentSerializer,
            409: OpenApiResponse(description="Already decided"),
        },
    )
    def verify(self, request, pk=None) -> Response:
        from core.audit.services import record_audit

        payload = VerifyRequestSerializer(data=request.data)
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


class StaffImportViewSet(_StaffModuleViewSetMixin, viewsets.GenericViewSet):
    """`POST /staff-imports` -> `202` + job (module doc §16)."""

    required_feature = "module.staff"
    required_permission = "staff.staff.import"
    parser_classes = [MultiPartParser]

    @extend_schema(
        summary="Bulk-import staff from a CSV or .xlsx file",
        request=StaffImportRequestSerializer,
        responses={
            202: OpenApiResponse(description="{'data': {'job_id': str, 'status': 'queued'}}")
        },
    )
    def create(self, request, *args, **kwargs) -> Response:
        from core.audit.services import record_audit

        payload = StaffImportRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        upload = payload.validated_data["file"]

        content = upload.read()
        if len(content) > _MAX_IMPORT_FILE_BYTES:
            raise DomainRuleViolation(
                {"file": f"Import file exceeds the {_MAX_IMPORT_FILE_BYTES}-byte limit."}
            )

        job = create_job(
            tenant_id=request.tenant.pk,
            job_type="import.staff",
            payload={
                "filename": upload.name,
                "content_base64": base64.b64encode(content).decode(),
            },
            actor_id=request.user.pk,
        )
        result = import_staff_task.delay(
            tenant_id=str(request.tenant.pk), job_id=str(job.pk), actor_id=str(request.user.pk)
        )
        attach_celery_task_id(job=job, celery_task_id=result.id)
        record_audit(request, "import", job, after={"job_id": str(job.pk), "filename": upload.name})
        return ActionResponse.accepted(str(job.pk), message="Import queued.")


class StaffExportViewSet(_StaffModuleViewSetMixin, viewsets.GenericViewSet):
    """`POST /staff-exports` -> `202` + job."""

    required_feature = "module.staff"
    required_permission = "staff.staff.export"

    @extend_schema(
        summary="Export all staff as CSV",
        request=None,
        responses={
            202: OpenApiResponse(description="{'data': {'job_id': str, 'status': 'queued'}}")
        },
    )
    def create(self, request, *args, **kwargs) -> Response:
        from core.audit.services import record_audit

        job = create_job(
            tenant_id=request.tenant.pk,
            job_type="export.staff",
            payload={},
            actor_id=request.user.pk,
        )
        result = export_staff_task.delay(
            tenant_id=str(request.tenant.pk), job_id=str(job.pk), actor_id=str(request.user.pk)
        )
        attach_celery_task_id(job=job, celery_task_id=result.id)
        record_audit(request, "export", job, after={"job_id": str(job.pk)})
        return ActionResponse.accepted(str(job.pk), message="Export queued.")
