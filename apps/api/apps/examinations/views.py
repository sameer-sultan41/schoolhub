"""HTTP layer for the examinations module.

Thin by design: every rule that needs more than the request body lives in
`services`, so the API, the result-processing job and the marks importer all
apply the same checks.

**Two viewsets are portal-readable, and both use `get_permissions`.** §3 gives
a `student`/`guardian` a view of exam schedules and admit cards, so
`ExamScheduleViewSet` and `AdmitCardViewSet` drop `DenyRestrictedPrincipals`
**for reads only** and let the record scope narrow them, through each model's
`filter_owned_by_user`.

Their write actions keep the guard, and it has to be `get_permissions` rather
than a class attribute because **DRF resolves `permission_classes` per view, not
per action**. That is PR #42's privilege-escalation finding — a viewset-wide
portal exemption on `student_attendance` covered `:bulk-mark` too — and it
generalises exactly here: scheduling a sitting or issuing a hall's worth of
cards is not a scoped read of one child's row.

Nor can the service check close it alone. `assert_exam_is_issuable` objects to
the *exam's state*, not to who is asking, so a restricted principal holding
`exams.admit-card.issue` would pass it. The principal check has to sit in front.

**`scope_campus_field = None` on all three.** An exam, a grading scale and a
subject configuration are school-wide: an exam is set for Grade 8, not for Grade
8 at the north campus, and `exam_schedules` is where a sitting acquires a room
and therefore a campus. Left at the mixin's `campus_id` default, every
campus-scoped caller would get a `FieldError` on a column that does not exist —
the bug `LeaveTypeViewSet` documents.

**Grade bands are a nested collection, not a top-level one.** §16 declares
`/grading-scales/{id}/grade-bands`, and the nesting is load-bearing: a band is
meaningless apart from its scale, and `assert_scale_is_complete` reasons about a
scale's whole set, so the scale has to be in the URL rather than in the body.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.examinations import conflicts, services, tasks
from apps.examinations.filters import (
    AdmitCardFilterSet,
    ExamFilterSet,
    ExamScheduleFilterSet,
    ExamSubjectFilterSet,
    GradingScaleFilterSet,
)
from apps.examinations.models import (
    AdmitCard,
    Exam,
    ExamSchedule,
    ExamSubject,
    GradeBand,
    GradingScale,
)
from apps.examinations.serializers import (
    AdmitCardRevokeSerializer,
    AdmitCardSerializer,
    ExamScheduleSerializer,
    ExamSerializer,
    ExamSubjectSerializer,
    GradeBandSerializer,
    GradingScaleSerializer,
)
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.idempotency.services import replay_or_execute
from core.jobs.services import create_job
from core.rbac.permissions import DenyRestrictedPrincipals, HasPermissionKey

if TYPE_CHECKING:
    from rest_framework.request import Request

FEATURE = "module.examinations"

STAFF_PERMISSIONS = [
    IsAuthenticated,
    RequiresModuleFeature,
    HasPermissionKey,
    DenyRestrictedPrincipals,
]

# Students and guardians reach the two viewsets that use this, and only for
# reads. The record scope, not the permission class, is what narrows them.
PORTAL_READABLE_PERMISSIONS = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]


class GradingScaleViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/grading-scales` — §5.5's tenant grading models."""

    permission_classes = STAFF_PERMISSIONS
    queryset = GradingScale.objects
    serializer_class = GradingScaleSerializer
    filterset_class = GradingScaleFilterSet
    search_fields = ["name", "description"]
    ordering_fields = ["name", "created_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "exams.grading-scale.view"
    required_permission_map = {
        "create": "exams.grading-scale.create",
        "update": "exams.grading-scale.update",
        "partial_update": "exams.grading-scale.update",
        "destroy": "exams.grading-scale.update",
        "set_default": "exams.grading-scale.update",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        # `bands` is nested on the serializer, so without this every scale in a
        # list costs a query for its bands — an N+1 over the one resource a
        # client fetches on every results screen.
        return super().get_queryset().prefetch_related("bands")

    @extend_schema(request=None, responses={200: GradingScaleSerializer})
    def set_default(self, request: Request, pk: str | None = None):
        """`POST /grading-scales/{id}:set-default`.

        A colon-action rather than `PATCH {"is_default": true}` because it is
        two writes: `grading_scales_one_default` refuses two live defaults, so
        the outgoing scale has to be cleared in the same transaction. A PATCH
        would 409 against whichever scale currently holds it, which describes
        the constraint rather than the caller's intent.
        """
        scale = get_object_or_404(self.get_queryset(), pk=pk)
        before = {"is_default": scale.is_default}

        services.set_default_scale(scale=scale, actor_id=request.user.pk)

        record_audit(request, "update", scale, before=before, after={"is_default": True})
        return ActionResponse.ok(
            GradingScaleSerializer(scale).data,
            message=f"{scale.name} is now this school's default grading scale.",
        )


class GradeBandViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/grading-scales/{scale_id}/grade-bands` — §5.5's bands.

    The scale comes from the URL. Writes deliberately do **not** run
    `assert_scale_is_complete`: a scale is built one band at a time, and every
    intermediate state fails that rule — the first band inserted covers 0-49
    and nothing else. Completeness is checked where it matters, when an exam
    attaches the scale (`services.assert_scale_usable`).
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = GradeBand.objects
    serializer_class = GradeBandSerializer
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "exams.grading-scale.view"
    required_permission_map = {
        "create": "exams.grading-scale.create",
        "update": "exams.grading-scale.update",
        "partial_update": "exams.grading-scale.update",
        "destroy": "exams.grading-scale.update",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    ordering_fields = ["sort_order", "min_percent"]

    def get_scale(self) -> GradingScale:
        """The scale named in the URL, 404 if it is not this tenant's.

        Resolved through the tenant-scoped manager, so a foreign scale id is a
        404 and never a 403 — a 403 would confirm the scale exists (AGENTS.md
        invariant 2).
        """
        return get_object_or_404(GradingScale.objects.alive(), pk=self.kwargs["scale_pk"])

    def get_queryset(self):
        return super().get_queryset().filter(grading_scale=self.get_scale())

    def perform_create(self, serializer) -> None:
        """Stamp the scale from the URL, then let the mixin stamp and audit.

        The scale is passed here rather than validated out of the body because
        the URL is the only place it appears: a band posted to one scale's
        collection while naming another in its payload is a request with two
        answers, and this shape means there is only ever one.
        """
        instance = serializer.save(
            tenant=self.request.tenant,
            grading_scale=self.get_scale(),
            created_by=self.request.user.pk,
            updated_by=self.request.user.pk,
        )
        record_audit(self.request, "create", instance, after=serializer.data)


class ExamViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/exams` — §5.1's examination events.

    `status` is read-only on the serializer: §7.1's transitions are separate,
    permission-gated, audited actions, and a client that could PATCH the column
    could publish results without passing the approval gate.
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = Exam.objects
    serializer_class = ExamSerializer
    filterset_class = ExamFilterSet
    search_fields = ["name", "description"]
    ordering_fields = ["starts_on", "name", "created_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "exams.exam.view"
    required_permission_map = {
        "create": "exams.exam.create",
        "update": "exams.exam.update",
        "partial_update": "exams.exam.update",
        "destroy": "exams.exam.delete",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().select_related("academic_session", "term", "grading_scale")

    def perform_update(self, serializer) -> None:
        services.assert_exam_is_configurable(serializer.instance)
        super().perform_update(serializer)

    def perform_destroy(self, instance) -> None:
        services.assert_exam_is_deletable(instance)
        super().perform_destroy(instance)


class ExamSubjectViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/exam-subjects` — §5.1's per-class marks structure."""

    permission_classes = STAFF_PERMISSIONS
    queryset = ExamSubject.objects
    serializer_class = ExamSubjectSerializer
    filterset_class = ExamSubjectFilterSet
    ordering_fields = ["created_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "exams.exam.view"
    required_permission_map = {
        "create": "exams.exam.update",
        "update": "exams.exam.update",
        "partial_update": "exams.exam.update",
        "destroy": "exams.exam.update",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().select_related("exam", "school_class", "subject")

    def perform_update(self, serializer) -> None:
        services.assert_exam_is_configurable(serializer.instance.exam)
        super().perform_update(serializer)

    def perform_destroy(self, instance) -> None:
        services.assert_exam_is_configurable(instance.exam)
        super().perform_destroy(instance)


class ExamScheduleViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/exam-schedules` — §5.2's sittings.

    **`meta.conflicts` on every write.** A schedule mid-build is allowed to be
    imperfect: §8's exam-staff journey is "resolves the two room clashes the
    checker flags", which requires the clashing state to be storable and the
    whole list to come back at once. `:publish-schedule` is where hard clashes
    become blocking — the same division `timetable`'s draft grid and its
    `:publish` already draw.

    Portal-readable for reads only; see the module docstring.
    """

    permission_classes = PORTAL_READABLE_PERMISSIONS
    queryset = ExamSchedule.objects
    serializer_class = ExamScheduleSerializer
    filterset_class = ExamScheduleFilterSet
    ordering_fields = ["exam_date", "start_time"]
    # `own` is a join through enrollments and the guardian link, not a column
    # here — the model hook owns it and takes precedence over this fallback,
    # which is left None so a mistaken single-column reading cannot apply.
    scope_own_field = None
    scope_campus_field = "section__campus_id"
    required_feature = FEATURE
    required_permission = "exams.schedule.view"
    required_permission_map = {
        "create": "exams.schedule.create",
        "update": "exams.schedule.update",
        "partial_update": "exams.schedule.update",
        "destroy": "exams.schedule.update",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    STAFF_ONLY_ACTIONS = frozenset({"create", "update", "partial_update", "destroy"})

    def get_permissions(self):
        """Add `DenyRestrictedPrincipals` to the write actions only.

        DRF resolves `permission_classes` per view, not per action, so a viewset
        serving both a portal read and a staff write has to choose here. See the
        module docstring for why the service check cannot close this alone.
        """
        if self.action in self.STAFF_ONLY_ACTIONS:
            return [permission() for permission in STAFF_PERMISSIONS]
        return super().get_permissions()

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .select_related("exam_subject__exam", "exam_subject__subject", "section", "room")
        )

    def _conflict_meta(self, schedule: ExamSchedule) -> dict:
        """§5.2's clash list, for the exam the edited sitting belongs to.

        Exam-scoped rather than sitting-scoped: a room or invigilator clash is
        by definition with some *other* sitting, and a caller editing one cell
        needs the whole list to act on — §8's journey is "resolves the two room
        clashes the checker flags", plural.
        """
        return {"conflicts": conflicts.detect_conflicts(exam=schedule.exam_subject.exam)}

    def create(self, request: Request, *args, **kwargs):
        """201 with `meta.conflicts` — a clash list, not a refusal."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)

        # A bare Response, not ActionResponse.ok: that helper wraps its argument
        # in {"data": ...}, so an already-enveloped payload nests twice.
        # EnvelopeJSONRenderer passes a pre-shaped {"data", "meta"} through and
        # injects request_id — the same shape timetable's slot grid returns.
        return Response(
            {"data": serializer.data, "meta": self._conflict_meta(serializer.instance)},
            status=201,
        )

    def update(self, request: Request, *args, **kwargs):
        """200 with `meta.conflicts`, on the same reasoning as `create`."""
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        services.assert_schedule_is_editable(instance)

        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        return Response({"data": serializer.data, "meta": self._conflict_meta(serializer.instance)})

    def partial_update(self, request: Request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    @extend_schema(request=None, responses={200: ExamScheduleSerializer(many=True)})
    def publish(self, request: Request, pk: str | None = None):
        """`POST /exams/{id}:publish-schedule` — release the timetable (§5.2).

        Routed under `/exams` rather than `/exam-schedules` because it is the
        *exam* that moves state: a schedule is published as a whole, not sitting
        by sitting, and §6 calls it "schedule publish to portals".
        """
        exam = get_object_or_404(Exam.objects.alive(), pk=pk)
        outcome = services.publish_exam_schedule(exam=exam, actor_id=request.user.pk)
        record_audit(request, "publish", exam, after={"status": outcome["status"]})

        transaction.on_commit(
            lambda: tasks.notify_schedule_published.delay(
                tenant_id=str(request.tenant.pk), exam_id=str(exam.pk)
            )
        )
        return ActionResponse.ok(
            {"status": outcome["status"], "conflicts": outcome["conflicts"]},
            message="Schedule published. Students and guardians have been notified.",
        )


class AdmitCardViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`/admit-cards` — §5.3's issued cards.

    **No create or update.** §16 declares a `GET` plus two colon-actions and
    nothing else: a card's number is generated so two students can never share
    one, its file is written by a job, and its status moves through
    `:issue-admit-cards` and `:revoke`. A per-row create would bypass all three.

    Portal-readable for reads only; see the module docstring.
    """

    permission_classes = PORTAL_READABLE_PERMISSIONS
    queryset = AdmitCard.objects
    serializer_class = AdmitCardSerializer
    filterset_class = AdmitCardFilterSet
    search_fields = ["admit_card_no"]
    ordering_fields = ["admit_card_no", "created_at"]
    scope_own_field = None
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "exams.admit-card.view"
    required_permission_map = {
        "issue": "exams.admit-card.issue",
        "revoke": "exams.admit-card.issue",
    }
    http_method_names = ["get", "post", "head", "options"]

    STAFF_ONLY_ACTIONS = frozenset({"issue", "revoke"})

    def get_permissions(self):
        """Add `DenyRestrictedPrincipals` to the write actions only — as above."""
        if self.action in self.STAFF_ONLY_ACTIONS:
            return [permission() for permission in STAFF_PERMISSIONS]
        return super().get_permissions()

    def get_queryset(self):
        return super().get_queryset().select_related("student")

    @extend_schema(request=None, responses={202: None})
    def issue(self, request: Request, pk: str | None = None):
        """`POST /exams/{id}:issue-admit-cards` — 202 + a job (§16).

        The **rows** are created synchronously so the caller learns immediately
        how many cards this run added, and only the PDFs are deferred: a hall's
        worth of WeasyPrint renders is not work an exam clerk holds a request
        open for (api-architecture.md §2.7).

        Accepts `Idempotency-Key`, because a clerk's double-click on a batch
        action should replay the first answer rather than start a second render
        of three hundred documents.
        """
        exam = get_object_or_404(Exam.objects.alive(), pk=pk)

        def execute():
            outcome = services.issue_admit_cards(exam=exam, actor_id=request.user.pk)
            job = create_job(
                tenant_id=request.tenant.pk,
                job_type="exams.admit-cards",
                payload={"exam_id": str(exam.pk), "requested_by": str(request.user.pk)},
                actor_id=request.user.pk,
            )
            transaction.on_commit(
                lambda: tasks.render_admit_cards_task.delay(
                    tenant_id=str(request.tenant.pk),
                    job_id=str(job.pk),
                    actor_id=str(request.user.pk),
                )
            )
            record_audit(request, "issue", exam, after=outcome)
            return ActionResponse.accepted(
                str(job.pk),
                message=(
                    f"{outcome['issued']} admit card(s) created and queued for rendering; "
                    f"{outcome['already_issued']} already existed."
                ),
            )

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="exams:issue-admit-cards",
            execute=execute,
        )

    @extend_schema(request=AdmitCardRevokeSerializer, responses={200: AdmitCardSerializer})
    def revoke(self, request: Request, pk: str | None = None):
        """`POST /admit-cards/{id}:revoke` — withdraw a card, with a reason (§5.3)."""
        card = get_object_or_404(self.get_queryset(), pk=pk)
        serializer = AdmitCardRevokeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        before = {"status": card.status}

        services.revoke_admit_card(
            card=card, reason=serializer.validated_data["reason"], actor_id=request.user.pk
        )

        record_audit(
            request,
            "update",
            card,
            before=before,
            after={"status": card.status, "revoked_reason": card.revoked_reason},
        )
        return ActionResponse.ok(AdmitCardSerializer(card).data, message="Admit card revoked.")
