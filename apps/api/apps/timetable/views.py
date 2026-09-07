"""HTTP layer for the timetable module.

Thin by design: every rule that needs more than the request body lives in
``services``, and every conflict rule in ``conflicts``. See
core.api.viewsets.TenantScopedViewSetMixin for what `queryset = Model.objects`
(the manager, never `.all()`) buys, and for why `required_feature` is checked
before `required_permission`.

Two things about this module's permission keys are worth stating once here
rather than repeating at every call site:

- **§4 declares no view key for periods or rooms.** It has
  `timetable.period.create/update/delete` and `timetable.room.*`, but nothing to
  read them with. Reading the bell schedule and the room list is reading the
  timetable's scaffolding, so both lists take `timetable.timetable.view` —
  academics' curriculum viewset is in exactly the same position and resolves it
  the same way. Inventing `timetable.period.view` would put a key in the
  registry that no module doc declares and no seeded role holds.
- **`timetable.slot.view` guards `/timetable-slots`, not
  `timetable.timetable.view`.** That list returns *drafts*, and §5.7 says an
  unpublished timetable must never leak to students or guardians. The published
  grid they are entitled to is `GET /timetables/my`.

`DenyRestrictedPrincipals` is on every viewset here except ``MyTimetableViewSet``
— students and guardians must reach that one, and only that one.

**Not built: `POST /timetables/{section_id}:generate-draft`.** §16 lists it, and
it is AI-TTB-01: Phase 3 work that has to go through the AI gateway in
``core/ai`` (AGENTS.md hard rule 6), which does not exist yet. Building it
against a provider SDK directly, or stubbing a 202 pointing at a job nothing
runs, would both be worse than the omission.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db.models import F
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

if TYPE_CHECKING:
    from datetime import date

    from rest_framework.request import Request

from apps.school_organization.models import AcademicSession, Section
from apps.staff_management.models import Staff
from apps.student_management.models import EnrollmentStatus, Student, StudentEnrollment
from apps.timetable import services
from apps.timetable.filters import (
    PeriodFilterSet,
    RoomFilterSet,
    TeacherSubstitutionFilterSet,
    TimetableSlotFilterSet,
)
from apps.timetable.models import (
    Period,
    Room,
    SlotStatus,
    SubstitutionStatus,
    TeacherSubstitution,
    TimetableSlot,
)
from apps.timetable.serializers import (
    EffectiveSlotSerializer,
    MyTimetableQuerySerializer,
    PeriodSerializer,
    RoomSerializer,
    TeacherSubstitutionSerializer,
    TimetableSessionRequestSerializer,
    TimetableSlotSerializer,
)
from core.api.exceptions import DomainRuleViolation
from core.api.pagination import PageNumberPagination
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.rbac.models import RecordScope
from core.rbac.permissions import (
    DenyRestrictedPrincipals,
    HasPermissionKey,
    scope_queryset,
    user_scopes,
)

FEATURE = "module.timetable"

STAFF_PERMISSIONS = [
    IsAuthenticated,
    RequiresModuleFeature,
    HasPermissionKey,
    DenyRestrictedPrincipals,
]

# §4 declares no `timetable.period.view` / `timetable.room.view`; see the module
# docstring for why reading both falls under the timetable view key.
SCAFFOLDING_VIEW_KEY = "timetable.timetable.view"


def _resolve_session(session: AcademicSession | None) -> AcademicSession:
    """Fall back to the tenant's current session when the caller names none.

    A school runs one session at a time and the grid UI has no reason to carry
    its id around, but "no current session" is a real configuration state — so
    it is a 422 naming the field rather than an AttributeError later.
    """
    if session is not None:
        return session
    current = AcademicSession.objects.alive().filter(is_current=True).first()
    if current is None:
        raise DomainRuleViolation(
            {
                "academic_session_id": (
                    "This school has no current academic session; name one explicitly."
                )
            }
        )
    return current


def _scoped_section(request: Request, pk) -> Section:
    """Resolve `{section_id}` under the caller's record scope.

    Through ``scope_queryset`` rather than a bare manager lookup: a campus-scoped
    vice principal must not be able to publish another campus's grid, and the
    tenant-scoped manager alone would let them. A section they cannot reach is a
    404, never a 403 (AGENTS.md invariant 4).
    """
    return get_object_or_404(
        scope_queryset(Section.objects.alive(), request.user, campus_field="campus_id"), pk=pk
    )


class RoomViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`rooms` — physical rooms, labs and halls (§5.4)."""

    permission_classes = STAFF_PERMISSIONS
    queryset = Room.objects
    serializer_class = RoomSerializer
    filterset_class = RoomFilterSet
    search_fields = ["name", "code", "building"]
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    # Every column the room table renders, except the building/floor pair: the client
    # joins those two into one display string, and sorting on `building` alone would
    # order the rows by something other than what the header names.
    #
    # Only `created_at` has an index that an ORDER BY can walk. `code` and `room_type`
    # sit at the tail of composite indexes led by (tenant, campus), so neither is a
    # usable prefix here; `name` has `rooms_tenant_name_idx`, but `capacity` and
    # `is_active` have no index at all, and `campus_name` is joined. Those therefore
    # sort the tenant's rooms in memory — affordable only because this table is bounded
    # by one school's room count. `capacity` is nullable, so Postgres puts the unset
    # rooms last ascending and first descending.
    ordering_fields = [
        "code",
        "name",
        "room_type",
        "capacity",
        "is_active",
        "campus_name",
        "created_at",
    ]
    #: Entries in ordering_fields that are annotations from get_queryset, not model
    #: fields — tests/test_endpoint_contracts.py cannot resolve these against the model.
    ordering_annotations = ("campus_name",)
    # Room.Meta.ordering. Declared here too because DRF's ordering filter reads the
    # *view's* default, not the model's, and a list with no view default lets the
    # paginator page an unordered result.
    ordering = ["campus_id", "code"]
    scope_campus_field = "campus_id"
    required_feature = FEATURE
    required_permission = SCAFFOLDING_VIEW_KEY
    required_permission_map = {
        "create": "timetable.room.create",
        "update": "timetable.room.update",
        "partial_update": "timetable.room.update",
        "destroy": "timetable.room.delete",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        """`campus_name` is annotated, never traversed in `ordering_fields`.

        No scope narrows this table with a ``.distinct()`` today — ``Room`` declares no
        ``filter_owned_by_user`` — so `campus__name` would in fact work right now. It
        is still annotated, and tests/test_endpoint_contracts.py refuses a `__` in any
        `ordering_fields`: the day someone gives ``Room`` an own-scope hook (every one
        written so far ends in ``.distinct()``, because the joins they walk fan out),
        `SELECT DISTINCT` + `ORDER BY <joined column>` starts raising ProgrammingError
        for that principal only, and nothing in review would connect the two changes.
        The annotation costs one already-open join and removes the trap.
        ``select_related`` is what keeps it to that one join.
        """
        return (
            super().get_queryset().select_related("campus").annotate(campus_name=F("campus__name"))
        )


class PeriodViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`periods` — the bell schedule (§5.1)."""

    permission_classes = STAFF_PERMISSIONS
    queryset = Period.objects
    serializer_class = PeriodSerializer
    filterset_class = PeriodFilterSet
    search_fields = ["name"]
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    # Every column the bell-schedule table renders except `weekdays`, which is an
    # array — there is no ordering of it a reader would recognise as the one the
    # header promises.
    #
    # Only `created_at` has an index an ORDER BY can walk: `periods_tenant_campus_idx`
    # is led by (tenant, campus), so nothing else here is a usable prefix, and
    # `sequence`, `name`, `start_time`, `end_time` and `is_break` all sort the tenant's
    # periods in memory. A bell schedule is a few dozen rows, so that is the cheap
    # half of the trade. `campus_name` is joined *and* nullable — a null campus means
    # "every campus" (models.py), so those rows land last ascending, first descending.
    ordering_fields = [
        "sequence",
        "name",
        "start_time",
        "end_time",
        "is_break",
        "campus_name",
        "created_at",
    ]
    ordering_annotations = ("campus_name",)
    # Period.Meta.ordering; see RoomViewSet for why the view repeats the model's.
    ordering = ["sequence"]
    scope_campus_field = "campus_id"
    required_feature = FEATURE
    required_permission = SCAFFOLDING_VIEW_KEY
    required_permission_map = {
        "create": "timetable.period.create",
        "update": "timetable.period.update",
        "partial_update": "timetable.period.update",
        "destroy": "timetable.period.delete",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        """Campus scoping must not hide the tenant-wide periods.

        ``scope_queryset`` narrows to ``campus_id IN (...)``, which drops
        ``campus_id IS NULL`` — and a null campus on a period means "every
        campus" (models.py). Left alone, a campus-scoped admin would lose exactly
        the rows that do apply to them, and the day template would render with
        lunch missing. The scoped queryset is combined back with the tenant-wide
        rows rather than the campus filter being reimplemented here.

        ``_with_campus_name`` is applied *after* that combine rather than to each
        side of it. ``QuerySet.__or__`` keeps only the left-hand query's
        annotations, so annotating both sides would be one wasted join and one
        silent dependence on which operand is on the left.
        """
        scoped = super().get_queryset()

        scopes = user_scopes(self.request.user)
        campus_ids = [ref for ref in scopes.get(RecordScope.CAMPUS, []) if ref]
        # `not campus_ids` covers a campus scope with no `scope_ref`, which
        # `scope_queryset` treats as granting nothing; widening that back to the
        # tenant-wide rows would turn a malformed assignment into extra access.
        if RecordScope.ALL in scopes or not campus_ids:
            return self._with_campus_name(scoped)

        tenant_wide = Period.objects.alive().filter(campus__isnull=True)
        return self._with_campus_name((scoped | tenant_wide).distinct())

    @staticmethod
    def _with_campus_name(queryset):
        """Make the campus sortable without putting a `__` in `ordering_fields`.

        This queryset is ``.distinct()`` on the campus-scoped path above, and
        Postgres rejects ``SELECT DISTINCT`` with an ``ORDER BY`` on a joined column
        that is not in the select list — so `campus__name` in `ordering_fields`
        would be a 500 for exactly the principals that branch exists to serve. The
        annotation is in the select list, which is what makes the alias safe.

        ``select_related`` is not redundant with the annotation: without it the
        serializer's campus fields would re-fetch the row per period.
        """
        return queryset.select_related("campus").annotate(campus_name=F("campus__name"))


class TimetableSlotViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`timetable_slots` — the weekly grid, cell by cell (§5.2).

    **Every mutation returns `meta.conflicts` and still saves.** §5.5 draws the
    line at publish, not at save: hard conflicts block
    `:publish`, while a grid mid-build is allowed to be temporarily wrong —
    an admin who cannot save an in-progress state cannot build a timetable at
    all. The response carries the full machine-readable list §6 specifies so the
    grid can highlight exactly the cells to fix.

    Cursor paginated, per §16 — the project default (settings
    ``DEFAULT_PAGINATION_CLASS``), so nothing is declared here.
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = TimetableSlot.objects
    serializer_class = TimetableSlotSerializer
    filterset_class = TimetableSlotFilterSet
    search_fields = ["notes"]
    ordering_fields = ["day_of_week", "created_at"]
    # "own" for a teacher means the slots they teach, joined through
    # staff.user_id — TimetableSlot.filter_owned_by_user, which takes precedence
    # over this single-column fallback.
    scope_own_field = "staff__user_id"
    scope_campus_field = "section__campus_id"
    required_feature = FEATURE
    # Drafts live on this list; see the module docstring.
    required_permission = "timetable.slot.view"
    required_permission_map = {
        "create": "timetable.slot.create",
        "update": "timetable.slot.update",
        "partial_update": "timetable.slot.update",
        "destroy": "timetable.slot.delete",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .select_related("academic_session", "section", "period", "subject", "staff", "room")
        )

    def _conflict_meta(self, slot: TimetableSlot) -> dict:
        """The per-edit conflict run §16 requires in `meta.conflicts`.

        Section-scoped rather than session-wide: the caller is editing one
        section's grid and wants the cells they can act on, and
        ``detect_conflicts`` still *compares* against the whole session because a
        teacher or room clash is by definition with some other section.
        """
        return {
            "conflicts": services.conflicts_for(session=slot.academic_session, section=slot.section)
        }

    @extend_schema(
        summary="Add a slot to a section's draft grid",
        responses={
            201: OpenApiResponse(
                response=TimetableSlotSerializer,
                description="The slot, plus `meta.conflicts` for the section (§16).",
            )
        },
    )
    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)

        # A bare Response, not ActionResponse.ok: that helper wraps its argument
        # in {"data": ...}, so handing it an already-enveloped payload nests the
        # envelope twice. EnvelopeJSONRenderer passes a pre-shaped
        # {"data", "meta"} dict through untouched and injects request_id.
        return Response(
            {"data": serializer.data, "meta": self._conflict_meta(serializer.instance)}, status=201
        )

    @extend_schema(
        summary="Edit a draft slot",
        responses={
            200: OpenApiResponse(
                response=TimetableSlotSerializer,
                description="The slot, plus `meta.conflicts` for the section (§16).",
            )
        },
    )
    def update(self, request: Request, *args, **kwargs) -> Response:
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        # §5.7: a published cell is changed by editing the draft and
        # republishing, never in place — otherwise students read a different
        # timetable with neither validation nor notification behind the change.
        services.assert_slot_writable(instance)

        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        return Response({"data": serializer.data, "meta": self._conflict_meta(serializer.instance)})

    @extend_schema(
        summary="Remove a draft slot",
        responses={
            200: OpenApiResponse(
                description="`data` is null; `meta.conflicts` is the section's remaining list."
            )
        },
    )
    def destroy(self, request: Request, *args, **kwargs) -> Response:
        instance = self.get_object()
        services.assert_slot_writable(instance)

        # Read before the delete: `perform_destroy` mutates the row, and the
        # conflict run needs the session and section it belonged to.
        session, section = instance.academic_session, instance.section
        self.perform_destroy(instance)

        # 200 with a body, not the usual 204: §16 asks for `meta.conflicts` on
        # *every* slot mutation, and clearing a cell is exactly the edit most
        # likely to resolve a clash the grid is still highlighting.
        return Response(
            {
                "data": None,
                "meta": {"conflicts": services.conflicts_for(session=session, section=section)},
            }
        )


class TimetableViewSet(TenantScopedViewSetMixin, viewsets.GenericViewSet):
    """The section-level actions: `:validate` and `:publish` (§16).

    Both are colon-actions on a *section* id, addressed as `/timetables/{id}`
    because what they act on is that section's timetable rather than any one row
    of it. Neither is `@action`-decorated — the routes are explicit `path()`
    entries in urls.py, placed before the routers so the verb is not parsed as a
    primary key.
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = TimetableSlot.objects
    serializer_class = TimetableSessionRequestSerializer
    scope_own_field = "staff__user_id"
    scope_campus_field = "section__campus_id"
    required_feature = FEATURE
    # A validation run reads the draft grid, so it takes the draft key.
    required_permission = "timetable.slot.view"
    required_permission_map = {
        "validate": "timetable.slot.view",
        "publish": "timetable.timetable.publish",
    }
    # A viewset whose only POST is a colon action still has to list it, or DRF
    # answers 405 before the action is ever reached.
    http_method_names = ["post", "head", "options"]

    def _session_from_body(self, request: Request) -> AcademicSession:
        serializer = TimetableSessionRequestSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        return _resolve_session(serializer.validated_data.get("academic_session"))

    @extend_schema(
        summary="Run the full conflict check over a section's timetable",
        request=TimetableSessionRequestSerializer,
        responses={
            200: OpenApiResponse(
                description=(
                    "`conflicts` is the machine-readable list "
                    "`{type, severity, slot_ids, message}` (§6); `has_hard_conflicts` "
                    "says whether publish would be refused."
                )
            )
        },
    )
    def validate(self, request: Request, pk) -> Response:
        section = _scoped_section(request, pk)
        session = self._session_from_body(request)

        conflicts = services.conflicts_for(session=session, section=section)
        return ActionResponse.ok(
            {
                "section_id": str(section.pk),
                "academic_session_id": str(session.pk),
                "conflicts": conflicts,
                "has_hard_conflicts": any(c["severity"] == "hard" for c in conflicts),
            }
        )

    @extend_schema(
        summary="Publish a section's draft timetable",
        request=TimetableSessionRequestSerializer,
        responses={
            200: OpenApiResponse(
                description="Rows published and superseded, plus the accepted soft conflicts."
            ),
            422: OpenApiResponse(
                description="A hard conflict, a locked session, or no draft to publish."
            ),
        },
    )
    def publish(self, request: Request, pk) -> Response:
        section = _scoped_section(request, pk)
        session = self._session_from_body(request)

        # Raises DomainRuleViolation -> 422 on any hard conflict, carrying the
        # conflict list so the client renders what to fix rather than a bare
        # failure. §16 asks for exactly that status.
        result = services.publish_section_timetable(
            session=session, section=section, actor_id=request.user.pk
        )
        record_audit(request, "publish", section, after=result)
        return ActionResponse.ok(result, message="Timetable published.")


class MyTimetableViewSet(TenantScopedViewSetMixin, viewsets.GenericViewSet):
    """`GET /timetables/my` — the caller's own effective timetable (§16).

    The **only** endpoint in this module a student or guardian reaches, and
    therefore the only viewset here without ``DenyRestrictedPrincipals``. It
    serves published rows exclusively (``services.effective_slots_for``), so
    §5.7's "unpublished edits never leak" holds by construction rather than by a
    filter someone has to remember.

    Date-aware: a substitution overrides one cell for specific dates only (§7.2),
    so asking without a date gives the base grid and asking with one gives what
    actually happens that day.
    """

    # Deliberately not STAFF_PERMISSIONS — see the class docstring.
    permission_classes = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]
    queryset = TimetableSlot.objects
    serializer_class = EffectiveSlotSerializer
    # The caller's own week is forty-odd cells; paginating it would make the
    # client reassemble a grid it asked for whole.
    pagination_class = None
    scope_own_field = "staff__user_id"
    scope_campus_field = "section__campus_id"
    required_feature = FEATURE
    required_permission = "timetable.timetable.view"
    http_method_names = ["get", "head", "options"]

    @extend_schema(
        summary="The caller's own effective timetable",
        parameters=[MyTimetableQuerySerializer],
        responses={
            200: OpenApiResponse(
                response=EffectiveSlotSerializer(many=True),
                description=(
                    "Published cells with confirmed substitutions applied for `?date=`. "
                    "`meta.audience` says which principal was resolved."
                ),
            )
        },
    )
    def my(self, request: Request) -> Response:
        query = MyTimetableQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        on_date = query.validated_data.get("date")

        session_id = query.validated_data.get("academic_session_id")
        session = _resolve_session(
            AcademicSession.objects.alive().filter(pk=session_id).first() if session_id else None
        )

        # Staff first: a teacher's "my timetable" is the periods they personally
        # hold, which is a different question from a section's grid. A user with
        # no staff row is a student or a guardian and resolves through
        # enrollments instead.
        staff = Staff.objects.alive().filter(user_id=request.user.pk).first()
        if staff is not None:
            slots, overrides = self._teacher_timetable(
                staff=staff, session=session, on_date=on_date
            )
            audience = "teacher"
        else:
            slots, overrides = self._learner_timetable(session=session, on_date=on_date)
            audience = "learner"

        serializer = EffectiveSlotSerializer(
            slots, many=True, context={"overrides": overrides, "request": request}
        )
        return Response(
            {
                "data": serializer.data,
                "meta": {
                    "audience": audience,
                    "academic_session_id": str(session.pk),
                    "date": on_date.isoformat() if on_date else None,
                },
            }
        )

    def _teacher_timetable(
        self, *, staff: Staff, session: AcademicSession, on_date: date | None
    ) -> tuple[list, dict]:
        """The teacher's own periods, plus anything they are covering that day.

        Two bounded queries feed ``effective_slots_for`` the section set, and the
        result is filtered in Python — never a query per cell. The cover set is
        needed because a substitution can put a teacher in a section they
        otherwise never teach, which the "sections I hold slots in" set alone
        would miss entirely.

        The section lookup uses the same ``slot_version_window`` the cell lookup
        does, so a past date resolves the sections the teacher held *then* — not
        only the ones they hold now.
        """
        section_ids = set(
            TimetableSlot.objects.alive()
            .filter(
                services.slot_version_window(on_date),
                academic_session=session,
                staff=staff,
                status=SlotStatus.PUBLISHED,
            )
            .values_list("section_id", flat=True)
        )
        if on_date is not None:
            section_ids |= set(
                TeacherSubstitution.objects.alive()
                .filter(substitute_staff=staff, date=on_date, status=SubstitutionStatus.CONFIRMED)
                .values_list("timetable_slot__section_id", flat=True)
            )

        slots, overrides = services.effective_slots_for(
            session=session, section_ids=list(section_ids), on_date=on_date
        )
        mine = [
            slot
            for slot in slots
            if slot.staff_id == staff.pk
            or getattr(overrides.get(slot.pk), "substitute_staff_id", None) == staff.pk
        ]
        return mine, overrides

    def _learner_timetable(
        self, *, session: AcademicSession, on_date: date | None
    ) -> tuple[list, dict]:
        """A student's own sections, or a guardian's children's.

        ``Student.filter_owned_by_user`` is the single place that knows what
        "own" means for both principals — a student's own row by `user_id`, and
        a guardian's children through `student_guardians` honouring
        `has_portal_access`. Re-deriving the guardian join here would be a second
        copy of an access rule, and the copy that gets left behind when the rule
        changes is the one that leaks.
        """
        students = Student.filter_owned_by_user(Student.objects.alive(), self.request.user)
        section_ids = list(
            StudentEnrollment.objects.alive()
            .filter(
                student__in=students,
                academic_session=session,
                status=EnrollmentStatus.ACTIVE,
            )
            .values_list("section_id", flat=True)
        )
        return services.effective_slots_for(
            session=session, section_ids=section_ids, on_date=on_date
        )


class TeacherSubstitutionViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`teacher_substitutions` — dated teacher overrides (§7.2).

    No PATCH and no DELETE: §16 lists neither, and a substitution's only mutable
    state is its approval, which moves through `:approve` / `:reject` so the
    already-decided guard and the notification cannot be bypassed.
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = TeacherSubstitution.objects
    serializer_class = TeacherSubstitutionSerializer
    filterset_class = TeacherSubstitutionFilterSet
    # The two staff columns sort on surname, which is what the client shows first and
    # the only half of a name a list is worth ordering by.
    #
    # `created_at` is the only entry with an index an ORDER BY can walk. `date` is the
    # tail of (tenant, substitute_staff, date) and (tenant, absent_staff, date), so it
    # is not a usable prefix on its own; `status` has no index; both surnames are
    # joined. Those four sort the tenant's substitutions in memory — bounded by a
    # school's cover history for one session, not by anything that grows without limit.
    ordering_fields = [
        "date",
        "status",
        "absent_staff_last_name",
        "substitute_staff_last_name",
        "created_at",
    ]
    ordering_annotations = ("absent_staff_last_name", "substitute_staff_last_name")
    # TeacherSubstitution.Meta.ordering; see RoomViewSet for why the view repeats it.
    ordering = ["-date"]
    # Page numbers, not a cursor: this list is bounded by one school's size and a
    # reader navigates it by position. api-architecture.md §2.4.
    pagination_class = PageNumberPagination
    # §4 declares no substitution view key either; the same reasoning as periods
    # and rooms applies (module docstring). "own" is the substitute's own cover
    # list — the person who has to act on it.
    scope_own_field = "substitute_staff__user_id"
    scope_campus_field = "timetable_slot__section__campus_id"
    required_feature = FEATURE
    required_permission = SCAFFOLDING_VIEW_KEY
    required_permission_map = {
        "create": "timetable.substitution.create",
        "approve": "timetable.substitution.approve",
        "reject": "timetable.substitution.approve",
    }
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        """The two surnames are annotated, not traversed — see `RoomViewSet` for why
        that holds even where nothing produces a ``.distinct()`` yet.

        ``scope_own_field`` here is a plain forward join (`substitute_staff__user_id`),
        so today an own-scoped substitute's queryset is not distinct; `PeriodViewSet`
        and `StudentViewSet` are where the hazard actually bites. Both staff FKs are
        non-null, so these annotations reuse the inner joins ``select_related`` already
        opens.
        """
        return (
            super()
            .get_queryset()
            .select_related(
                "timetable_slot",
                "timetable_slot__section",
                "timetable_slot__period",
                "absent_staff",
                "substitute_staff",
            )
            .annotate(
                absent_staff_last_name=F("absent_staff__last_name"),
                substitute_staff_last_name=F("substitute_staff__last_name"),
            )
        )

    @extend_schema(
        summary="Propose a substitution for one published slot",
        responses={
            201: TeacherSubstitutionSerializer,
            422: OpenApiResponse(
                description="§11: wrong absentee, wrong weekday, or the substitute is not free."
            ),
        },
    )
    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        substitution = services.create_substitution(
            slot=data["timetable_slot"],
            on_date=data["date"],
            absent_staff=data["absent_staff"],
            substitute_staff=data["substitute_staff"],
            reason=data.get("reason"),
            room=data.get("room"),
            tenant_id=request.tenant.pk,
            actor_id=request.user.pk,
        )
        body = self.get_serializer(substitution).data
        record_audit(request, "create", substitution, after=body)
        return ActionResponse.ok(body, message="Substitution proposed.", status=201)

    @extend_schema(
        summary="Approve a proposed substitution",
        request=None,
        responses={200: TeacherSubstitutionSerializer},
    )
    def approve(self, request: Request, pk) -> Response:
        return self._decide(request, pk, approve=True, message="Substitution confirmed.")

    @extend_schema(
        summary="Reject a proposed substitution",
        request=None,
        responses={200: TeacherSubstitutionSerializer},
    )
    def reject(self, request: Request, pk) -> Response:
        return self._decide(request, pk, approve=False, message="Substitution declined.")

    def _decide(self, request: Request, pk, *, approve: bool, message: str) -> Response:
        """Both decisions are one service call — §7.2 has no asymmetry between them."""
        substitution = get_object_or_404(self.get_queryset(), pk=pk)
        before = self.get_serializer(substitution).data

        decided = services.decide_substitution(
            substitution=substitution, approve=approve, actor_id=request.user.pk
        )
        after = self.get_serializer(decided).data
        record_audit(
            request,
            "approve" if approve else "reject",
            decided,
            before=before,
            after=after,
        )
        return ActionResponse.ok(after, message=message)
