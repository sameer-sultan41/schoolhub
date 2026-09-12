"""`CurriculumViewSet` — request handling for `/class-subjects` (§5.1, §16).

`CurriculumViewSet` serves `/api/v1/class-subjects`, which school_organization
used to own under `school.subject.*` keys. academics.md §4 declares
`academics.curriculum.*` for it and school-organization.md §6 says curriculum
mapping belongs here, so the endpoint moved and the old viewset was removed —
one route, one key set. The *model* stayed put (apps/academics/models.py's
header says why), and so did `BlockingDestroyMixin`, imported below: the mixin
is a thin wrapper over `school_organization.services.assert_deletable`, which
walks the model's own related objects, so it belongs beside the model rather
than being copied to follow the route.

`FEATURE` stays in the trimmed root `views.py` — every viewset in this module
shares it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db.models import F
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import viewsets
from rest_framework.response import Response

if TYPE_CHECKING:
    from rest_framework.request import Request

from apps.academics.curriculum import services
from apps.academics.curriculum.filters import CurriculumFilterSet
from apps.academics.curriculum.serializers import (
    CloneCurriculumRequestSerializer,
    CurriculumSerializer,
)
from apps.academics.views import FEATURE
from apps.school_organization.models import ClassSubject
from apps.school_organization.services import map_subject_to_class
from apps.school_organization.views import BlockingDestroyMixin
from core.api.pagination import PageNumberPagination
from core.api.viewsets import ActionResponse
from core.audit.services import record_audit
from core.idempotency.services import replay_or_execute


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
