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
header says why), and so did `BlockingDestroyMixin`, imported below: the mixin
is a thin wrapper over `school_organization.services.assert_deletable`, which
walks the model's own related objects, so it belongs beside the model rather
than being copied to follow the route.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from django.db import transaction
from django.db.models import Count, F, Min
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.filters import OrderingFilter as DRFOrderingFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.settings import api_settings

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
    PromotionBatchSerializer,
    PromotionDecisionSerializer,
    TeacherAllocationSerializer,
)
from apps.academics.tasks import execute_promotion_batch_task
from apps.school_organization.models import AcademicSession, ClassSubject
from apps.school_organization.services import map_subject_to_class
from apps.school_organization.views import BlockingDestroyMixin
from core.api.exceptions import Conflict, DomainRuleViolation
from core.api.filters import StableOrderingFilter
from core.api.pagination import PageNumberPagination
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.idempotency.services import replay_or_execute
from core.jobs.services import attach_celery_task_id, create_job
from core.rbac.permissions import DenyRestrictedPrincipals, HasPermissionKey

FEATURE = "module.academics"


class CurriculumViewSet(BlockingDestroyMixin, viewsets.ModelViewSet):
    """`class_subjects` — the session curriculum grid (§5.1)."""

    # `class_subjects.campus_id` is nullable and means "applies to every campus"
    # — the shared curriculum row every campus teaches. `IN (...)` drops NULL, so
    # without this a campus-scoped principal silently loses exactly those rows.
    # Carried over from `school_organization.ClassSubjectViewSet` with the
    # endpoint; the fix landed on main while this move was in flight.
    scope_campus_allows_null = True
    queryset = ClassSubject.objects
    serializer_class = CurriculumSerializer
    filterset_class = CurriculumFilterSet
    search_fields = ["elective_group", "notes"]
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    # Everything the dashboard's curriculum grid renders.
    # `session_name`/`class_name`/`subject_name`/`campus_name` are the
    # annotations from `get_queryset`, never `academic_session__name` and
    # friends: `scope_queryset` hands an OWN/ASSIGNED principal a `.distinct()`
    # queryset, and Postgres rejects `SELECT DISTINCT` ordered by a joined column
    # that is not in the select list. An annotation is in the select list, so it
    # sorts for every principal instead of 500-ing for some.
    # Index-backed: only `created_at` (its own index). class_subjects_session_idx
    # leads with (tenant, academic_session, school_class) and
    # class_subjects_subject_idx with (tenant, subject), and neither can order by
    # a *name* that lives on the other table anyway.
    # Table scans: `weekly_periods`, `is_elective` and `elective_group` (nothing
    # indexes any of them; `elective_group` is nullable, so non-elective rows sort
    # last ascending), plus the four annotated names, each a sort over a join —
    # `campus_name` over a left join, since `campus_id` NULL means "every campus".
    # Allowed because one session's grid is hundreds of rows, not millions.
    ordering_fields = [
        "weekly_periods",
        "is_elective",
        "elective_group",
        "session_name",
        "class_name",
        "subject_name",
        "campus_name",
        "created_at",
    ]
    #: Entries in ordering_fields that are annotations from get_queryset, not model
    #: fields — tests/test_endpoint_contracts.py cannot resolve these against the model.
    ordering_annotations = ("session_name", "class_name", "subject_name", "campus_name")
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
        # select_related keeps the list off a session/class/subject/campus fetch
        # per row; the annotations are what `?ordering=<...>_name` sorts on, and
        # they reuse those same joins rather than adding their own.
        return (
            super()
            .get_queryset()
            .select_related("academic_session", "school_class", "subject", "campus")
            .annotate(
                session_name=F("academic_session__name"),
                class_name=F("school_class__name"),
                subject_name=F("subject__name"),
                campus_name=F("campus__name"),
            )
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

    def perform_update(self, serializer) -> None:
        """The same §11 elective rule the delete path has, for the edit path.

        A PATCH can take a row out of a group just as surely as a DELETE can —
        by renaming its `elective_group`, or by moving the row to another class
        or session — and the group it leaves behind shrinks either way.

        Not in `CurriculumSerializer.validate()`: the rule is about the state the
        *old* group is left in, which needs the row's identity and its siblings
        rather than the payload, and a serializer that reached out for both would
        be doing the viewset's job. Raising here rolls the update back, since
        `ATOMIC_REQUESTS` puts the whole request in one transaction.
        """
        instance = serializer.instance
        data = serializer.validated_data
        moved_out_of = (
            instance.academic_session_id,
            instance.school_class_id,
            instance.elective_group,
        ) != (
            data.get("academic_session", instance.academic_session).pk,
            data.get("school_class", instance.school_class).pk,
            data.get("elective_group", instance.elective_group),
        )
        if instance.elective_group and moved_out_of:
            services.assert_elective_group_has_options(
                session=instance.academic_session,
                school_class=instance.school_class,
                elective_group=instance.elective_group,
                exclude_pk=instance.pk,
            )
        super().perform_update(serializer)

    def perform_destroy(self, instance) -> None:
        """An elective group must not be left with a single option (§11)."""
        if instance.elective_group:
            services.assert_elective_group_has_options(
                session=instance.academic_session,
                school_class=instance.school_class,
                elective_group=instance.elective_group,
                exclude_pk=instance.pk,
            )
        # Through `BlockingDestroyMixin`, which the move from school_organization
        # dropped along with its `assert_deletable` check. The base
        # `perform_destroy` is a *soft* delete, so the PROTECT foreign keys never
        # fire as a backstop and a curriculum row would simply vanish from under
        # its dependents. Nothing points at `class_subjects` yet, which is exactly
        # why the check has to be back before the first module that does.
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


class AggregateOrderingFilter(StableOrderingFilter):
    """`StableOrderingFilter` with a GROUP BY-safe tiebreaker, for the batch list.

    The global backend appends `pk` to every ordering so that a page boundary is
    never ambiguous. That is right for a queryset of rows and wrong for a queryset
    of *groups*, and the way it is wrong is silent rather than loud.

    `PromotionBatchViewSet.get_queryset` is a
    `.values(...).annotate(Count, Min)` aggregate, and Django adds any `order_by`
    column that is not already selected to the GROUP BY — documented under
    `values()`, and visible in `SQLCompiler.get_group_by`, which extends the
    grouping with every non-`Ref` ordering expression. `student_promotions.id` is
    not in the `values()` set, so `?ordering=status` would group by the primary
    key; Postgres advertises `allows_group_by_selected_pks`, so Django's
    `collapse_group_by` then drops every other column from the GROUP BY as
    functionally dependent on it. Nothing raises. The response is a 200 and the
    batch list quietly becomes one row per *student*, each reporting
    `students: 1` and its own `created_at` as `started_at`.

    So the tiebreaker here is `batch_id`, which identifies a batch and is already
    in the `values()` set — ordering by it adds nothing to the GROUP BY that the
    grouping did not already contain. It is total in every case that is not
    itself corrupt: a batch splits into two rows only if its own status ever
    diverges, which `PromotionBatchSerializer` documents as the honest rendering
    of a broken batch rather than something to hide behind a chosen winner.

    An allowlist entry that is an annotation is also dropped for a queryset that
    does not carry it — see `get_ordering` for the one route where that happens.
    """

    def get_ordering(self, request, queryset, view):
        # `DRFOrderingFilter`, not `super()`: the base's validation of the request
        # against `ordering_fields` is wanted, only the `pk` append is not.
        ordering = DRFOrderingFilter.get_ordering(self, request, queryset, view)
        if not ordering:
            # No `?ordering=`: `get_queryset`'s own `-started_at` stands.
            return ordering

        # `PromotionBatchViewSet.retrieve` runs this same backend over the *row*
        # queryset, which has no `students`/`started_at` on it — `order_by` on a
        # name a queryset cannot resolve raises FieldError, which is a 500 off a
        # query parameter. Drop what is not there, the same way the base drops a
        # field that is not on the allowlist.
        annotated = set(getattr(view, "ordering_annotations", ()) or ())
        present = set(queryset.query.annotations)
        ordering = [
            field
            for field in ordering
            if field.lstrip("-") not in annotated or field.lstrip("-") in present
        ]
        if not ordering:
            return ordering

        if any(field.lstrip("-") == "batch_id" for field in ordering):
            return ordering

        return [*ordering, "batch_id"]


class PromotionBatchViewSet(
    TenantScopedViewSetMixin, mixins.ListModelMixin, viewsets.GenericViewSet
):
    """`/student-promotions` — the batch resource (§16).

    Every `{id}` on this prefix is a **batch id**. That was not true before: GET
    and PATCH resolved a decision-row id while the colon-actions resolved a batch
    id, so one path prefix carried two id spaces and a client could not tell
    which it held. Decisions are now a sub-resource keyed by student, which is
    also the shape §16 describes.

    A batch has no table — it is aggregated from its rows (see
    `PromotionBatchSerializer`), so this list is read-only and `create` is the
    dedicated `create_batch` handler below.
    """

    permission_classes = [
        IsAuthenticated,
        RequiresModuleFeature,
        HasPermissionKey,
        DenyRestrictedPrincipals,
    ]
    queryset = StudentPromotion.objects
    serializer_class = PromotionBatchSerializer
    filterset_class = PromotionFilterSet
    # Offset pagination, allowed by api-architecture.md §2.4 "on small admin
    # lists": a tenant creates roughly one batch per class per rollover, and a
    # cursor cannot order a `values()` aggregate by the `-created_at` the default
    # paginator wants anyway.
    pagination_class = PageNumberPagination
    # The project default with its `pk` tiebreaker swapped for a group-safe one —
    # see AggregateOrderingFilter for what `ORDER BY id` does to this aggregate.
    # Derived from the setting rather than retyped so a future change to
    # DEFAULT_FILTER_BACKENDS reaches this list too.
    filter_backends = [
        AggregateOrderingFilter if backend is StableOrderingFilter else backend
        for backend in api_settings.DEFAULT_FILTER_BACKENDS
    ]
    # This endpoint declared no allowlist at all, so DRF fell back to every
    # serializer field — including `students` and `started_at`, and the sort that
    # produced was worse than slow (see AggregateOrderingFilter).
    #
    # Only columns the aggregate can actually order by belong here: a member of
    # the `values()` set, or one of the annotations below. Anything else — a bare
    # `created_at`, say — joins the GROUP BY and silently un-groups the list, which
    # is why `created_at` is absent here while every other list in this file has it.
    #
    # `status` is grouped on already, so ordering by it costs only the sort.
    # `students` (Count) and `started_at` (Min) are post-aggregation expressions:
    # Postgres has to build every group before it can order them, so no index can
    # ever serve these two. They are declared anyway because they are the columns
    # the dashboard's batch table is read by, and the set being sorted is roughly
    # one row per class per rollover.
    ordering_fields = ["status", "students", "started_at"]
    #: Entries in ordering_fields that are annotations from get_queryset, not model
    #: fields — tests/test_endpoint_contracts.py cannot resolve these against the model.
    ordering_annotations = ("students", "started_at")
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "academics.promotion.view"
    required_permission_map = {
        "create_batch": "academics.promotion.create",
        "submit": "academics.promotion.update",
        "approve": "academics.promotion.approve",
        "reject": "academics.promotion.approve",
        "execute": "academics.promotion.execute",
        "revert": "academics.promotion.update",
    }
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        """One row per batch, aggregated. Two queries, never one per batch.

        The trailing `-started_at` is the list's default order and stays that way:
        with no `?ordering=` the filter backend returns nothing and leaves this
        `order_by` alone. `students` and `started_at` are the annotations
        `ordering_fields` above exposes.
        """
        return (
            super()
            .get_queryset()
            .values(
                "batch_id",
                "from_academic_session_id",
                "to_academic_session_id",
                "from_class_id",
                "status",
            )
            .annotate(students=Count("id"), started_at=Min("created_at"))
            .order_by("-started_at")
        )

    @extend_schema(
        summary="One batch and every decision in it",
        responses={200: OpenApiResponse(description="The batch plus its per-student rows.")},
    )
    def retrieve(self, request: Request, pk: str) -> Response:
        batch_id = _batch_uuid(pk)
        rows = list(
            self.filter_queryset(super().get_queryset())
            .filter(batch_id=batch_id)
            .select_related("student", "from_class", "to_class")
        )
        if not rows:
            raise Http404("No such promotion batch.")

        summary = {
            "batch_id": str(batch_id),
            "from_academic_session_id": str(rows[0].from_academic_session_id),
            "to_academic_session_id": str(rows[0].to_academic_session_id),
            "from_class_id": str(rows[0].from_class_id),
            "status": rows[0].status,
            "students": len(rows),
            "started_at": min(row.created_at for row in rows),
        }
        return ActionResponse.ok(
            {
                **PromotionBatchSerializer(summary).data,
                "decisions": PromotionDecisionSerializer(rows, many=True).data,
            }
        )

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
        count = services.submit_batch(batch_id=_batch_uuid(pk), actor_id=request.user.pk)
        return ActionResponse.ok({"updated": count}, message="Batch submitted for approval.")

    @extend_schema(summary="Approve a batch (approver must differ from preparer)", request=None)
    def approve(self, request: Request, pk: str) -> Response:
        count = services.approve_batch(batch_id=_batch_uuid(pk), actor_id=request.user.pk)
        return ActionResponse.ok({"updated": count}, message="Batch approved.")

    @extend_schema(summary="Send a batch back to draft", request=None)
    def reject(self, request: Request, pk: str) -> Response:
        count = services.reject_batch(batch_id=_batch_uuid(pk), actor_id=request.user.pk)
        return ActionResponse.ok({"updated": count}, message="Batch returned to draft.")

    @extend_schema(summary="Revert a batch before downstream activity exists", request=None)
    def revert(self, request: Request, pk: str) -> Response:
        count = services.revert_batch(batch_id=_batch_uuid(pk), actor_id=request.user.pk)
        return ActionResponse.ok({"updated": count}, message="Batch reverted.")

    @extend_schema(
        summary="Execute an approved batch, creating next-session enrollments",
        request=None,
        responses={
            202: OpenApiResponse(
                description=(
                    "{'data': {'job_id': str, 'status': 'queued'}}. Poll GET /jobs/{id}; "
                    "the per-student execution report is the finished job's `result`."
                )
            )
        },
    )
    def execute(self, request: Request, pk: str) -> Response:
        # `202` + a job, which is what §7.2 always specified and what shipping
        # this synchronously deferred. Running it in the request was not merely
        # slow: `execute_batch` commits each student separately on purpose, and
        # `ATOMIC_REQUESTS` makes that impossible — the per-student
        # `tenant_atomic` degrades to a savepoint, so a class of hundreds holds
        # every row lock it takes until the response is rendered, and shows the
        # caller nothing until then. On a worker the helper means what it says.
        batch_id = _batch_uuid(pk)
        # Before the job, not inside it: a draft batch is refused at request time
        # so the caller keeps the 409 rather than getting a job that fails out of
        # band. `execute_batch` checks again on the worker.
        services.assert_batch_executable(batch_id=batch_id)

        def run() -> Response:
            job = create_job(
                tenant_id=request.tenant.pk,
                job_type="promotion.execute",
                payload={"batch_id": str(batch_id)},
                actor_id=request.user.pk,
            )
            result = execute_promotion_batch_task.delay(
                tenant_id=str(request.tenant.pk),
                job_id=str(job.pk),
                actor_id=str(request.user.pk),
            )
            attach_celery_task_id(job=job, celery_task_id=result.id)
            record_audit(
                request, "execute", job, after={"job_id": str(job.pk), "batch_id": str(batch_id)}
            )
            return ActionResponse.accepted(str(job.pk), message="Batch execution queued.")

        # §11: "re-execution attempts are no-ops". The Idempotency-Key now
        # replays the *job id* for a client retry within 24h, so a retried
        # request rejoins the run already in flight instead of queueing a second
        # one; the service's own per-row `executed` skip is what makes a re-run
        # safe after that window too.
        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="student-promotions:execute",
            execute=run,
        )


class PromotionDecisionViewSet(
    TenantScopedViewSetMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet
):
    """`/student-promotions/{batch_id}/decisions/{student_id}` — §16's shape.

    Addressed by *student* rather than by row id, because that is what a reviewer
    working through a class actually has in hand, and it makes the URL say which
    batch the edit belongs to instead of leaving it implicit in an opaque id.
    """

    permission_classes = [
        IsAuthenticated,
        RequiresModuleFeature,
        HasPermissionKey,
        DenyRestrictedPrincipals,
    ]
    queryset = StudentPromotion.objects
    serializer_class = PromotionDecisionSerializer
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "academics.promotion.view"
    required_permission_map = {
        "update": "academics.promotion.update",
        "partial_update": "academics.promotion.update",
    }
    http_method_names = ["patch", "head", "options"]

    def get_object(self) -> StudentPromotion:
        """Read under a row lock — every request this viewset serves is a write.

        `http_method_names` is `patch` only, so there is no read path here whose
        latency the lock costs, and taking it is what turns the `status` check in
        `update` from a guess into a decision: `:submit` locks every row of the
        batch (`services.assert_batch_in_status`), so a submit racing this edit
        either lands first and is seen, or waits behind it.

        `of=("self",)` because a campus-scoped user's queryset joins `students`
        to reach `scope_campus_field`, and a bare `FOR UPDATE` would lock that
        student's row too — blocking edits to the student record for the length
        of a promotion PATCH, which nothing here needs.
        """
        instance = get_object_or_404(
            self.filter_queryset(self.get_queryset()).select_for_update(of=("self",)),
            batch_id=_batch_uuid(self.kwargs["batch_pk"]),
            student_id=self.kwargs["student_pk"],
        )
        self.check_object_permissions(self.request, instance)
        return instance

    @transaction.atomic
    def update(self, request: Request, *args, **kwargs) -> Response:
        """Only a draft row is editable — everything after submit is under review.

        Explicitly atomic rather than leaning on `ATOMIC_REQUESTS`: the lock
        `get_object` takes is only a lock inside a transaction, and a settings
        change that turned request-level atomicity off would otherwise make
        `select_for_update` an error rather than a silent no-op — but it would
        make it one here, at the exact line whose correctness depends on it.
        """
        instance = self.get_object()
        if instance.status != PromotionStatus.DRAFT:
            raise Conflict(f"This decision is {instance.status} and can no longer be edited.")
        return super().update(request, *args, **kwargs)

    def perform_update(self, serializer) -> None:
        """Restate `draft` in the UPDATE's own WHERE, the way `_transition` does.

        Not redundant with the check above for the reason that function's
        docstring gives: the lock is what prevents the interleaving, and this is
        what keeps the write safe if a later refactor drops the lock. Django's
        `Model.save()` cannot express a precondition — it writes by primary key
        and nothing else — so the write goes through the queryset instead, and
        the instance is re-read afterwards because `serializer.data` renders from
        it and would otherwise echo the values as they were before the UPDATE.
        """
        before = self.get_serializer(serializer.instance).data
        updated = (
            StudentPromotion.objects.alive()
            .filter(pk=serializer.instance.pk, status=PromotionStatus.DRAFT)
            .update(
                updated_by=self.request.user.pk,
                updated_at=timezone.now(),
                **serializer.validated_data,
            )
        )
        if not updated:
            raise Conflict(
                "This decision changed while the edit was running. Reload and try again."
            )
        serializer.instance.refresh_from_db()
        record_audit(
            self.request, "update", serializer.instance, before=before, after=serializer.data
        )


def _batch_uuid(value: str) -> uuid.UUID:
    """A malformed batch id is a 404, not a 500.

    Colon-action routes capture `<uuid:pk>` so Django rejects a malformed value
    before this runs, but `retrieve` and the nested decision route take the same
    id from paths that are reachable with anything.
    """
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise Http404("No such promotion batch.") from exc
