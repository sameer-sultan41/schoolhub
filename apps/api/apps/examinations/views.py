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
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.examinations import conflicts, processing, services, tasks
from apps.examinations.filters import (
    AdmitCardFilterSet,
    ExamFilterSet,
    ExamScheduleFilterSet,
    ExamSubjectFilterSet,
    GradingScaleFilterSet,
    MarksFilterSet,
    ReportCardFilterSet,
    ResultFilterSet,
)
from apps.examinations.models import (
    AdmitCard,
    Exam,
    ExamSchedule,
    ExamSubject,
    GradeBand,
    GradingScale,
    Marks,
    ReportCard,
    ReportCardStatus,
    Result,
    ResultStatus,
)
from apps.examinations.serializers import (
    AdmitCardRevokeSerializer,
    AdmitCardSerializer,
    BulkMarksEntrySerializer,
    ExamScheduleSerializer,
    ExamSerializer,
    ExamSubjectSerializer,
    GradeBandSerializer,
    GradingScaleSerializer,
    MarksImportRequestSerializer,
    MarksSerializer,
    ReportCardSerializer,
    ResultSerializer,
    ResultWithholdSerializer,
    SendResultsBackSerializer,
)
from core.api.exceptions import Conflict
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.idempotency.services import replay_or_execute
from core.jobs.services import create_job
from core.rbac.permissions import (
    DenyRestrictedPrincipals,
    HasPermissionKey,
    is_restricted_principal,
)

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
        # Publishing releases a timetable to every student in the tenant and
        # fires §12's announcement. It was missing from this map in review, so
        # it fell back to `required_permission` — the bare *view* key.
        "publish": "exams.schedule.update",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    # **Everything that is not a read.** Written as "read actions are the
    # exception" rather than as a list of writes, because review found `publish`
    # missing from the list-of-writes version — the same privilege-escalation
    # class as PR #42's `:bulk-mark`, in the module whose own docstring warns
    # about it. A new action now defaults to staff-only and has to be named
    # here to become portal-readable, which is the direction that fails safe.
    PORTAL_READABLE_ACTIONS = frozenset({"list", "retrieve"})

    def get_permissions(self):
        """Add `DenyRestrictedPrincipals` to everything except the portal reads.

        DRF resolves `permission_classes` per view, not per action, so a viewset
        serving both a portal read and a staff write has to choose here. See the
        module docstring for why the service check cannot close this alone.

        Defaulting to *staff* and listing the readable actions is deliberate: a
        list of write actions has to be updated every time one is added, and
        forgetting is silent. Forgetting to add a read here is a 403 someone
        reports immediately.
        """
        if self.action in self.PORTAL_READABLE_ACTIONS:
            return super().get_permissions()
        return [permission() for permission in STAFF_PERMISSIONS]

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

    def perform_destroy(self, instance) -> None:
        """A completed sitting cannot be deleted either.

        `update` already refused one; review found `destroy` falling through to
        the mixin's soft delete with no check, which made DELETE the way around
        a rule PATCH enforced. A completed sitting is a paper students have sat
        — `cancelled` is the state for calling one off, and it keeps the row
        visible to whoever saw it.
        """
        services.assert_schedule_is_editable(instance)
        super().perform_destroy(instance)

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

    # Read actions named, everything else staff-only — see
    # `ExamScheduleViewSet.get_permissions` for why the set is inverted.
    PORTAL_READABLE_ACTIONS = frozenset({"list", "retrieve"})

    def get_permissions(self):
        """Add `DenyRestrictedPrincipals` to everything except the portal reads."""
        if self.action in self.PORTAL_READABLE_ACTIONS:
            return super().get_permissions()
        return [permission() for permission in STAFF_PERMISSIONS]

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


class MarksViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`/marks` — §5.4's entry, read here and written through `:bulk-entry`.

    **Staff-only, every action.** §4 grants no portal role a marks key: a
    student sees *results*, and §5.6 gates those behind publishing. So this
    viewset keeps `STAFF_PERMISSIONS` as a class attribute rather than
    inverting a readable set — there is nothing portal-readable to carve out,
    and pretending otherwise would suggest a portal path that does not exist.

    **No create or update.** §16 declares `GET /marks` plus `:bulk-entry`, and a
    per-row create would bypass the four checks the grid path applies together:
    the entry window, the subject lock, the teacher's allocation, and the
    eligible roll.
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = Marks.objects
    serializer_class = MarksSerializer
    filterset_class = MarksFilterSet
    ordering_fields = ["created_at"]
    # `own` and `assigned` are both joins, not columns here — the model hooks
    # own them and take precedence over these fallbacks, which are left None so
    # a mistaken single-column reading cannot silently apply instead.
    scope_own_field = None
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "exams.marks.create"
    required_permission_map = {
        "bulk_entry": "exams.marks.create",
        "lock": "exams.marks.lock",
        "unlock": "exams.marks.lock",
    }
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().select_related("student", "exam_subject__subject")

    @extend_schema(request=BulkMarksEntrySerializer, responses={200: None})
    def bulk_entry(self, request: Request):
        """`POST /marks:bulk-entry` — one exam-subject's grid (§16).

        Accepts `Idempotency-Key`: §16 calls this an idempotent grid submit, and
        a teacher on a school Wi-Fi genuinely does re-send. The service is an
        upsert either way, so the header buys a replayed *response* rather than
        correctness — which matters because the response carries the counts the
        UI shows.
        """
        serializer = BulkMarksEntrySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        exam_subject = serializer.validated_data["exam_subject"]

        def execute():
            outcome = services.bulk_enter_marks(
                exam_subject=exam_subject,
                entries=serializer.validated_data["entries"],
                user=request.user,
                actor_id=request.user.pk,
            )
            record_audit(request, "create", exam_subject, after=outcome)
            return ActionResponse.ok(
                None,
                message=(f"{outcome['entered']} entered, {outcome['updated']} updated."),
            )

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="marks:bulk-entry",
            execute=execute,
        )

    @extend_schema(request=None, responses={200: None})
    def lock(self, request: Request, pk: str | None = None):
        """`POST /exam-subjects/{id}:lock-marks` (§16)."""
        exam_subject = get_object_or_404(ExamSubject.objects.alive(), pk=pk)
        outcome = services.lock_marks(exam_subject=exam_subject, actor_id=request.user.pk)
        record_audit(request, "lock", exam_subject, after=outcome)
        return ActionResponse.ok(
            outcome,
            message=(
                "Marks were already locked."
                if outcome["already_locked"]
                else f"{outcome['locked_rows']} row(s) locked."
            ),
        )

    @extend_schema(request=None, responses={200: None})
    def unlock(self, request: Request, pk: str | None = None):
        """`POST /exam-subjects/{id}:unlock-marks` (§16).

        Behind `exams.marks.lock`, and audited — §6 asks for both, because
        reopening a window is how a settled mark changes.
        """
        exam_subject = get_object_or_404(ExamSubject.objects.alive(), pk=pk)
        outcome = services.unlock_marks(exam_subject=exam_subject, actor_id=request.user.pk)
        record_audit(request, "update", exam_subject, after=outcome)
        return ActionResponse.ok(
            outcome,
            message=(
                "Marks were not locked."
                if outcome["already_unlocked"]
                else f"{outcome['unlocked_rows']} row(s) reopened."
            ),
        )

    @extend_schema(responses={200: None})
    def progress(self, request: Request, pk: str | None = None):
        """`GET /exams/{id}/marks-progress` — §6's missing-entries dashboard.

        A plain `GET` rather than a report `kind`, because it is operational
        rather than analytical: an exam clerk chasing outstanding entries wants
        it beside the exam, and §13 lists "marks-entry status" as its own row.
        """
        exam = get_object_or_404(Exam.objects.alive(), pk=pk)
        return ActionResponse.ok(services.marks_entry_progress(exam=exam))


class MarksImportViewSet(TenantScopedViewSetMixin, viewsets.GenericViewSet):
    """`POST /marks-imports` — §9's marks sheet, as 202 + a job.

    A pure job-launcher: no queryset, no record scope. The uploaded file is
    handed to the task base64-encoded in the job payload, matching
    `attendance`'s importer — a file small enough to be a marks sheet is small
    enough to carry, and staging it in object storage first would add a failure
    mode between the upload and the parse.
    """

    permission_classes = STAFF_PERMISSIONS
    required_feature = FEATURE
    required_permission = "exams.marks.import"
    parser_classes = [MultiPartParser]
    serializer_class = MarksImportRequestSerializer

    @extend_schema(request=MarksImportRequestSerializer, responses={202: None})
    def create(self, request: Request):
        import base64

        serializer = MarksImportRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        exam_subject = serializer.validated_data["exam_subject"]
        upload = serializer.validated_data["file"]

        # The window and lock are checked *here*, before a job is created, so a
        # clerk importing into a locked subject is told immediately rather than
        # by polling a job that fails.
        services.assert_exam_accepts_marks(exam_subject.exam)
        services.assert_marks_window_open(exam_subject)

        job = create_job(
            tenant_id=request.tenant.pk,
            job_type="exams.marks-import",
            payload={
                "exam_subject_id": str(exam_subject.pk),
                "filename": upload.name,
                "content_base64": base64.b64encode(upload.read()).decode(),
                "requested_by": str(request.user.pk),
            },
            actor_id=request.user.pk,
        )
        transaction.on_commit(
            lambda: tasks.import_marks_task.delay(
                tenant_id=str(request.tenant.pk),
                job_id=str(job.pk),
                actor_id=str(request.user.pk),
            )
        )
        record_audit(request, "import", exam_subject, after={"job_id": str(job.pk)})
        return ActionResponse.accepted(
            str(job.pk), message="Marks sheet queued. Poll the job for the row-level report."
        )


class ResultViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`/results` — §5.5's processed outcomes and §5.6's chain.

    **Two narrowings, and they answer different questions.** Record scope
    answers *whose* result a caller may see — `filter_owned_by_user` for a
    student or guardian, `filter_assigned_to_user` for a class teacher. This
    viewset adds *when*: a restricted principal sees `published` rows only,
    because §5.6 makes releasing a separate, permissioned act from computing.
    Conflating the two inside the model hook would put a publishing rule
    somewhere nobody looks for one.

    Portal-readable for reads only. The **readable** actions are named and
    everything else is staff-only, which is PR B's review lesson: a list of
    writes has to be updated whenever one is added, and forgetting is silent.
    """

    permission_classes = PORTAL_READABLE_PERMISSIONS
    queryset = Result.objects
    serializer_class = ResultSerializer
    filterset_class = ResultFilterSet
    ordering_fields = ["percentage", "rank_in_section", "created_at"]
    scope_own_field = None
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "exams.result.view"
    required_permission_map = {
        "process": "exams.result.create",
        "approve": "exams.result.approve",
        "send_back": "exams.result.approve",
        "publish": "exams.result.publish",
        "withhold": "exams.result.publish",
    }
    http_method_names = ["get", "post", "head", "options"]

    PORTAL_READABLE_ACTIONS = frozenset({"list", "retrieve"})

    def get_permissions(self):
        if self.action in self.PORTAL_READABLE_ACTIONS:
            return super().get_permissions()
        return [permission() for permission in STAFF_PERMISSIONS]

    def get_queryset(self):
        queryset = super().get_queryset().select_related("student", "grade_band", "section")
        if is_restricted_principal(self.request.user):
            # §5.6 — a student or guardian sees a result only once it is
            # released. Applied here rather than in the model hook because it is
            # a question about the *result's* state, not about whose it is.
            queryset = queryset.filter(status=ResultStatus.PUBLISHED)
        return queryset

    @extend_schema(request=None, responses={202: None})
    def process(self, request: Request, pk: str | None = None):
        """`POST /exams/{id}:process-results` — 202 + a job (§16).

        The readiness check runs here *and* in the job. Here it is for the
        clerk — an immediate, readable refusal naming which subjects are
        outstanding. In the job it is what actually holds, because marks can
        change between the request and the worker picking it up.
        """
        exam = get_object_or_404(Exam.objects.alive(), pk=pk)
        services.assert_exam_is_recomputable(exam)
        processing.assert_ready_to_process(processing.collect(exam=exam))

        def execute():
            job = create_job(
                tenant_id=request.tenant.pk,
                job_type="exams.process-results",
                payload={"exam_id": str(exam.pk), "requested_by": str(request.user.pk)},
                actor_id=request.user.pk,
            )
            transaction.on_commit(
                lambda: tasks.process_results_task.delay(
                    tenant_id=str(request.tenant.pk),
                    job_id=str(job.pk),
                    actor_id=str(request.user.pk),
                )
            )
            record_audit(request, "create", exam, after={"job_id": str(job.pk)})
            return ActionResponse.accepted(str(job.pk), message="Result processing queued.")

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="exams:process-results",
            execute=execute,
        )

    @extend_schema(request=None, responses={200: None})
    def approve(self, request: Request, pk: str | None = None):
        """`POST /exams/{id}:approve-results` — §5.6's gate.

        `assert_approver_is_not_the_processor` lives in `services`, not here:
        the rule is the module's and has to hold for any caller, and §4's
        closing line makes it a property of the results rather than of the
        request.
        """
        exam = get_object_or_404(Exam.objects.alive(), pk=pk)
        before = {"status": exam.status}
        outcome = services.approve_exam_results(exam=exam, approver_id=request.user.pk)
        record_audit(request, "approve", exam, before=before, after=outcome)
        return ActionResponse.ok(outcome, message=f"{outcome['approved']} result(s) approved.")

    @extend_schema(request=SendResultsBackSerializer, responses={200: None})
    def send_back(self, request: Request, pk: str | None = None):
        """`POST /exams/{id}:send-results-back` — §7.1's "changes requested" edge.

        Not in §16's list; see the module doc's §20 for why it is built anyway.
        Behind the *approve* key, because sending back is the other half of the
        same decision.
        """
        exam = get_object_or_404(Exam.objects.alive(), pk=pk)
        serializer = SendResultsBackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        before = {"status": exam.status}

        outcome = services.send_results_back(
            exam=exam,
            actor_id=request.user.pk,
            reason=serializer.validated_data["reason"],
        )

        record_audit(request, "update", exam, before=before, after=outcome)
        return ActionResponse.ok(
            outcome,
            message=f"{outcome['reopened']} result(s) reopened; marks entry is open again.",
        )

    @extend_schema(request=None, responses={200: None})
    def publish(self, request: Request, pk: str | None = None):
        """`POST /exams/{id}:publish-results` — §5.6's release.

        §12's notification fires on the rows that actually **transitioned**,
        whose ids are collected before the write and handed to the task. That is
        `attendance`'s review finding applied: publishing is idempotent, so
        notifying on current status would re-send every guardian the same
        message on a re-publish.
        """
        exam = get_object_or_404(Exam.objects.alive(), pk=pk)
        before = {"status": exam.status}

        # The moved ids come back **from the service**, which collected them
        # under `SELECT ... FOR UPDATE`. Collecting them here first — the
        # original shape — left a window in which two concurrent publishes both
        # read the same approved rows and each scheduled §12's notification for
        # them.
        outcome = services.publish_exam_results(exam=exam, actor_id=request.user.pk)
        record_audit(request, "publish", exam, before=before, after=outcome)

        moved = outcome["published_ids"]
        transaction.on_commit(
            lambda: tasks.notify_results_published.delay(
                tenant_id=str(request.tenant.pk),
                exam_id=str(exam.pk),
                result_ids=moved,
            )
        )
        return ActionResponse.ok(
            outcome,
            message=(
                f"{outcome['published']} result(s) published"
                + (f"; {outcome['withheld']} withheld." if outcome["withheld"] else ".")
            ),
        )

    @extend_schema(request=ResultWithholdSerializer, responses={200: ResultSerializer})
    def withhold(self, request: Request, pk: str | None = None):
        """`POST /results/{id}:withhold` — §5.6's per-student hold."""
        result = get_object_or_404(Result.objects.alive(), pk=pk)
        serializer = ResultWithholdSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        before = {"outcome": result.outcome}

        services.withhold_result(
            result=result,
            reason=serializer.validated_data["reason"],
            actor_id=request.user.pk,
        )

        record_audit(
            request,
            "update",
            result,
            before=before,
            after={"outcome": result.outcome, "reason": serializer.validated_data["reason"]},
        )
        return ActionResponse.ok(
            ResultSerializer(result).data, message="Result withheld from publication."
        )


class ReportCardViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """`/report-cards` — §5.7.

    `PATCH` exists for the two remark fields and nothing else; everything
    structural is set by the generation job. Remarks are writable only while the
    card is a draft, because editing them on a published card would change a
    document a parent already holds without the version changing.

    Portal-readable for reads only, and a restricted principal sees `published`
    cards — the same two-narrowings split `ResultViewSet` documents.
    """

    permission_classes = PORTAL_READABLE_PERMISSIONS
    queryset = ReportCard.objects
    serializer_class = ReportCardSerializer
    filterset_class = ReportCardFilterSet
    ordering_fields = ["created_at", "version"]
    scope_own_field = None
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "exams.report-card.view"
    required_permission_map = {
        "update": "exams.report-card.create",
        "partial_update": "exams.report-card.create",
        "generate": "exams.report-card.create",
        "publish": "exams.report-card.publish",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    PORTAL_READABLE_ACTIONS = frozenset({"list", "retrieve"})

    def get_permissions(self):
        if self.action in self.PORTAL_READABLE_ACTIONS:
            return super().get_permissions()
        return [permission() for permission in STAFF_PERMISSIONS]

    def get_queryset(self):
        queryset = super().get_queryset().select_related("student", "result")
        if is_restricted_principal(self.request.user):
            queryset = queryset.filter(status=ReportCardStatus.PUBLISHED)
        return queryset

    def perform_update(self, serializer) -> None:
        if serializer.instance.status == ReportCardStatus.PUBLISHED:
            raise Conflict(
                "This report card is published. Regenerate it to issue a new version with "
                "different remarks."
            )
        super().perform_update(serializer)

    @extend_schema(request=None, responses={202: None})
    def generate(self, request: Request, pk: str | None = None):
        """`POST /exams/{id}:generate-report-cards` — 202 + a job (§16)."""
        exam = get_object_or_404(Exam.objects.alive(), pk=pk)
        services.assert_report_cards_are_generatable(exam)

        def execute():
            job = create_job(
                tenant_id=request.tenant.pk,
                job_type="exams.report-cards",
                payload={"exam_id": str(exam.pk), "requested_by": str(request.user.pk)},
                actor_id=request.user.pk,
            )
            transaction.on_commit(
                lambda: tasks.generate_report_cards_task.delay(
                    tenant_id=str(request.tenant.pk),
                    job_id=str(job.pk),
                    actor_id=str(request.user.pk),
                )
            )
            record_audit(request, "create", exam, after={"job_id": str(job.pk)})
            return ActionResponse.accepted(str(job.pk), message="Report card generation queued.")

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="exams:generate-report-cards",
            execute=execute,
        )

    @extend_schema(request=None, responses={200: None})
    def publish(self, request: Request, pk: str | None = None):
        """`POST /exams/{id}:publish-report-cards` — release them to the portals.

        §12's notification fires on the cards that actually moved, whose ids are
        collected before the write — the same transition-not-state rule
        `:publish-results` follows.
        """
        exam = get_object_or_404(Exam.objects.alive(), pk=pk)

        outcome = services.publish_report_cards(exam=exam, actor_id=request.user.pk)
        record_audit(request, "publish", exam, after=outcome)

        # From the service, under its lock — see `:publish-results`.
        moved = outcome["published_ids"]
        transaction.on_commit(
            lambda: tasks.notify_report_cards_ready.delay(
                tenant_id=str(request.tenant.pk), exam_id=str(exam.pk), card_ids=moved
            )
        )
        return ActionResponse.ok(
            outcome, message=f"{outcome['published']} report card(s) published."
        )
