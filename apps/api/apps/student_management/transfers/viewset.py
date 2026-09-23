"""`StudentTransferViewSet` — request handling for `/student-transfers`
(module doc §16).
"""

from __future__ import annotations

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.response import Response

from apps.student_management.models import StudentTransfer
from apps.student_management.transfers.serializers import (
    StudentTransferSerializer,
    TransferCompleteRequestSerializer,
)
from apps.student_management.transfers.services import (
    approve_transfer,
    complete_transfer,
    reject_transfer,
    request_transfer,
)
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.idempotency.services import replay_or_execute


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
    # A transfer is read by its state and its date, which is what a person deciding on
    # one sorts by. No related-field sorts: nothing renders the student's name here yet.
    ordering_fields = ["status", "created_at"]
    ordering = ["-created_at"]
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
