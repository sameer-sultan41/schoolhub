"""`TeacherAllocationViewSet` — request handling for `/teacher-subject-allocations`.

`FEATURE` is imported from the module root's `views.py`, shared by every
viewset across the module's resource packages.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db.models import F
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

if TYPE_CHECKING:
    from rest_framework.request import Request

from apps.academics.models import TeacherSubjectAllocation
from apps.academics.teacher_allocations import services
from apps.academics.teacher_allocations.filters import TeacherAllocationFilterSet
from apps.academics.teacher_allocations.serializers import TeacherAllocationSerializer
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
            .select_related("academic_session", "section", "subject", "staff")
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
