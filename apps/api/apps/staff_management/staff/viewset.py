"""`StaffViewSet` — request handling for `/staff`, plus `StaffImportViewSet`/

`StaffExportViewSet` for the bulk `/staff-imports` and `/staff-exports`
endpoints (module doc §16).

Thin by design: every rule that needs to look at more than the request body
lives in `services/<action>.py` (`services/create.py`, `services/invite.py`,
`services/exit.py`, `services/import_staff.py`, `services/export_staff.py`).
See `apps.staff_management.views`' module docstring for why every staff
endpoint layers `DenyRestrictedPrincipals` on top of the base tenant-scoped
permission stack (`_StaffModuleViewSetMixin`, defined there and reused here)
— this module was its first real consumer.
"""

from __future__ import annotations

import base64

from django.db.models import F
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import viewsets
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from apps.staff_management.models import Staff
from apps.staff_management.staff.filters import StaffFilterSet
from apps.staff_management.staff.serializers import (
    ExitRequestSerializer,
    InviteRequestSerializer,
    StaffImportRequestSerializer,
    StaffSerializer,
)
from apps.staff_management.staff.services.create import create_staff
from apps.staff_management.staff.services.exit import exit_staff
from apps.staff_management.staff.services.invite import invite_staff
from apps.staff_management.tasks import export_staff_task, import_staff_task
from apps.staff_management.views import _StaffModuleViewSetMixin
from core.api.exceptions import DomainRuleViolation
from core.api.pagination import PageNumberPagination
from core.api.viewsets import ActionResponse
from core.audit.services import record_audit
from core.idempotency.services import replay_or_execute
from core.jobs.services import attach_celery_task_id, create_job

_MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024


class StaffViewSet(_StaffModuleViewSetMixin, viewsets.ModelViewSet):
    """Staff master records (module doc §5.1)."""

    # Page numbers for the same reason as students: a bounded roll navigated by
    # position rather than by scrolling. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    queryset = Staff.objects
    serializer_class = StaffSerializer
    filterset_class = StaffFilterSet
    search_fields = ["first_name", "last_name", "employee_number", "email", "phone"]
    # Everything the dashboard's staff roll renders.
    # `campus_name`/`department_name`/`designation_name` are the annotations from
    # `get_queryset`, never `campus__name` and friends: `scope_queryset` hands an
    # OWN/ASSIGNED principal a `.distinct()` queryset, and Postgres rejects
    # `SELECT DISTINCT` ordered by a joined column that is not in the select
    # list. An annotation is in the select list, so it sorts for every principal
    # rather than 500-ing for the ones this module actually has — a staff member
    # on `own` and a department head on `assigned`.
    # Index-backed: `last_name` (staff_tenant_name_idx), `staff_type`
    # (staff_tenant_type_idx), `employment_status` (staff_tenant_status_idx),
    # `joining_date` (staff_tenant_joined_idx), `employee_number`
    # (staff_unique_employee_number_per_tenant, whose `deleted_at IS NULL` condition
    # is exactly what this list already filters on) and `created_at` (its own index).
    # Table scans: `first_name` — staff_tenant_name_idx leads with `last_name`, so it
    # cannot serve a sort on its second column alone — plus `email`, which nothing
    # indexes (it is nullable, so staff with no address sort last ascending and first
    # descending), plus the three annotated names, each a sort over a left join.
    # Allowed because this list is bounded by one school's payroll; on a big table
    # each would want an index.
    ordering_fields = [
        "last_name",
        "first_name",
        "employee_number",
        "staff_type",
        "employment_status",
        "joining_date",
        "email",
        "campus_name",
        "department_name",
        "designation_name",
        "created_at",
    ]
    #: Entries in ordering_fields that are annotations from get_queryset, not model
    #: fields — tests/test_endpoint_contracts.py cannot resolve these against the model.
    ordering_annotations = ("campus_name", "department_name", "designation_name")
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
        # select_related keeps the list off a campus/department/designation fetch
        # per row; the annotations are what `?ordering=<...>_name` sorts on, and
        # they reuse those same joins rather than adding their own.
        return (
            super()
            .get_queryset()
            .select_related("campus", "department", "designation")
            .annotate(
                campus_name=F("campus__name"),
                department_name=F("department__name"),
                designation_name=F("designation__name"),
            )
        )

    def perform_create(self, serializer) -> None:
        """Delegate to the service so the API and the bulk importer agree.

        Bypasses ``ModelSerializer.save()`` entirely — employee-number
        allocation needs its own transaction boundary, mirroring
        ``StudentViewSet.perform_create`` exactly.
        """
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
            before = self.get_serializer(staff).data
            updated = exit_staff(
                staff=staff,
                exit_date=data["exit_date"],
                exit_reason=data["exit_reason"],
                exit_type=data["exit_type"],
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
