"""Models for the attendance module.

Behaviour: docs/03-modules/attendance.md. Column-level specs:
docs/05-database/entities/attendance.md.

**The two partial unique indexes on `student_attendance` are this module's
spine.** §11 says "one attendance row per student per date (per period when
period mode is on)", which reads like one constraint and is two. A single unique
index on `(tenant, student, attendance_date, period)` would enforce neither half:
PostgreSQL treats NULLs as distinct, so daily rows — where `period_id IS NULL` —
could be inserted twice over and nothing would notice. Splitting on
`period_id IS NULL` is what makes both readings true at the database, and it is
also what lets a tenant that switches to period mode mid-session keep its daily
history rather than having to choose one shape for the whole year.

They are at the database rather than only in the service for the reason
`timetable_slots` carries its three: §6 requires marking to be "offline-tolerant"
and idempotent, which means a teacher's phone genuinely does re-submit the same
register, sometimes twice within the same second from two devices. Both pass a
service-level `.exists()` check and only one can win the insert.

Nullable string columns below are NULL-not-blank by design — see
school_organization/models.py's header for why — hence the blanket DJ001
suppression.
"""
# ruff: noqa: DJ001

from __future__ import annotations

from django.db import models

from core.tenancy.models import TenantOwnedModel


class AttendanceStatus(models.TextChoices):
    """§5.1's six student statuses.

    `on_leave` is never marked by hand: it is written by the leave module when a
    request is approved, and the row then carries `leave_request_id` back to it.
    """

    PRESENT = "present", "Present"
    ABSENT = "absent", "Absent"
    LATE = "late", "Late"
    HALF_DAY = "half_day", "Half day"
    EXCUSED = "excused", "Excused"
    ON_LEAVE = "on_leave", "On leave"


class AttendanceSource(models.TextChoices):
    """How the row got here.

    `device` is declared and **unreachable today**. §6 and §21 both reserve it
    for biometric/RFID ingestion, and the entity doc says the column exists
    precisely so that arrives without a schema change. Nothing writes it, and
    this says so rather than leaving a reader to infer an integration from an
    enum. `import` waits on §9's historical-attendance CSV import, which needs
    the `attendance.student-attendance.import` key §9 marks as a recommendation
    and §4 does not declare — so that one waits on the module doc, not on code.
    """

    MANUAL = "manual", "Manual"
    SYSTEM = "system", "System"
    IMPORT = "import", "Import"
    DEVICE = "device", "Device"


class CorrectionSubjectType(models.TextChoices):
    STUDENT = "student", "Student"
    STAFF = "staff", "Staff"


class CorrectionStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    CANCELLED = "cancelled", "Cancelled"


class StudentAttendance(TenantOwnedModel):
    """One student's presence on one date, or in one period of it.

    `section` is stored rather than resolved through the enrollment on read
    because it is the section **at the time of marking** (entity doc). A student
    who changes section in March must not have February's register silently
    re-attributed to the new one, which is exactly what joining live through
    `student_enrollments` would do.
    """

    student = models.ForeignKey(
        "student_management.Student", on_delete=models.PROTECT, related_name="attendance"
    )
    section = models.ForeignKey(
        "school_organization.Section",
        on_delete=models.PROTECT,
        related_name="student_attendance",
        help_text="The section at the time of marking, not the student's current one.",
    )
    academic_session = models.ForeignKey(
        "school_organization.AcademicSession",
        on_delete=models.PROTECT,
        related_name="student_attendance",
    )
    period = models.ForeignKey(
        "timetable.Period",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="student_attendance",
        help_text="Null = daily attendance. Set only when the tenant runs period mode.",
    )
    attendance_date = models.DateField(help_text="Calendar date in the tenant's timezone.")
    status = models.CharField(max_length=20, choices=AttendanceStatus.choices)
    check_in_time = models.TimeField(null=True, blank=True, help_text="Set for a late arrival.")
    check_out_time = models.TimeField(
        null=True, blank=True, help_text="Set for an early departure or a half day."
    )
    late_minutes = models.IntegerField(
        null=True,
        blank=True,
        help_text="Computed server-side from the tenant day window (§11); never client-supplied.",
    )
    leave_request = models.ForeignKey(
        "attendance.LeaveRequest",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="student_attendance",
        db_column="leave_request_id",
        help_text="Set when status is on_leave; written by the leave module, never marked.",
    )
    source = models.CharField(
        max_length=20, choices=AttendanceSource.choices, default=AttendanceSource.MANUAL
    )
    marked_by = models.UUIDField(help_text="users(id) — the marking actor.")
    is_locked = models.BooleanField(
        default=False, help_text="True past the lock window; changes then need a correction (§5.5)."
    )
    remarks = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        db_table = "student_attendance"
        ordering = ["-attendance_date"]
        constraints = [
            # Two disjoint partial indexes, not one constraint over four columns.
            # See the module docstring: NULLs are distinct in PostgreSQL, so a
            # single index would enforce neither "one row per day" nor "one row
            # per period", and a tenant switching to period mode mid-session
            # would have to abandon its daily history.
            models.UniqueConstraint(
                fields=["tenant", "student", "attendance_date"],
                name="student_attendance_one_per_day",
                condition=models.Q(period__isnull=True, deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "student", "attendance_date", "period"],
                name="student_attendance_one_per_period",
                condition=models.Q(period__isnull=False, deleted_at__isnull=True),
            ),
            models.CheckConstraint(
                condition=models.Q(late_minutes__isnull=True) | models.Q(late_minutes__gte=0),
                name="student_attendance_late_minutes_not_negative",
            ),
        ]
        indexes = [
            # §13's daily register: one section, one date.
            models.Index(
                fields=["tenant", "section", "attendance_date"], name="stu_att_section_date_idx"
            ),
            # §13's defaulter and absence-rate reports: one date, one status.
            models.Index(
                fields=["tenant", "attendance_date", "status"], name="stu_att_date_status_idx"
            ),
            # §13's per-student summary over a session or term.
            models.Index(
                fields=["tenant", "student", "attendance_date"], name="stu_att_student_date_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.student_id} on {self.attendance_date}: {self.status}"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — a student's own rows, a guardian's children's.

        Delegates to ``Student.filter_owned_by_user`` rather than restating the
        guardian join. That hook already unions the student's own row with the
        children they hold a live, **portal-enabled** `student_guardians` link
        to, and a second copy of that predicate here would be a second place for
        revoked portal access to be forgotten — which is the precise bug PR 0
        fixed when `own` was `user_id ==` and nothing else.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()

        from apps.student_management.models import Student

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        return queryset.filter(student__in=visible)

    @classmethod
    def filter_assigned_to_user(cls, queryset, user):
        """Record scope `assigned` — a class teacher's own sections.

        The same join ``Student.filter_assigned_to_user`` uses
        (`section.class_teacher_staff_id -> staff.user_id`), applied to this
        table's own `section_id` rather than reached through an enrollment: an
        attendance row already records the section it was marked in, so going
        back through `student_enrollments` would both cost a join and answer for
        the student's *current* section instead of the marked one.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()

        from apps.staff_management.models import EmploymentStatus, Staff

        staff_ids = (
            Staff.objects.alive()
            .filter(user_id=user.pk, employment_status=EmploymentStatus.ACTIVE)
            .values_list("pk", flat=True)
        )
        return queryset.filter(section__class_teacher_staff_id__in=staff_ids)


class AttendanceCorrection(TenantOwnedModel):
    """A requested change to a locked attendance row, and its approval outcome.

    An approved correction updates the target row **and stays**: §6 makes the row
    itself the audit trail, so it is never deleted and never rewritten into the
    target. `old_values`/`new_values` are snapshots rather than a diff so the
    before-state survives even if the target is corrected again later.

    **Exactly one target**, which is now genuinely a choice of two: the marking PR
    shipped this table with only `student_attendance` to point at and a CHECK that
    said so, and the staff PR widens both. `subject_type` says which without a
    join, because an approver's queue renders the two differently and should not
    have to test two nullable columns to find out.
    """

    subject_type = models.CharField(max_length=10, choices=CorrectionSubjectType.choices)
    student_attendance = models.ForeignKey(
        StudentAttendance,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="corrections",
    )
    staff_attendance = models.ForeignKey(
        "attendance.StaffAttendance",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="corrections",
    )
    requested_by = models.UUIDField(help_text="users(id).")
    old_values = models.JSONField(help_text="Status and times before the change.")
    new_values = models.JSONField(help_text="Proposed status and times.")
    reason = models.CharField(max_length=500, help_text="Mandatory justification (§6).")
    status = models.CharField(
        max_length=20, choices=CorrectionStatus.choices, default=CorrectionStatus.PENDING
    )
    reviewed_by = models.UUIDField(
        null=True, blank=True, help_text="users(id); must differ from requested_by (§11)."
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.CharField(max_length=500, null=True, blank=True)

    class Meta:
        db_table = "attendance_corrections"
        ordering = ["-created_at"]
        constraints = [
            # Exactly one target. Both set would make "which row does approval
            # update?" undefined; neither set would make the correction point at
            # nothing and still be approvable. This replaces the marking PR's
            # narrower pair, which asserted the same rule for the one target that
            # existed then.
            models.CheckConstraint(
                condition=(
                    models.Q(student_attendance__isnull=False, staff_attendance__isnull=True)
                    | models.Q(student_attendance__isnull=True, staff_attendance__isnull=False)
                ),
                name="attendance_corrections_exactly_one_target",
            ),
            # `subject_type` must agree with the column that is set, or the
            # denormalised discriminator is a second source of truth that can
            # disagree with the first — and it is the one an approver's queue
            # filters on.
            models.CheckConstraint(
                condition=(
                    models.Q(subject_type="student", student_attendance__isnull=False)
                    | models.Q(subject_type="staff", staff_attendance__isnull=False)
                ),
                name="attendance_corrections_subject_type_matches_target",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "status"], name="att_corr_status_idx"),
            models.Index(fields=["tenant", "student_attendance"], name="att_corr_student_idx"),
            models.Index(fields=["tenant", "staff_attendance"], name="att_corr_staff_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.subject_type} correction ({self.status})"


class LeaveAppliesTo(models.TextChoices):
    STAFF = "staff", "Staff"
    STUDENT = "student", "Student"
    BOTH = "both", "Both"


class RequesterType(models.TextChoices):
    STAFF = "staff", "Staff"
    STUDENT = "student", "Student"


class DayPart(models.TextChoices):
    FULL = "full", "Full day"
    FIRST_HALF = "first_half", "First half"
    SECOND_HALF = "second_half", "Second half"


class LeaveStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    CANCELLED = "cancelled", "Cancelled"


class ApprovalDecision(models.TextChoices):
    """`skipped` is declared and **unreachable today.**

    The locked entity map lists it, and it is what a chain step becomes when a
    tenant's configuration removes a level that a request has already passed —
    the case `hr-leave` (Tier 6) meets when it makes the chain editable
    mid-flight. Nothing in this module edits a chain after a request is raised,
    so `decide_leave_step` only ever produces `approved` or `rejected`. Reserved,
    not implemented, and said here rather than left for a reader to infer a
    workflow from an enum.
    """

    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    SKIPPED = "skipped", "Skipped"


class AccrualFrequency(models.TextChoices):
    ANNUAL = "annual", "Annual"
    MONTHLY = "monthly", "Monthly"


class LeaveType(TenantOwnedModel):
    """A tenant-configured leave category, for staff, students, or both.

    Owned by this module and **shared with `hr-leave`** (Tier 6):
    `entities/attendance.md` carries the column spec, `attendance.md` §15 and
    `hr-leave.md` §15 both list the table, and only one app can ship the
    migration. It is this one, because attendance is the module that ships
    first; hr-leave adds no tables and layers staff policy, accrual and the
    editable multi-step approval engine on top.
    """

    name = models.CharField(max_length=100, help_text='e.g. "Sick Leave".')
    code = models.CharField(max_length=20)
    applies_to = models.CharField(
        max_length=10, choices=LeaveAppliesTo.choices, default=LeaveAppliesTo.BOTH
    )
    is_paid = models.BooleanField(
        default=True, help_text="Staff payroll relevance only; meaningless for a student."
    )
    requires_attachment = models.BooleanField(default=False, help_text="e.g. a medical note (§6).")
    max_consecutive_days = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Null = unlimited."
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "leave_types"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "code"],
                name="leave_types_unique_code",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "applies_to", "is_active"], name="leave_types_use_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.code} ({self.name})"

    @property
    def allows_students(self) -> bool:
        return self.applies_to in (LeaveAppliesTo.STUDENT, LeaveAppliesTo.BOTH)

    @property
    def allows_staff(self) -> bool:
        return self.applies_to in (LeaveAppliesTo.STAFF, LeaveAppliesTo.BOTH)


class LeavePolicy(TenantOwnedModel):
    """Quota and accrual rules binding a leave type to a staff population.

    **Staff only** — the entity doc is explicit that students have no policies or
    balances. The table ships here because attendance owns the migration for the
    whole leave domain; the semantics, the accrual job and the endpoints are
    `hr-leave`'s (Tier 6), and nothing in this module reads it. See §20 of the
    module doc for why the rows exist before anything writes them.
    """

    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, related_name="policies")
    name = models.CharField(max_length=100)
    annual_quota_days = models.DecimalField(
        max_digits=5, decimal_places=1, help_text="Entitlement per cycle; half-days supported."
    )
    accrual_frequency = models.CharField(
        max_length=20, choices=AccrualFrequency.choices, default=AccrualFrequency.ANNUAL
    )
    carry_forward_max_days = models.DecimalField(max_digits=5, decimal_places=1, default=0)
    min_notice_days = models.PositiveSmallIntegerField(default=0)
    applicability = models.JSONField(
        null=True,
        blank=True,
        help_text="Optional filter: departments/designations/employment types.",
    )
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True, help_text="Null = open-ended.")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "leave_policies"
        ordering = ["-effective_from"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(effective_to__isnull=True)
                | models.Q(effective_to__gte=models.F("effective_from")),
                name="leave_policies_effective_range",
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "leave_type", "is_active"], name="leave_policies_active_idx"
            ),
        ]

    def __str__(self) -> str:
        return self.name


class LeaveBalance(TenantOwnedModel):
    """Per-staff entitlement and usage for one policy in one cycle.

    **Staff only**, and maintained by `hr-leave`'s accrual jobs — see
    `LeavePolicy`'s docstring. Nothing in this module writes it.
    """

    staff = models.ForeignKey(
        "staff_management.Staff", on_delete=models.PROTECT, related_name="leave_balances"
    )
    leave_policy = models.ForeignKey(LeavePolicy, on_delete=models.PROTECT, related_name="balances")
    period_start = models.DateField(help_text="Balance cycle start (session or calendar year).")
    period_end = models.DateField()
    entitled_days = models.DecimalField(max_digits=5, decimal_places=1)
    carried_forward_days = models.DecimalField(max_digits=5, decimal_places=1, default=0)
    used_days = models.DecimalField(max_digits=5, decimal_places=1, default=0)
    pending_days = models.DecimalField(
        max_digits=5, decimal_places=1, default=0, help_text="Soft hold for pending requests."
    )

    class Meta:
        db_table = "leave_balances"
        ordering = ["-period_start"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "staff", "leave_policy", "period_start"],
                name="leave_balances_unique_cycle",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.CheckConstraint(
                condition=models.Q(period_end__gte=models.F("period_start")),
                name="leave_balances_period_range",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.staff_id} {self.period_start}"


class LeaveRequest(TenantOwnedModel):
    """A leave application by, or on behalf of, a student or a staff member.

    Both requester kinds share the table because `hr-leave` §15 and
    `attendance` §15 describe one; **only the student half has endpoints here.**
    §4 grants `attendance.leave-request.*` to students and guardians, while staff
    leave is keyed `hr.leave-request.*` in `hr-leave.md` §4 — a namespace this
    module must not register on another module's behalf. `requester_type` is what
    keeps the two apart, and `services` refuses a staff request through the
    student endpoints rather than half-serving it.

    `days_count` is computed net of holidays and non-working days (§11) through
    `school_organization.calendar`, never taken from the client — a leave request
    that counts a Sunday would be a balance error for staff and a false
    attendance record for a student.
    """

    requester_type = models.CharField(max_length=10, choices=RequesterType.choices)
    staff = models.ForeignKey(
        "staff_management.Staff",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="leave_requests",
    )
    student = models.ForeignKey(
        "student_management.Student",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="leave_requests",
    )
    submitted_by = models.UUIDField(help_text="users(id); a guardian may submit for a student.")
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, related_name="requests")
    start_date = models.DateField()
    end_date = models.DateField()
    day_part = models.CharField(max_length=20, choices=DayPart.choices, default=DayPart.FULL)
    days_count = models.DecimalField(
        max_digits=5, decimal_places=1, help_text="Computed net of holidays (§11)."
    )
    reason = models.CharField(max_length=1000)
    attachment_file = models.ForeignKey(
        "files.File",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="leave_requests",
        db_column="attachment_file_id",
    )
    status = models.CharField(
        max_length=20, choices=LeaveStatus.choices, default=LeaveStatus.PENDING
    )
    current_approval_level = models.PositiveSmallIntegerField(
        default=1, help_text="Step pointer into the tenant's approval chain (§7.2)."
    )
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "leave_requests"
        ordering = ["-start_date"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(staff__isnull=False, student__isnull=True)
                    | models.Q(staff__isnull=True, student__isnull=False)
                ),
                name="leave_requests_exactly_one_subject",
            ),
            models.CheckConstraint(
                condition=models.Q(end_date__gte=models.F("start_date")),
                name="leave_requests_end_on_or_after_start",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "staff", "start_date"], name="leave_req_staff_idx"),
            models.Index(fields=["tenant", "student", "start_date"], name="leave_req_student_idx"),
            models.Index(fields=["tenant", "status"], name="leave_req_status_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.requester_type} leave {self.start_date}..{self.end_date}"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — a student's own requests, a guardian's children's.

        Delegates to ``Student.filter_owned_by_user`` for the same reason
        ``StudentAttendance`` does: that hook is the one place the
        portal-enabled guardian link is interpreted, and a second copy is a
        second place for revoked access to be forgotten.

        A staff member's own requests are deliberately **not** included. Staff
        leave is `hr.leave-request.*`, and widening this hook would give a staff
        member an attendance-keyed read of a request that module has not yet
        decided the visibility rules for.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()

        from apps.student_management.models import Student

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        return queryset.filter(student__in=visible)

    @classmethod
    def filter_assigned_to_user(cls, queryset, user):
        """Record scope `assigned` — a class teacher's own sections' students.

        §4 grants `attendance.leave-request.view` to `class_teacher` scoped to
        what they are assigned, and §7.2 makes them the first approver, so this
        is the queryset their morning queue is built from.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()

        from apps.student_management.models import Student

        assigned = Student.filter_assigned_to_user(Student.objects.alive(), user)
        return queryset.filter(student__in=assigned)


class LeaveApproval(TenantOwnedModel):
    """One step of a leave request's approval chain (§7.2).

    Rows are created for the whole chain when the request is raised, not one at a
    time, so the requester can see how many steps stand between them and a
    decision — and so `current_approval_level` always points at a row that
    exists. `required_permission` is denormalised onto the step because the chain
    is tenant configuration: the key that governed a step must stay readable
    after an admin edits the chain, or an audit of last term's approvals would
    describe this term's rules.
    """

    leave_request = models.ForeignKey(
        LeaveRequest, on_delete=models.PROTECT, related_name="approvals"
    )
    level = models.PositiveSmallIntegerField(help_text="1-based step order.")
    required_permission = models.CharField(
        max_length=100, help_text="e.g. attendance.leave-request.approve."
    )
    approver_id = models.UUIDField(
        null=True, blank=True, help_text="users(id); set on decision, differs from submitted_by."
    )
    decision = models.CharField(
        max_length=20, choices=ApprovalDecision.choices, default=ApprovalDecision.PENDING
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=500, null=True, blank=True)

    class Meta:
        db_table = "leave_approvals"
        ordering = ["level"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "leave_request", "level"],
                name="leave_approvals_unique_level",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "approver_id", "decision"], name="leave_step_approver_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"L{self.level} {self.decision}"


class StaffAttendanceStatus(models.TextChoices):
    """§5.2's six staff statuses.

    Two differ from the student set and both matter. `holiday` exists because a
    staff attendance row is also a *payroll* input (§10, and hr-leave reads the
    same table): "the school was shut" and "this person did not come in" are the
    same absence to a register and very different numbers to a payslip.
    `excused` is absent from this set for the mirror-image reason — a student is
    excused by a teacher's judgement, a staff member is on approved leave.
    """

    PRESENT = "present", "Present"
    ABSENT = "absent", "Absent"
    LATE = "late", "Late"
    HALF_DAY = "half_day", "Half day"
    ON_LEAVE = "on_leave", "On leave"
    HOLIDAY = "holiday", "Holiday"


class StaffAttendanceSource(models.TextChoices):
    """`self` is the one addition to the student source set: §5.2 allows a staff
    member to check themselves in, which no student may do.

    `device` is reserved and unreachable for the same reason it is on the student
    table — §21's biometric/RFID scope.
    """

    MANUAL = "manual", "Manual"
    SELF = "self", "Self check-in"
    IMPORT = "import", "Import"
    DEVICE = "device", "Device"


class StaffAttendance(TenantOwnedModel):
    """One staff member's presence on one date, with times.

    **Never per period.** A student register can run per period (§19's tenant
    setting); a staff day is one row with a check-in and a check-out, because
    that is what §5.3's late-arrival/early-departure capture and §13's punctuality
    report measure. Hence one plain unique constraint here where
    `student_attendance` needs two partial ones.

    Absence rows feed `timetable.TeacherSubstitution` — §18 declares attendance
    outbound to timetable, and `services.mark_staff_attendance` is where that
    signal is emitted.
    """

    staff = models.ForeignKey(
        "staff_management.Staff", on_delete=models.PROTECT, related_name="attendance"
    )
    attendance_date = models.DateField(help_text="Calendar date in the tenant's timezone.")
    status = models.CharField(max_length=20, choices=StaffAttendanceStatus.choices)
    check_in_time = models.TimeField(null=True, blank=True)
    check_out_time = models.TimeField(
        null=True, blank=True, help_text="Must be later than check_in_time (§11)."
    )
    late_minutes = models.IntegerField(
        null=True,
        blank=True,
        help_text="Computed server-side from the tenant work-day window; never client-supplied.",
    )
    early_departure_minutes = models.IntegerField(
        null=True, blank=True, help_text="Computed server-side, like late_minutes."
    )
    leave_request = models.ForeignKey(
        LeaveRequest,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="staff_attendance",
        db_column="leave_request_id",
        help_text="Set when status is on_leave; written by hr-leave's approval flow.",
    )
    source = models.CharField(
        max_length=20,
        choices=StaffAttendanceSource.choices,
        default=StaffAttendanceSource.MANUAL,
    )
    marked_by = models.UUIDField(help_text="users(id) — the recording actor.")
    is_locked = models.BooleanField(default=False)
    remarks = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        db_table = "staff_attendance"
        ordering = ["-attendance_date"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "staff", "attendance_date"],
                name="staff_attendance_one_per_day",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.CheckConstraint(
                condition=models.Q(check_out_time__isnull=True)
                | models.Q(check_in_time__isnull=True)
                | models.Q(check_out_time__gt=models.F("check_in_time")),
                name="staff_attendance_check_out_after_check_in",
            ),
            models.CheckConstraint(
                condition=models.Q(late_minutes__isnull=True) | models.Q(late_minutes__gte=0),
                name="staff_attendance_late_minutes_not_negative",
            ),
            models.CheckConstraint(
                condition=models.Q(early_departure_minutes__isnull=True)
                | models.Q(early_departure_minutes__gte=0),
                name="staff_attendance_early_minutes_not_negative",
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "attendance_date", "status"], name="staff_att_date_status_idx"
            ),
            models.Index(
                fields=["tenant", "staff", "attendance_date"], name="staff_att_staff_date_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.staff_id} on {self.attendance_date}: {self.status}"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — a staff member's own attendance.

        §4 grants `attendance.staff-attendance.view` to "every staff role (own)",
        which is the widest `own` grant in the platform: every teacher, clerk and
        librarian can see their own punctuality and nobody else's. Joined through
        `staff.user_id` rather than a column on this table, because a staff row is
        the thing a user is linked to.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        return queryset.filter(staff__user_id=user.pk, staff__deleted_at__isnull=True)

    @classmethod
    def filter_assigned_to_user(cls, queryset, user):
        """Record scope `assigned` — the staff who report to this user.

        §4 does not grant `assigned` on staff attendance, so nothing reaches this
        today. It exists because `scope_queryset` falls through to `.none()`
        without it, and a department head granted `assigned` by a tenant admin
        would silently see an empty punctuality report rather than an error —
        the exact failure mode PR #37 spent a whole PR fixing on the campus axis.
        Reports-to is the relationship `Staff` already models.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()

        from apps.staff_management.models import EmploymentStatus, Staff

        manager_ids = (
            Staff.objects.alive()
            .filter(user_id=user.pk, employment_status=EmploymentStatus.ACTIVE)
            .values_list("pk", flat=True)
        )
        return queryset.filter(staff__reports_to_id__in=manager_ids)
