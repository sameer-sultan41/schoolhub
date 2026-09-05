"""HTTP layer for the academics module.

Thin by design: every rule that needs more than the request body lives in
``services``. See core.api.viewsets.TenantScopedViewSetMixin for what
`queryset = Model.objects` (the manager, never `.all()`) buys, and for why
`required_feature` is checked before `required_permission`.

`CurriculumViewSet` serves `/api/v1/class-subjects`, which school_organization
used to own under `school.subject.*` keys. academics.md §4 declares
`academics.curriculum.*` for it and school-organization.md §6 says curriculum
mapping belongs here, so the endpoint moved and the old viewset was removed —
one route, one key set. The *model* stayed put (apps/academics/models.py's
header says why).
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

if TYPE_CHECKING:
    from rest_framework.request import Request

from apps.academics import services
from apps.academics.filters import (
    CurriculumFilterSet,
    PromotionFilterSet,
    TeacherAllocationFilterSet,
)
from apps.academics.models import PromotionStatus, StudentPromotion, TeacherSubjectAllocation
from apps.academics.serializers import (
    CloneCurriculumRequestSerializer,
    CreatePromotionBatchSerializer,
    CurriculumSerializer,
    PromotionDecisionSerializer,
    TeacherAllocationSerializer,
)
from apps.school_organization.models import AcademicSession, ClassSubject
from apps.school_organization.services import map_subject_to_class
from core.api.exceptions import Conflict, DomainRuleViolation
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.idempotency.services import replay_or_execute
from core.rbac.permissions import DenyRestrictedPrincipals, HasPermissionKey

FEATURE = "module.academics"


class CurriculumViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`class_subjects` — the session curriculum grid (§5.1)."""

    queryset = ClassSubject.objects
    serializer_class = CurriculumSerializer
    filterset_class = CurriculumFilterSet
    search_fields = ["elective_group", "notes"]
    ordering_fields = ["created_at"]
    scope_campus_field = "campus_id"
    required_feature = FEATURE
    required_permission = "academics.curriculum.view"
    required_permission_map = {
        "create": "academics.curriculum.create",
        "update": "academics.curriculum.update",
        "partial_update": "academics.curriculum.update",
        "destroy": "academics.curriculum.delete",
        "clone": "academics.curriculum.create",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .select_related("academic_session", "school_class", "subject", "campus")
        )

    def perform_create(self, serializer) -> None:
        """Delegate to school_organization's existing service.

        `map_subject_to_class` already enforces every §11 curriculum rule and is
        what the session-clone wizard and the importer call, so routing the API
        through it keeps all three agreeing rather than drifting.
        """
        data = serializer.validated_data
        instance = map_subject_to_class(
            session=data["academic_session"],
            school_class=data["school_class"],
            subject=data["subject"],
            campus=data.get("campus"),
            is_elective=data.get("is_elective", False),
            elective_group=data.get("elective_group"),
            weekly_periods=data.get("weekly_periods", 1),
            syllabus_file_id=data.get("syllabus_file_id"),
            term_plans=data.get("term_plans"),
            notes=data.get("notes"),
            actor_id=self.request.user.pk,
            tenant_id=self.request.tenant.pk,
        )
        serializer.instance = instance
        record_audit(self.request, "create", instance, after=serializer.data)

    def perform_destroy(self, instance) -> None:
        """An elective group must not be left with a single option (§11)."""
        if instance.elective_group:
            services.assert_elective_group_has_options(
                session=instance.academic_session,
                school_class=instance.school_class,
                elective_group=instance.elective_group,
                exclude_pk=instance.pk,
            )
        super().perform_destroy(instance)

    @extend_schema(
        summary="Clone a session's curriculum into another session",
        request=CloneCurriculumRequestSerializer,
        responses={200: OpenApiResponse(description="Row counts created and skipped.")},
    )
    def clone(self, request: Request) -> Response:
        serializer = CloneCurriculumRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        def execute() -> Response:
            summary = services.clone_curriculum(
                source_session=serializer.validated_data["source_session"],
                target_session=serializer.validated_data["target_session"],
                tenant_id=request.tenant.pk,
                actor_id=request.user.pk,
            )
            return ActionResponse.ok(summary, message="Curriculum cloned.")

        # Synchronous despite §16 calling it a background job: a clone is one
        # bulk_create over a single session's rows, and a school's whole
        # curriculum is hundreds of rows, not thousands. Idempotency-keyed so a
        # client retry after a timeout replays rather than double-runs; the
        # service also skips rows the target already has, so it converges even
        # without the key.
        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="class-subjects:clone",
            execute=execute,
        )


class TeacherAllocationViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`teacher_subject_allocations` — who teaches what, to whom (§5.3)."""

    permission_classes = [
        IsAuthenticated,
        RequiresModuleFeature,
        HasPermissionKey,
        DenyRestrictedPrincipals,
    ]
    queryset = TeacherSubjectAllocation.objects
    serializer_class = TeacherAllocationSerializer
    filterset_class = TeacherAllocationFilterSet
    ordering_fields = ["created_at", "effective_from"]
    # "own" for a teacher means their own allocations, joined through
    # staff.user_id — TeacherSubjectAllocation.filter_owned_by_user.
    scope_own_field = "staff__user_id"
    scope_campus_field = "section__campus_id"
    required_feature = FEATURE
    required_permission = "academics.teacher-allocation.view"
    required_permission_map = {
        "create": "academics.teacher-allocation.create",
        "update": "academics.teacher-allocation.update",
        "partial_update": "academics.teacher-allocation.update",
        "destroy": "academics.teacher-allocation.delete",
        "load_summary": "academics.teacher-allocation.view",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return (
            super().get_queryset().select_related("academic_session", "section", "subject", "staff")
        )

    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        allocation = services.create_allocation(
            session=data["academic_session"],
            section=data["section"],
            subject=data["subject"],
            staff=data["staff"],
            is_primary=data.get("is_primary", True),
            weekly_periods=data.get("weekly_periods"),
            effective_from=data.get("effective_from"),
            tenant_id=request.tenant.pk,
            actor_id=request.user.pk,
        )
        body = self.get_serializer(allocation).data
        record_audit(request, "create", allocation, after=body)
        services.notify_allocation_changed(allocation=allocation, tenant_id=request.tenant.pk)

        # Load warnings ride in `meta`, never as a 422 — §11 calls them warnings,
        # and a grid being built up mid-way has to be savable while over norm.
        warnings = services.load_warnings(staff=data["staff"], session=data["academic_session"])
        return ActionResponse.ok({"data": body, "meta": {"warnings": warnings}}, status=201)

    @extend_schema(
        summary="Per-teacher weekly load against the tenant norm",
        responses={200: OpenApiResponse(description="Aggregate load per teacher.")},
    )
    def load_summary(self, request: Request) -> Response:
        session_id = request.query_params.get("academic_session_id")
        if not session_id:
            raise DomainRuleViolation({"academic_session_id": "This query parameter is required."})

        session = get_object_or_404(AcademicSession.objects.alive(), pk=session_id)
        totals = services.weekly_load_by_staff(session=session)

        # The scoped queryset, not a fresh one: a teacher with `own` scope sees
        # only their own row here, exactly as they do in the list.
        rows = (
            self.get_queryset()
            .filter(academic_session=session, effective_to__isnull=True)
            .select_related("staff")
        )

        by_staff: dict[str, dict] = {}
        for allocation in rows:
            entry = by_staff.setdefault(
                str(allocation.staff_id),
                {
                    "staff_id": str(allocation.staff_id),
                    "name": f"{allocation.staff.first_name} {allocation.staff.last_name}",
                    "weekly_periods": totals.get(allocation.staff_id, 0),
                    "allocations": 0,
                    "over_norm": totals.get(allocation.staff_id, 0)
                    > services.DEFAULT_WEEKLY_PERIOD_NORM,
                },
            )
            entry["allocations"] += 1

        return ActionResponse.ok(sorted(by_staff.values(), key=lambda e: e["name"]))


class PromotionViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """`student_promotions` — batch review and the §7.2 state machine.

    No `create` here: a batch is created by `POST /student-promotions` with a
    class and a session pair, not by posting a single decision, so that action
    has its own handler below. Decisions are only ever edited, never added.
    """

    permission_classes = [
        IsAuthenticated,
        RequiresModuleFeature,
        HasPermissionKey,
        DenyRestrictedPrincipals,
    ]
    queryset = StudentPromotion.objects
    serializer_class = PromotionDecisionSerializer
    filterset_class = PromotionFilterSet
    ordering_fields = ["created_at"]
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "academics.promotion.view"
    required_permission_map = {
        "update": "academics.promotion.update",
        "partial_update": "academics.promotion.update",
        "create_batch": "academics.promotion.create",
        "submit": "academics.promotion.update",
        "approve": "academics.promotion.approve",
        "reject": "academics.promotion.approve",
        "execute": "academics.promotion.execute",
        "revert": "academics.promotion.update",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().select_related("student", "from_class", "to_class")

    def update(self, request: Request, *args, **kwargs) -> Response:
        """Only a draft row is editable — everything after submit is under review."""
        instance = self.get_object()
        if instance.status != PromotionStatus.DRAFT:
            raise Conflict(f"This decision is {instance.status} and can no longer be edited.")
        return super().update(request, *args, **kwargs)

    @extend_schema(
        summary="Create a promotion batch for one class",
        request=CreatePromotionBatchSerializer,
        responses={201: OpenApiResponse(description="The new batch id and its row count.")},
    )
    def create_batch(self, request: Request) -> Response:
        serializer = CreatePromotionBatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        batch_id, rows = services.create_promotion_batch(
            from_session=data["from_session"],
            to_session=data["to_session"],
            school_class=data["school_class"],
            tenant_id=request.tenant.pk,
            actor_id=request.user.pk,
        )
        return ActionResponse.ok(
            {"batch_id": str(batch_id), "students": len(rows)},
            message="Promotion batch created.",
            status=201,
        )

    @extend_schema(summary="Submit a draft batch for approval", request=None, responses={200: None})
    def submit(self, request: Request, pk: str) -> Response:
        count = services.submit_batch(batch_id=uuid.UUID(pk), actor_id=request.user.pk)
        return ActionResponse.ok({"updated": count}, message="Batch submitted for approval.")

    @extend_schema(summary="Approve a batch (approver must differ from preparer)", request=None)
    def approve(self, request: Request, pk: str) -> Response:
        count = services.approve_batch(batch_id=uuid.UUID(pk), actor_id=request.user.pk)
        return ActionResponse.ok({"updated": count}, message="Batch approved.")

    @extend_schema(summary="Send a batch back to draft", request=None)
    def reject(self, request: Request, pk: str) -> Response:
        count = services.reject_batch(batch_id=uuid.UUID(pk), actor_id=request.user.pk)
        return ActionResponse.ok({"updated": count}, message="Batch returned to draft.")

    @extend_schema(summary="Revert a batch before downstream activity exists", request=None)
    def revert(self, request: Request, pk: str) -> Response:
        count = services.revert_batch(batch_id=uuid.UUID(pk), actor_id=request.user.pk)
        return ActionResponse.ok({"updated": count}, message="Batch reverted.")

    @extend_schema(
        summary="Execute an approved batch, creating next-session enrollments",
        request=None,
        responses={200: OpenApiResponse(description="Per-student execution report.")},
    )
    def execute(self, request: Request, pk: str) -> Response:
        batch_id = uuid.UUID(pk)

        def run() -> Response:
            report = services.execute_batch(
                batch_id=batch_id, tenant_id=request.tenant.pk, actor_id=request.user.pk
            )
            return ActionResponse.ok(report, message="Batch executed.")

        # §11: "re-execution attempts are no-ops". The Idempotency-Key replays a
        # client retry within 24h; the service's own per-row `executed` skip is
        # what makes a re-run safe after that window too.
        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="student-promotions:execute",
            execute=run,
        )
