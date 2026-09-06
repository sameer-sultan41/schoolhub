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
    leave_request_id = models.UUIDField(
        null=True,
        blank=True,
        help_text="leave_requests(id) — a plain UUID, not an FK: the table ships in this "
        "module's second PR. Becomes a real foreign key there.",
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

    **`staff_attendance_id` is not here yet.** The entity doc specifies two
    nullable target columns under one exactly-one CHECK, and `staff_attendance`
    does not ship until this module's third PR. Declaring the column now would
    mean either a lazy FK to a model that does not exist — which fails Django's
    own checks — or a plain UUID standing in for a foreign key inside its own
    app, which is the shape this codebase reserves for genuine cross-module
    references (`Section.class_teacher_staff_id`, `TimetableSlot`'s absent-teacher
    link) and has no reason to use here. So the CHECK below asserts the one
    target that exists, and the staff PR widens it. Nothing is rewritten under
    load by that: `module.attendance` ships `default_enabled=False`, so no tenant
    holds a row until well after both halves have landed.
    """

    subject_type = models.CharField(max_length=10, choices=CorrectionSubjectType.choices)
    student_attendance = models.ForeignKey(
        StudentAttendance,
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
            # A correction with no target is approvable and updates nothing. The
            # staff PR widens this to "exactly one of the two", which is what the
            # entity doc specifies; today there is only one target to point at,
            # and a CHECK that asserts the rule as it currently stands is worth
            # more than one written for a column that does not exist.
            models.CheckConstraint(
                condition=models.Q(student_attendance__isnull=False),
                name="attendance_corrections_has_a_target",
            ),
            models.CheckConstraint(
                condition=models.Q(subject_type=CorrectionSubjectType.STUDENT),
                name="attendance_corrections_student_targets_only",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "status"], name="att_corr_status_idx"),
            models.Index(fields=["tenant", "student_attendance"], name="att_corr_student_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.subject_type} correction ({self.status})"
