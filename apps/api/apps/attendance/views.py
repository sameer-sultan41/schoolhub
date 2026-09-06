"""HTTP layer for the attendance module.

Thin by design: every rule that needs more than the request body lives in
``services``, so the API, §9's historical importer and the leave module's
auto-marking all apply the same checks.

**`DenyRestrictedPrincipals` is per-action here, and that is new.** Every module
before this one keeps students and guardians off all of its endpoints. §4 grants
both an `own`-scoped `attendance.student-attendance.view` — a student sees their
own attendance, a guardian their children's — so ``StudentAttendanceViewSet``
drops the guard **for reads only** and lets the record scope do that narrowing,
through ``StudentAttendance.filter_owned_by_user``.

**Its write action keeps the guard** (``get_permissions``). A viewset-wide
exemption covered ``:bulk-mark`` as well, and marking is not a scoped read of
one child's row — it writes a whole section's register. §4 grants
`attendance.student-attendance.mark` to `teacher`/`class_teacher` only, so a
restricted principal holding it is already a misconfiguration; the point is that
it should not also be an escalation. `assert_marker_may_mark_section` cannot
close this on its own: it returns early for `RecordScope.ALL`/`CAMPUS`, which is
correct for an admin (many admin users have no `Staff` row at all, so requiring
one would break the legitimate case) and is exactly why the principal check has
to sit in front of it rather than inside it.

The correction viewset keeps the guard on every action: §4 grants
`attendance.correction.*` to staff only.

**Rows are not created through `POST /student-attendance`.** §16 declares the
list and `:bulk-mark`, and nothing else — a register is submitted for a section
and a date, not a row at a time, and a per-row create would bypass the enrolment,
calendar and duplicate checks the bulk path exists to apply. The viewset is
therefore list+retrieve only.

**Not built: `attendance.student-attendance.import`.** §9 names a CSV import of
historical attendance for tenant onboarding and marks its permission key a
*recommendation*; §4's table does not declare the key and §16 declares no
endpoint. Building it would mean inventing both. `AttendanceSource.IMPORT` is
reserved for it (models.py).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.attendance import services
from apps.attendance.filters import (
    AttendanceCorrectionFilterSet,
    LeaveRequestFilterSet,
    LeaveTypeFilterSet,
    StaffAttendanceFilterSet,
    StudentAttendanceFilterSet,
)
from apps.attendance.models import (
    AttendanceCorrection,
    DayPart,
    LeaveRequest,
    LeaveType,
    RequesterType,
    StaffAttendance,
    StudentAttendance,
)
from apps.attendance.serializers import (
    AttendanceCorrectionSerializer,
    AttendanceReportQuerySerializer,
    BulkMarkSerializer,
    CorrectionDecisionSerializer,
    LeaveDecisionSerializer,
    LeaveRequestSerializer,
    LeaveTypeSerializer,
    StaffAttendanceSerializer,
    StaffCheckOutSerializer,
    StudentAttendanceSerializer,
)
from apps.school_organization.models import AcademicSession
from core.api.exceptions import DomainRuleViolation
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.idempotency.services import replay_or_execute
from core.rbac.permissions import DenyRestrictedPrincipals, HasPermissionKey

if TYPE_CHECKING:
    from rest_framework.request import Request

FEATURE = "module.attendance"

STAFF_PERMISSIONS = [
    IsAuthenticated,
    RequiresModuleFeature,
    HasPermissionKey,
    DenyRestrictedPrincipals,
]

# Students and guardians reach this one, and only this one — see the module
# docstring. The record scope, not the permission class, is what narrows them.
PORTAL_READABLE_PERMISSIONS = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]


def _resolve_session(session: AcademicSession | None) -> AcademicSession:
    """Fall back to the tenant's current session when the caller names none.

    A school runs one session at a time and the register UI has no reason to
    carry its id around, but "no current session" is a real configuration state
    — so it is a 422 naming the field rather than an AttributeError later. Same
    shape as timetable/views.py's own resolver.
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


class StudentAttendanceViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`student_attendance` — the register (§5.1), read here and written by `:bulk-mark`.

    Cursor paginated, per §16 — the project default
    (``DEFAULT_PAGINATION_CLASS``), so nothing is declared here. No
    ``CountedCursorPagination``: this is the append-heavy table cursor pagination
    exists to serve (core/api/pagination.py names it), and a `COUNT(*)` over a
    term of registers on every page is exactly the cost it was chosen to avoid.
    """

    permission_classes = PORTAL_READABLE_PERMISSIONS
    queryset = StudentAttendance.objects
    serializer_class = StudentAttendanceSerializer
    filterset_class = StudentAttendanceFilterSet
    search_fields = ["remarks"]
    ordering_fields = ["attendance_date", "created_at"]
    # `own` here means "a student's own rows, or a guardian's children's", which
    # is two joins and not one column — StudentAttendance.filter_owned_by_user
    # owns it and takes precedence over this fallback, which is left None so a
    # mistaken single-column reading cannot silently apply instead.
    scope_own_field = None
    scope_campus_field = "section__campus_id"
    required_feature = FEATURE
    required_permission = "attendance.student-attendance.view"
    required_permission_map = {"bulk_mark": "attendance.student-attendance.mark"}
    http_method_names = ["get", "post", "head", "options"]

    # Reads are open to restricted principals (§4 grants them an `own`-scoped
    # view); writes are not. Anything not named here is a read.
    STAFF_ONLY_ACTIONS = frozenset({"bulk_mark"})

    def get_permissions(self):
        """Add `DenyRestrictedPrincipals` to the write action only.

        DRF resolves `permission_classes` per view, not per action, so a viewset
        that serves both a portal read and a staff write has to choose here. See
        the module docstring for why marking cannot rely on the service check
        alone.
        """
        if self.action in self.STAFF_ONLY_ACTIONS:
            return [permission() for permission in STAFF_PERMISSIONS]
        return super().get_permissions()

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .select_related("student", "section", "academic_session", "period")
        )

    @extend_schema(
        summary="Mark a section's register for one date",
        request=BulkMarkSerializer,
        responses={
            200: OpenApiResponse(
                response=StudentAttendanceSerializer(many=True),
                description="The marked rows, plus `meta.marked`/`meta.updated` counts.",
            )
        },
    )
    def bulk_mark(self, request: Request) -> Response:
        """`POST /student-attendance:bulk-mark` (§16).

        Wrapped in ``replay_or_execute`` because §6's "offline-tolerant
        re-submission" is precisely what ``Idempotency-Key`` is for: a teacher's
        phone that times out and retries gets the first response back rather than
        re-running the upsert. The upsert makes the retry safe either way — this
        makes it *identical*, which is what a client comparing counts needs.
        """
        serializer = BulkMarkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        section = self._scoped_section(payload["section"].pk)
        session = _resolve_session(payload.get("academic_session"))
        services.assert_marker_may_mark_section(user=request.user, section=section)

        def execute() -> Response:
            result = services.bulk_mark_student_attendance(
                section=section,
                session=session,
                on_date=payload["attendance_date"],
                period=payload.get("period"),
                entries=payload["entries"],
                actor_id=request.user.pk,
            )
            rows = StudentAttendanceSerializer(result["rows"], many=True).data
            for row in result["rows"]:
                record_audit(request, "mark", row)
            return Response(
                {
                    "data": rows,
                    "meta": {
                        "marked": result["marked"],
                        "updated": result["updated"],
                        "alerts_queued": len(result["alerts"]),
                    },
                },
                status=200,
            )

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="student-attendance:bulk-mark",
            execute=execute,
        )

    def _scoped_section(self, pk):
        """Resolve the section under the caller's record scope.

        Through the scoped queryset rather than a bare manager lookup: a
        campus-scoped admin must not mark another campus's register, and the
        tenant-scoped manager alone would let them. A section they cannot reach
        is a 404, never a 403 (AGENTS.md invariant 2).
        """
        from apps.school_organization.models import Section
        from core.rbac.permissions import scope_queryset

        return get_object_or_404(
            scope_queryset(Section.objects.alive(), self.request.user, campus_field="campus_id"),
            pk=pk,
        )


class AttendanceCorrectionViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """`attendance_corrections` — request a change to a locked row, and decide it (§5.5).

    Append-only from the API's point of view: §16 declares list, create and the
    two decisions, and nothing else. A correction is not edited after the fact —
    that is the whole reason it exists as a row rather than as a direct update.
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = AttendanceCorrection.objects
    serializer_class = AttendanceCorrectionSerializer
    filterset_class = AttendanceCorrectionFilterSet
    ordering_fields = ["created_at", "status"]
    scope_campus_field = "student_attendance__section__campus_id"
    required_feature = FEATURE
    required_permission = "attendance.correction.create"
    required_permission_map = {
        "list": "attendance.correction.create",
        "retrieve": "attendance.correction.create",
        "create": "attendance.correction.create",
        "approve": "attendance.correction.approve",
        "reject": "attendance.correction.approve",
    }
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().select_related("student_attendance")

    @extend_schema(
        summary="Request a correction to a locked attendance record",
        responses={201: AttendanceCorrectionSerializer},
    )
    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        correction = services.request_correction(
            target=serializer.validated_data["student_attendance"],
            new_values=serializer.validated_data["new_values"],
            reason=serializer.validated_data["reason"],
            actor_id=request.user.pk,
        )
        body = self.get_serializer(correction).data
        record_audit(request, "create", correction, after=body)
        return Response({"data": body}, status=201)

    @extend_schema(
        summary="Approve a correction request",
        request=CorrectionDecisionSerializer,
        responses={200: AttendanceCorrectionSerializer},
    )
    def approve(self, request: Request, pk) -> Response:
        return self._decide(request, pk, approve=True, message="Correction applied.")

    @extend_schema(
        summary="Reject a correction request",
        request=CorrectionDecisionSerializer,
        responses={200: AttendanceCorrectionSerializer},
    )
    def reject(self, request: Request, pk) -> Response:
        return self._decide(request, pk, approve=False, message="Correction rejected.")

    def _decide(self, request: Request, pk, *, approve: bool, message: str) -> Response:
        """Both decisions are one service call — §7 draws no asymmetry between them."""
        correction = get_object_or_404(self.get_queryset(), pk=pk)
        body = CorrectionDecisionSerializer(data=request.data)
        body.is_valid(raise_exception=True)

        before = self.get_serializer(correction).data
        decided = services.decide_correction(
            correction=correction,
            approve=approve,
            reviewer_id=request.user.pk,
            note=body.validated_data.get("review_note"),
        )
        after = self.get_serializer(decided).data
        record_audit(
            request, "approve" if approve else "reject", decided, before=before, after=after
        )
        return ActionResponse.ok(after, message=message)


class LeaveTypeViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`leave_types` — **read-only here**, and the reason is a spec conflict worth stating.

    §16 of this module lists `GET/POST/PATCH /api/v1/leave-types` (and
    `/leave-policies`, `/leave-balances`). §4 of this module declares **no
    permission key for any of them** — its table has keys for attendance,
    corrections, leave *requests* and reports, and nothing else. The keys that do
    govern them are `hr.leave-type.*`, `hr.leave-policy.*` and
    `hr.leave-balance.*`, declared by `hr-leave.md` §4.

    Registering another module's `hr.*` keys from this app would break the
    registry the day hr-leave ships its own `permissions.py` (duplicate key), and
    inventing `attendance.leave-type.*` would put keys in the registry that no
    module doc declares — the thing `timetable/views.py`'s docstring explicitly
    refuses to do. So the split is by *what §4 can key*:

    - **Reading** the catalogue is part of working with leave requests, so this
      list takes `attendance.leave-request.view`. That is exactly the move
      `timetable` makes for `/periods` and `/rooms`, which §4 there also leaves
      unkeyed: reading the scaffolding falls under the key for the thing it is
      scaffolding for. `.view` rather than `.create`, because §4 grants `.view`
      to requesters *and* approvers — an approver reading a request needs the
      type's name, and a key only requesters hold would have hidden it from the
      one person who has to decide.
    - **Writing** leave types, and the whole of `/leave-policies` and
      `/leave-balances`, is HR configuration and ships with hr-leave (Tier 6),
      which "adds no tables" precisely because this module's migration created
      them.

    The consequence is real and recorded in the module doc's §20: until hr-leave
    lands, a tenant's leave types come from the seeds rather than from the API.
    """

    permission_classes = PORTAL_READABLE_PERMISSIONS
    queryset = LeaveType.objects
    serializer_class = LeaveTypeSerializer
    filterset_class = LeaveTypeFilterSet
    search_fields = ["name", "code"]
    ordering_fields = ["name", "code"]
    # A leave type is school-wide configuration with no campus dimension, the
    # same shape as `/classes` and `/subjects`. Left at the default `campus_id`
    # this raises FieldError for every campus-scoped caller.
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "attendance.leave-request.view"
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        """Reference data has no owner, so record scope does not apply to it.

        `scope_queryset` falls through to `.none()` for an `own`-scoped principal
        when the model defines no `filter_owned_by_user` — which is right for a
        *record* and wrong for a *catalogue*. A guardian holds
        `attendance.leave-request.view` at `RecordScope.OWN`, and narrowing the
        list of leave types by ownership returned nothing at all: the submission
        form had no types to choose from, and nothing errored.

        Same reasoning `scope_campus_field = None` already carries one line up —
        a scope over a table with no such dimension is already satisfied by
        tenant scoping — extended to `own`. Stated here rather than solved by
        giving `LeaveType` a `filter_owned_by_user` that returns everything,
        which would be the same decision written as if it were a rule about
        ownership.
        """
        return self.queryset.alive()


class LeaveRequestViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """`leave_requests` — the **student** half (§5.4, §7.2).

    Like `StudentAttendanceViewSet`, this omits `DenyRestrictedPrincipals`: §4
    grants `attendance.leave-request.create` to `student` and `guardian`, and the
    record scope — `LeaveRequest.filter_owned_by_user`, which delegates to
    `Student.filter_owned_by_user` — is what keeps a guardian to their own
    children.

    **Staff leave requests are not served here.** The table holds both kinds
    because `hr-leave` §15 and `attendance` §15 describe one table, but staff
    leave is keyed `hr.leave-request.*` in a namespace this module must not
    register on another's behalf. Every write here sets
    `requester_type = student`, and the queryset is filtered to student requests
    so an `all`-scoped principal cannot read staff leave through an
    attendance-keyed endpoint before hr-leave has decided its visibility rules.

    No PATCH: §16 declares list, create and the three colon-actions. Editing a
    pending request in place would move dates an approver had already seen.
    """

    permission_classes = PORTAL_READABLE_PERMISSIONS
    queryset = LeaveRequest.objects
    serializer_class = LeaveRequestSerializer
    filterset_class = LeaveRequestFilterSet
    search_fields = ["reason"]
    ordering_fields = ["start_date", "created_at", "status"]
    scope_own_field = None  # the guardian union lives in the model hook
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "attendance.leave-request.view"
    required_permission_map = {
        "create": "attendance.leave-request.create",
        "approve": "attendance.leave-request.approve",
        "reject": "attendance.leave-request.approve",
        # §6 puts cancellation with the requester, not the approver: "cancellation
        # allowed until start date" is the guardian withdrawing their own ask.
        "cancel": "attendance.leave-request.create",
    }
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(requester_type=RequesterType.STUDENT)
            .select_related("student", "leave_type")
            .prefetch_related("approvals")
        )

    @extend_schema(
        summary="Submit a student leave request",
        responses={201: LeaveRequestSerializer},
    )
    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        leave_request = services.submit_leave_request(
            student=data["student"],
            leave_type=data["leave_type"],
            start_date=data["start_date"],
            end_date=data["end_date"],
            day_part=data.get("day_part", DayPart.FULL),
            reason=data["reason"],
            attachment_file=data.get("attachment_file"),
            submitted_by=request.user.pk,
            requesting_user=request.user,
        )
        body = self.get_serializer(leave_request).data
        record_audit(request, "create", leave_request, after=body)
        return Response({"data": body}, status=201)

    @extend_schema(
        summary="Approve the current step of a leave request",
        request=LeaveDecisionSerializer,
        responses={200: LeaveRequestSerializer},
    )
    def approve(self, request: Request, pk) -> Response:
        return self._decide(request, pk, approve=True)

    @extend_schema(
        summary="Reject a leave request",
        request=LeaveDecisionSerializer,
        responses={200: LeaveRequestSerializer},
    )
    def reject(self, request: Request, pk) -> Response:
        return self._decide(request, pk, approve=False)

    @extend_schema(
        summary="Cancel a leave request before it starts",
        request=None,
        responses={200: LeaveRequestSerializer},
    )
    def cancel(self, request: Request, pk) -> Response:
        leave_request = get_object_or_404(self.get_queryset(), pk=pk)
        before = self.get_serializer(leave_request).data

        cancelled = services.cancel_leave_request(request=leave_request, actor_id=request.user.pk)
        after = self.get_serializer(cancelled).data
        record_audit(request, "update", cancelled, before=before, after=after)
        return ActionResponse.ok(after, message="Leave request cancelled.")

    def _decide(self, request: Request, pk, *, approve: bool) -> Response:
        """Both decisions are one service call — §7.2 draws no asymmetry.

        The response reports how many days were auto-marked, because §7.2's
        "dates auto-marked on_leave" can legitimately mark fewer days than the
        request covers: a date the teacher already marked is left alone, and a
        holiday inside the range was never a school day. An approver who is told
        only "approved" has no way to notice the difference.
        """
        leave_request = get_object_or_404(self.get_queryset(), pk=pk)
        body = LeaveDecisionSerializer(data=request.data)
        body.is_valid(raise_exception=True)

        before = self.get_serializer(leave_request).data
        decided = services.decide_leave_step(
            request=leave_request,
            approve=approve,
            approver_id=request.user.pk,
            note=body.validated_data.get("note"),
        )
        after = self.get_serializer(decided).data
        record_audit(
            request, "approve" if approve else "reject", decided, before=before, after=after
        )
        marked = decided.student_attendance.alive().count() if approve else 0
        return Response(
            {"data": after, "meta": {"auto_marked_days": marked}},
            status=200,
        )


class StaffAttendanceViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """`staff_attendance` — §5.2, and §16's `POST /staff-attendance` + `:check-out`.

    `DenyRestrictedPrincipals` on every action, unlike the student register: §4
    grants `attendance.staff-attendance.view` to "every staff role (own)" and to
    no restricted principal at all. A student has no business reading a teacher's
    arrival time.

    That "every staff role (own)" is the widest `own` grant on the platform, and
    it is why `POST` is keyed separately: reading your own punctuality and
    recording someone else's are different acts, and §4 keys the second to
    `hr_staff`/`school_admin`.

    **Self check-in is `source="self"`, and only for yourself.** §5.2 allows a
    staff member to record their own arrival, which no student may do; recording
    it as `manual` would make §13's report unable to tell a self-report from an
    HR-verified one.
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = StaffAttendance.objects
    serializer_class = StaffAttendanceSerializer
    filterset_class = StaffAttendanceFilterSet
    search_fields = ["remarks"]
    ordering_fields = ["attendance_date", "created_at"]
    # `own` is a join through `staff.user_id`, not a column here — the model hook
    # owns it and takes precedence over this fallback.
    scope_own_field = None
    scope_campus_field = "staff__campus_id"
    required_feature = FEATURE
    required_permission = "attendance.staff-attendance.view"
    required_permission_map = {
        "create": "attendance.staff-attendance.mark",
        "check_out": "attendance.staff-attendance.mark",
    }
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().select_related("staff")

    @extend_schema(
        summary="Record a staff member's attendance for a date",
        responses={201: StaffAttendanceSerializer},
    )
    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        row = services.mark_staff_attendance(
            staff=data["staff"],
            on_date=data["attendance_date"],
            status=data["status"],
            check_in_time=data.get("check_in_time"),
            check_out_time=data.get("check_out_time"),
            remarks=data.get("remarks"),
            source=self._source_for(request, staff=data["staff"]),
            actor_id=request.user.pk,
        )
        body = self.get_serializer(row).data
        record_audit(request, "mark", row, after=body)
        return Response({"data": body}, status=201)

    @extend_schema(
        summary="Record a staff member's departure",
        request=StaffCheckOutSerializer,
        responses={200: StaffAttendanceSerializer},
    )
    def check_out(self, request: Request, pk) -> Response:
        row = get_object_or_404(self.get_queryset(), pk=pk)
        body = StaffCheckOutSerializer(data=request.data)
        body.is_valid(raise_exception=True)

        before = self.get_serializer(row).data
        updated = services.check_out_staff(
            row=row,
            check_out_time=body.validated_data["check_out_time"],
            actor_id=request.user.pk,
        )
        after = self.get_serializer(updated).data
        record_audit(request, "update", updated, before=before, after=after)
        return ActionResponse.ok(after, message="Check-out recorded.")

    @staticmethod
    def _source_for(request: Request, *, staff) -> str:
        """`self` when the caller is the staff member, `manual` otherwise (§5.2).

        Derived rather than accepted from the body: a client that could name its
        own source could record an HR-verified arrival as a self check-in, or the
        reverse, and §13's punctuality report is a payroll input.
        """
        from apps.attendance.models import StaffAttendanceSource

        if staff.user_id and staff.user_id == request.user.pk:
            return StaffAttendanceSource.SELF
        return StaffAttendanceSource.MANUAL


class AttendanceReportView(TenantScopedViewSetMixin, APIView):
    """`GET /api/v1/reports/attendance-summary` — §13's six reports (§16).

    **One endpoint with a `kind`, not six routes.** §16 declares exactly one
    report URL, and the six differ in their rows rather than their shape: every
    one is a flat list under a date range and a record scope.

    **Small results come back inline; large ones return 202 and a job**
    (api-architecture.md §2.7). The threshold is on row count rather than on the
    report kind, because the same kind is both: a daily register is one section's
    day, and the same query over a term is students x days.

    Record scope is applied by `tasks.build_report_rows`, which the export job
    calls too — so an exported CSV can never show more than the requester could
    read inline. §13's closing line makes that a requirement, and a report is
    read as authoritative, which is exactly why it is the worst place to lose a
    scope.
    """

    permission_classes = STAFF_PERMISSIONS
    required_feature = FEATURE
    required_permission = "attendance.report.view"
    required_permission_map = {"post": "attendance.report.export"}
    serializer_class = AttendanceReportQuerySerializer

    @extend_schema(
        summary="Run an attendance report",
        parameters=[AttendanceReportQuerySerializer],
        responses={200: OpenApiResponse(description="The report's rows, under `data`.")},
    )
    def get(self, request: Request) -> Response:
        query = AttendanceReportQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        params = query.validated_data

        rows = self._rows(request, params)
        if len(rows) > services.SYNCHRONOUS_REPORT_ROW_LIMIT:
            return self._queue_export(request, params, reason="too many rows to return inline")

        return Response(
            {
                "data": rows,
                "meta": {"kind": params["kind"], "row_count": len(rows)},
            }
        )

    @extend_schema(
        summary="Export an attendance report as CSV",
        request=AttendanceReportQuerySerializer,
        responses={202: OpenApiResponse(description="A job resource; poll GET /jobs/{id}.")},
    )
    def post(self, request: Request) -> Response:
        """Always a job, however small.

        §13 lists export as its own capability and §4 keys it separately
        (`attendance.report.export`), so an export is a deliberate act with its
        own permission — not "the same report, but bigger". Returning the bytes
        inline for a small one would make the two paths differ by size, which is
        the distinction the *reader* least expects.
        """
        query = AttendanceReportQuerySerializer(data=request.data)
        query.is_valid(raise_exception=True)
        return self._queue_export(request, query.validated_data, reason="export requested")

    @staticmethod
    def _rows(request: Request, params: dict) -> list[dict]:
        from apps.attendance.tasks import build_report_rows

        return build_report_rows(
            kind=params["kind"],
            user=request.user,
            start_date=params["start_date"],
            end_date=params["end_date"],
            section_id=str(params["section_id"]) if params.get("section_id") else None,
        )

    @staticmethod
    def _queue_export(request: Request, params: dict, *, reason: str) -> Response:
        from apps.attendance.tasks import export_attendance_report_task
        from core.jobs.services import create_job

        job = create_job(
            tenant_id=request.tenant.pk,
            job_type="attendance.report-export",
            payload={
                "kind": params["kind"],
                "start_date": params["start_date"].isoformat(),
                "end_date": params["end_date"].isoformat(),
                "section_id": str(params["section_id"]) if params.get("section_id") else None,
                # The *requester*, so the job rebuilds the same record scope. Not
                # the actor of the moment the worker runs, which is nobody.
                "requested_by": str(request.user.pk),
            },
            actor_id=request.user.pk,
        )
        transaction.on_commit(
            lambda: export_attendance_report_task.delay(
                tenant_id=str(request.tenant.pk),
                job_id=str(job.pk),
                actor_id=str(request.user.pk),
            )
        )
        record_audit(request, "export", job)
        return ActionResponse.accepted(str(job.pk), message=f"Report queued: {reason}.")
