"""`PromotionBatchViewSet` and `PromotionDecisionViewSet` — `/student-promotions`.

`FEATURE` is imported from the module root's `views.py`, shared by every
viewset in every one of this module's resource packages — see that file's own
docstring.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from django.db import transaction
from django.db.models import Count, Min
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

from apps.academics.models import PromotionStatus, StudentPromotion
from apps.academics.promotions import services
from apps.academics.promotions.filters import PromotionFilterSet
from apps.academics.promotions.serializers import (
    CreatePromotionBatchSerializer,
    PromotionBatchSerializer,
    PromotionDecisionSerializer,
)
from apps.academics.tasks import execute_promotion_batch_task
from apps.academics.views import FEATURE
from core.api.exceptions import Conflict
from core.api.filters import StableOrderingFilter
from core.api.pagination import PageNumberPagination
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.idempotency.services import replay_or_execute
from core.jobs.services import attach_celery_task_id, create_job
from core.rbac.permissions import DenyRestrictedPrincipals, HasPermissionKey


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
