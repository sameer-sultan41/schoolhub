"""HTTP layer for the examinations module.

Thin by design: every rule that needs more than the request body lives in
`services`, so the API, the result-processing job and the marks importer all
apply the same checks.

**Every viewset here is staff-only.** §4 gives `student` and `guardian` nothing
in this PR — their access begins with schedules, admit cards and published
results, which arrive in the PRs that ship those tables. When it does, it will
need `get_permissions`, not a class attribute: a viewset serving both a portal
read and a staff write cannot express that with `permission_classes` alone,
because DRF resolves it per view. That is PR #42's privilege-escalation finding,
and this module is the next place with the same shape.

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

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.examinations import services
from apps.examinations.filters import (
    ExamFilterSet,
    ExamSubjectFilterSet,
    GradingScaleFilterSet,
)
from apps.examinations.models import Exam, ExamSubject, GradeBand, GradingScale
from apps.examinations.serializers import (
    ExamSerializer,
    ExamSubjectSerializer,
    GradeBandSerializer,
    GradingScaleSerializer,
)
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
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
