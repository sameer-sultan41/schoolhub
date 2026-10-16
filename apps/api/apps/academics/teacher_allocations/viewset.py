"""`TeacherAllocationViewSet` — request handling for `/teacher-subject-allocations`.

`FEATURE` is imported from the module root's `views.py`, shared by every
viewset across the module's resource packages.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from django.db.models import F
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

if TYPE_CHECKING:
    from rest_framework.request import Request

from apps.academics.models import TeacherSubjectAllocation
from apps.academics.teacher_allocations import services
from apps.academics.teacher_allocations.filters import TeacherAllocationFilterSet
from apps.academics.teacher_allocations.serializers import (
    LoadSummaryQuerySerializer,
    TeacherAllocationSerializer,
    TeacherLoadRowSerializer,
)
from apps.academics.views import FEATURE
from apps.school_organization.models import AcademicSession
from core.api.exceptions import DomainRuleViolation
from core.api.pagination import PageNumberPagination
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.rbac.permissions import DenyRestrictedPrincipals, HasPermissionKey


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
    search_fields = ["staff__first_name", "staff__last_name", "subject__name", "section__name"]
    # Everything the dashboard's allocation table renders.
    # `section_name`/`subject_name`/`staff_last_name` are the annotations from
    # `get_queryset`, never `section__name` and friends — and this is the viewset
    # where that matters most: `filter_owned_by_user` below is the `own` scope a
    # teacher gets, so a `__` here would sort fine for an admin and, the moment
    # that hook is narrowed with a `.distinct()` (the shape
    # `Student.filter_owned_by_user` already has), raise ProgrammingError for
    # every teacher. An annotation is in the select list, so DISTINCT cannot
    # reject it.
    # Index-backed: only `created_at` (its own index). tsa_tenant_staff_idx leads
    # with (tenant, staff, academic_session) and tsa_section_subject_idx with
    # (tenant, section, subject); neither orders by a name on the joined table.
    # Table scans: `is_primary` (tsa_one_primary_per_section_subject indexes only
    # the current primaries, not the ordering of everything else),
    # `weekly_periods`, `effective_from` and `effective_to` — all unindexed and
    # all nullable, so allocations with no override or no end date sort last
    # ascending and first descending — plus the three annotated names, each a
    # sort over a join.
    ordering_fields = [
        "is_primary",
        "weekly_periods",
        "effective_from",
        "effective_to",
        "section_name",
        "subject_name",
        "staff_last_name",
        "created_at",
    ]
    #: Entries in ordering_fields that are annotations from get_queryset, not model
    #: fields — tests/test_endpoint_contracts.py cannot resolve these against the model.
    ordering_annotations = ("section_name", "subject_name", "staff_last_name")
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
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
        # select_related keeps the list off a session/section/subject/staff fetch
        # per row; the annotations are what `?ordering=section_name`,
        # `subject_name` and `staff_last_name` sort on, over those same joins.
        return (
            super()
            .get_queryset()
            .select_related(
                "academic_session", "section", "section__school_class", "subject", "staff"
            )
            .annotate(
                section_name=F("section__name"),
                subject_name=F("subject__name"),
                staff_last_name=F("staff__last_name"),
            )
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
        # A bare Response, not ActionResponse.ok: that helper wraps its argument
        # in {"data": ...}, so handing it an already-enveloped payload nests the
        # envelope twice. EnvelopeJSONRenderer passes a pre-shaped
        # {"data", "meta"} dict through untouched and injects request_id.
        return Response({"data": body, "meta": {"warnings": warnings}}, status=201)

    def update(self, request: Request, *args, **kwargs) -> Response:
        """PATCH through the §11 rules (the generic mixin saved straight through)."""
        instance = self.get_object()
        serializer = self.get_serializer(
            instance, data=request.data, partial=kwargs.pop("partial", False)
        )
        serializer.is_valid(raise_exception=True)
        changes = serializer.validated_data

        before = self.get_serializer(instance).data
        previous_staff_id = instance.staff_id
        allocation = services.update_allocation(
            allocation=instance, changes=changes, actor_id=request.user.pk
        )
        body = self.get_serializer(allocation).data
        record_audit(request, "update", allocation, before=before, after=body)
        if allocation.staff_id != previous_staff_id:
            services.notify_allocation_changed(allocation=allocation, tenant_id=request.tenant.pk)

        warnings = services.load_warnings(
            staff=allocation.staff, session=allocation.academic_session
        )
        return Response({"data": body, "meta": {"warnings": warnings}})

    def perform_destroy(self, instance) -> None:
        """A closed session's allocations are history, not editable state (§11)."""
        services.assert_allocation_deletable(instance)
        super().perform_destroy(instance)

    @extend_schema(
        summary="Per-teacher weekly load against the tenant norm",
        parameters=[OpenApiParameter("academic_session_id", OpenApiTypes.UUID, required=True)],
        responses={200: TeacherLoadRowSerializer(many=True)},
    )
    def load_summary(self, request: Request) -> Response:
        query = LoadSummaryQuerySerializer(data=request.query_params)
        if not query.is_valid():
            # 422, as a missing id always was here, not `raise_exception`'s 400.
            raise DomainRuleViolation(query.errors)

        session = get_object_or_404(
            AcademicSession.objects.alive(), pk=query.validated_data["academic_session_id"]
        )
        totals = services.weekly_load_by_staff(session=session)

        # The scoped queryset, not a fresh one: a teacher with `own` scope sees
        # only their own row here, exactly as they do in the list.
        rows = (
            self.get_queryset()
            .filter(academic_session=session, effective_to__isnull=True)
            .select_related("staff")
        )

        by_staff: dict[uuid.UUID, dict] = {}
        for allocation in rows:
            load = totals.get(allocation.staff_id, 0)
            entry = by_staff.setdefault(
                allocation.staff_id,
                {
                    "staff_id": allocation.staff_id,
                    "name": f"{allocation.staff.first_name} {allocation.staff.last_name}",
                    "weekly_periods": load,
                    "allocations": 0,
                    "norm": services.DEFAULT_WEEKLY_PERIOD_NORM,
                    "over_norm": load > services.DEFAULT_WEEKLY_PERIOD_NORM,
                },
            )
            entry["allocations"] += 1

        ordered = sorted(by_staff.values(), key=lambda e: e["name"])
        return ActionResponse.ok(TeacherLoadRowSerializer(ordered, many=True).data)
