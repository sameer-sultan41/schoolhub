"""Models for the examinations module.

Behaviour: docs/03-modules/examinations.md. Column-level specs:
docs/05-database/entities/examinations.md.

**The grading scale is this module's foundation, and its correctness is not
expressible as a constraint.** §11 requires that a scale's bands be
"contiguous, non-overlapping, and fully cover 0-100%". Every part of that is a
statement about a *set* of rows: a band is only wrong relative to its
neighbours. A CHECK constraint cannot see a sibling row, and even if it could,
enforcing coverage per row would make a scale impossible to *build* — the first
band inserted would violate it. So the database holds what it can (each band's
own range is ordered, labels are unique within a scale) and
`grading.assert_scale_is_complete` holds the rest, called before an exam may
reference a scale.

That split is the same one `attendance` drew for "marks must not exceed the
configured maximum" and `timetable` drew for its conflict engine: a friendly
service check that can explain the whole problem at once, plus whatever the
database can genuinely guarantee against a race. Where the two overlap, the
duplication is deliberate.

**`exams.status` is a state machine, not a label.** §7.1 gives the order
(draft -> scheduled -> ongoing -> marks_entry -> processing -> approved ->
published) and two of its transitions are the module's whole point: nothing may
be marked before `marks_entry`, and nothing may be published before `approved`.
The column records where an exam is; `services` owns which moves are legal.

Nullable string columns below are NULL-not-blank by design — see
school_organization/models.py's header for why — hence the blanket DJ001
suppression.
"""
# ruff: noqa: DJ001

from __future__ import annotations

from django.db import models

from core.tenancy.models import TenantOwnedModel


class ScaleType(models.TextChoices):
    """The four grading models entities/examinations.md lists.

    `percentage` records a number and no letter; `letter` a letter and no grade
    point; `gpa` a point; `hybrid` both. The distinction is not cosmetic —
    `gpa_max` is required for the last two, because a scale that cannot say what
    a perfect result is cannot compute a GPA, and discovering that at
    result-processing time means a failed job for a whole school rather than a
    422 on the settings screen.
    """

    PERCENTAGE = "percentage", "Percentage"
    LETTER = "letter", "Letter grades"
    GPA = "gpa", "GPA"
    HYBRID = "hybrid", "Hybrid (letter and GPA)"


GPA_SCALE_TYPES = (ScaleType.GPA, ScaleType.HYBRID)


class ExamType(models.TextChoices):
    """§5.1's exam types. `custom` is the escape hatch a tenant names itself."""

    UNIT_TEST = "unit_test", "Unit test"
    MIDTERM = "midterm", "Midterm"
    FINAL = "final", "Final"
    PRACTICAL = "practical", "Practical"
    CUSTOM = "custom", "Custom"


class ExamStatus(models.TextChoices):
    """§7.1's lifecycle, in order.

    `archived` is terminal and sits outside the sequence: it is where a
    published exam goes at the end of a session so it stops appearing in
    operational lists, not a step in the cycle.
    """

    DRAFT = "draft", "Draft"
    SCHEDULED = "scheduled", "Scheduled"
    ONGOING = "ongoing", "Ongoing"
    MARKS_ENTRY = "marks_entry", "Marks entry"
    PROCESSING = "processing", "Processing"
    APPROVED = "approved", "Approved"
    PUBLISHED = "published", "Published"
    ARCHIVED = "archived", "Archived"


class GradingScale(TenantOwnedModel):
    """A tenant's grading model — §5.5, and no country's scheme is assumed.

    One scale may be the tenant default, which is what a new exam picks when the
    caller names none. Enforced as a partial unique over live rows, so replacing
    the default is "create the new one, clear the old" rather than a migration —
    and so a soft-deleted former default does not block its successor.
    """

    name = models.CharField(max_length=100)
    scale_type = models.CharField(
        max_length=20, choices=ScaleType.choices, default=ScaleType.LETTER
    )
    gpa_max = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="e.g. 4.00 or 5.00. Required for a gpa or hybrid scale.",
    )
    is_default = models.BooleanField(
        default=False, help_text="One default per tenant; used when an exam names no scale."
    )
    description = models.CharField(max_length=500, null=True, blank=True)

    class Meta:
        db_table = "grading_scales"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "name"],
                name="grading_scales_name_unique",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant"],
                name="grading_scales_one_default",
                condition=models.Q(is_default=True, deleted_at__isnull=True),
            ),
            # A GPA scale with no maximum cannot produce a grade point. Held at
            # the database because the alternative is a result-processing job
            # that fails after grading half a school.
            models.CheckConstraint(
                condition=(
                    ~models.Q(scale_type__in=GPA_SCALE_TYPES) | models.Q(gpa_max__isnull=False)
                ),
                name="grading_scales_gpa_max_present",
            ),
            models.CheckConstraint(
                condition=models.Q(gpa_max__isnull=True) | models.Q(gpa_max__gt=0),
                name="grading_scales_gpa_max_positive",
            ),
        ]

    def __str__(self) -> str:
        return self.name


class GradeBand(TenantOwnedModel):
    """One band within a scale — §5.5.

    Both ends are **inclusive**, which makes a boundary percentage ambiguous
    between two adjacent bands. `grading.band_for` resolves it in favour of the
    *upper* band, and that choice is tested rather than left to emerge from row
    ordering: a student on exactly 80.0 gets the better grade, which is the
    reading a school will defend to a parent.

    Contiguity and full 0-100 coverage are **not** constraints here — see the
    module docstring. `grading.assert_scale_is_complete` owns them.
    """

    grading_scale = models.ForeignKey(GradingScale, on_delete=models.CASCADE, related_name="bands")
    label = models.CharField(max_length=10, help_text="e.g. A+, B, Pass.")
    min_percent = models.DecimalField(max_digits=5, decimal_places=2, help_text="Inclusive.")
    max_percent = models.DecimalField(max_digits=5, decimal_places=2, help_text="Inclusive.")
    grade_point = models.DecimalField(
        max_digits=4, decimal_places=2, null=True, blank=True, help_text="For GPA scales."
    )
    is_passing = models.BooleanField(default=True)
    remark = models.CharField(max_length=100, null=True, blank=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        db_table = "grade_bands"
        ordering = ["sort_order", "-min_percent"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "grading_scale", "label"],
                name="grade_bands_label_unique",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.CheckConstraint(
                condition=models.Q(min_percent__lt=models.F("max_percent")),
                name="grade_bands_range_ordered",
            ),
            models.CheckConstraint(
                condition=models.Q(min_percent__gte=0, max_percent__lte=100),
                name="grade_bands_within_zero_to_hundred",
            ),
            models.CheckConstraint(
                condition=models.Q(grade_point__isnull=True) | models.Q(grade_point__gte=0),
                name="grade_bands_grade_point_not_negative",
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "grading_scale", "min_percent"], name="grade_bands_lookup_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.label} ({self.min_percent}-{self.max_percent}%)"


class Exam(TenantOwnedModel):
    """An examination event within a session, optionally within a term — §5.1.

    `term` is nullable because a session-wide exam is a real thing (an annual
    final that no single term owns), and the entities doc makes it nullable for
    that reason rather than as an oversight.

    `grading_scale` is `PROTECT`, not `SET_NULL`: a published result's grade is
    only interpretable against the scale that produced it, so a scale still
    referenced by an exam cannot be deleted out from under it.
    """

    academic_session = models.ForeignKey(
        "school_organization.AcademicSession", on_delete=models.PROTECT, related_name="exams"
    )
    term = models.ForeignKey(
        "school_organization.Term",
        on_delete=models.PROTECT,
        related_name="exams",
        null=True,
        blank=True,
        help_text="Null for a session-wide exam that no single term owns.",
    )
    name = models.CharField(max_length=150, help_text='e.g. "Term 1 Midterm".')
    exam_type = models.CharField(max_length=30, choices=ExamType.choices)
    grading_scale = models.ForeignKey(GradingScale, on_delete=models.PROTECT, related_name="exams")
    weightage_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=100,
        help_text="Contribution to a consolidated term or session result.",
    )
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=ExamStatus.choices, default=ExamStatus.DRAFT)
    description = models.CharField(max_length=500, null=True, blank=True)

    class Meta:
        db_table = "exams"
        ordering = ["-starts_on", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "academic_session", "name"],
                name="exams_name_unique_per_session",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # Either both dates are set or neither is: a draft exam legitimately
            # has no dates yet, but one date alone describes nothing a scheduler
            # or an admit card can use.
            models.CheckConstraint(
                condition=(
                    models.Q(starts_on__isnull=True, ends_on__isnull=True)
                    | models.Q(starts_on__isnull=False, ends_on__isnull=False)
                ),
                name="exams_dates_set_together",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(ends_on__isnull=True) | models.Q(ends_on__gte=models.F("starts_on"))
                ),
                name="exams_ends_on_after_starts_on",
            ),
            models.CheckConstraint(
                condition=models.Q(weightage_percent__gt=0, weightage_percent__lte=100),
                name="exams_weightage_in_range",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "status"], name="exams_status_idx"),
            models.Index(fields=["tenant", "term"], name="exams_term_idx"),
        ]

    def __str__(self) -> str:
        return self.name


class ExamSubject(TenantOwnedModel):
    """Per-class subject configuration for an exam — §5.1.

    One row per (exam, class, subject): the same subject is examined out of
    different totals in different year groups, which is why the class is part of
    the key rather than the subject alone.

    The three `marks_entry_*` timestamps are the entry window §6 describes and
    the lock §5.4's lifecycle ends with. They live on the *subject* rather than
    on the exam because a school opens Maths for entry while Physics is still
    being marked, and locks each as it is finished.
    """

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="exam_subjects")
    # Python field name avoids the `class` keyword; column/API name stays
    # `class_id`, exactly as school_organization.Section already does.
    school_class = models.ForeignKey(
        "school_organization.Class",
        on_delete=models.PROTECT,
        related_name="+",
        db_column="class_id",
    )
    subject = models.ForeignKey(
        "school_organization.Subject", on_delete=models.PROTECT, related_name="+"
    )
    max_marks = models.DecimalField(max_digits=6, decimal_places=2)
    pass_marks = models.DecimalField(max_digits=6, decimal_places=2)
    has_practical = models.BooleanField(default=False)
    practical_max_marks = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    practical_pass_marks = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True
    )
    subject_weightage_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=100,
        help_text="Weight within this exam's aggregate.",
    )
    marks_entry_opens_at = models.DateTimeField(null=True, blank=True)
    marks_entry_closes_at = models.DateTimeField(null=True, blank=True)
    marks_locked_at = models.DateTimeField(
        null=True, blank=True, help_text="Set by :lock-marks; cleared by :unlock-marks."
    )

    class Meta:
        db_table = "exam_subjects"
        ordering = ["subject__name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "exam", "school_class", "subject"],
                name="exam_subjects_unique_per_class_subject",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.CheckConstraint(
                condition=models.Q(max_marks__gt=0),
                name="exam_subjects_max_marks_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(pass_marks__gte=0, pass_marks__lte=models.F("max_marks")),
                name="exam_subjects_pass_marks_within_max",
            ),
            # A practical component with no maximum cannot be marked out of
            # anything, and §11 makes the pairing a validation rather than a
            # convention.
            models.CheckConstraint(
                condition=(
                    models.Q(has_practical=False)
                    | models.Q(practical_max_marks__isnull=False, practical_max_marks__gt=0)
                ),
                name="exam_subjects_practical_max_present",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(practical_pass_marks__isnull=True)
                    | models.Q(practical_pass_marks__lte=models.F("practical_max_marks"))
                ),
                name="exam_subjects_practical_pass_within_max",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    subject_weightage_percent__gt=0, subject_weightage_percent__lte=100
                ),
                name="exam_subjects_weightage_in_range",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(marks_entry_opens_at__isnull=True)
                    | models.Q(marks_entry_closes_at__isnull=True)
                    | models.Q(marks_entry_closes_at__gt=models.F("marks_entry_opens_at"))
                ),
                name="exam_subjects_entry_window_ordered",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "exam"], name="exam_subjects_exam_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.exam_id}/{self.subject_id}"


class ScheduleStatus(models.TextChoices):
    """§5.2's sitting states.

    `cancelled` is not a soft delete: a cancelled sitting stays visible so a
    student who saw it on their schedule can see that it is off, and — the
    reason it is a status rather than a `deleted_at` — a cancelled sitting is
    **excluded from every clash check**. A room freed by a cancellation is free.
    """

    SCHEDULED = "scheduled", "Scheduled"
    COMPLETED = "completed", "Completed"
    CANCELLED = "cancelled", "Cancelled"


# The statuses a sitting must be in to occupy a room, an invigilator or a
# student's time. Named once because `conflicts.py`, the constraints and the
# services all have to agree on it.
OCCUPYING_SCHEDULE_STATUSES = (ScheduleStatus.SCHEDULED, ScheduleStatus.COMPLETED)


class AdmitCardStatus(models.TextChoices):
    """§5.3's admit-card states.

    `revoked` is terminal by policy rather than by schema: §5.3 makes issue
    revocable (a fee-clearance rule, tenant-configurable) and §19 leaves the
    policy itself to client confirmation, so the column records the fact and the
    service decides who may set it.
    """

    GENERATED = "generated", "Generated"
    ISSUED = "issued", "Issued"
    REVOKED = "revoked", "Revoked"


class ExamSchedule(TenantOwnedModel):
    """One exam-subject sat by one section, at a date and time — §5.2.

    **Keyed on the section, not the class**, and the entities doc says so: two
    sections of Grade 8 sit the same paper in different rooms, sometimes at
    different times, because a school rarely has one hall big enough. That is
    also why room and invigilator clashes are real here and not merely
    theoretical.

    `start_time`/`end_time` are wall-clock on `exam_date`, which is the reason
    this module needs its own clash engine rather than reusing
    `timetable.conflicts`: a timetable slot is a cell in a weekly grid
    (`day_of_week` + `period_id`) and takes its times from the period, while a
    sitting is an interval on a calendar date. See `conflicts.py`'s header.
    """

    exam_subject = models.ForeignKey(
        ExamSubject, on_delete=models.CASCADE, related_name="schedules"
    )
    section = models.ForeignKey(
        "school_organization.Section", on_delete=models.PROTECT, related_name="exam_schedules"
    )
    exam_date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    room = models.ForeignKey(
        "timetable.Room",
        on_delete=models.PROTECT,
        related_name="exam_schedules",
        null=True,
        blank=True,
        help_text="Null while a sitting is scheduled but not yet roomed.",
    )
    invigilator_staff = models.ForeignKey(
        "staff_management.Staff",
        on_delete=models.PROTECT,
        related_name="invigilations",
        null=True,
        blank=True,
        db_column="invigilator_staff_id",
    )
    status = models.CharField(
        max_length=20, choices=ScheduleStatus.choices, default=ScheduleStatus.SCHEDULED
    )
    instructions = models.CharField(
        max_length=500, null=True, blank=True, help_text="Printed on admit cards (§5.3)."
    )

    class Meta:
        db_table = "exam_schedules"
        ordering = ["exam_date", "start_time"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "exam_subject", "section"],
                name="exam_schedules_one_per_section",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.CheckConstraint(
                condition=models.Q(end_time__gt=models.F("start_time")),
                name="exam_schedules_end_after_start",
            ),
            # Two partial uniques over *occupying* sittings only. They cannot
            # express interval overlap — no constraint can — so they are
            # deliberately narrower than `conflicts.py`: they catch the exact
            # duplicate that two admins saving the same sitting within
            # milliseconds produce, which is the case a service-level
            # `.exists()` check loses. The engine catches everything else and
            # can report it all at once, which a constraint violation cannot.
            # Same belt-and-braces split `timetable`'s substitution occupancy
            # constraints use.
            models.UniqueConstraint(
                fields=["tenant", "room", "exam_date", "start_time"],
                name="exam_schedules_room_one_per_sitting",
                condition=models.Q(
                    deleted_at__isnull=True,
                    room__isnull=False,
                    status__in=OCCUPYING_SCHEDULE_STATUSES,
                ),
            ),
            models.UniqueConstraint(
                fields=["tenant", "invigilator_staff", "exam_date", "start_time"],
                name="exam_schedules_invigilator_one_per_sitting",
                condition=models.Q(
                    deleted_at__isnull=True,
                    invigilator_staff__isnull=False,
                    status__in=OCCUPYING_SCHEDULE_STATUSES,
                ),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "exam_date", "room"], name="exam_sched_date_room_idx"),
            models.Index(
                fields=["tenant", "exam_date", "invigilator_staff"],
                name="exam_sched_date_invig_idx",
            ),
            models.Index(fields=["tenant", "section", "exam_date"], name="exam_sched_section_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.exam_subject_id} @ {self.exam_date} {self.start_time}"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — the sittings a student, or a guardian's child, sits.

        Delegates the student lookup to `Student.filter_owned_by_user` rather
        than restating the guardian join: that hook already unions a student's
        own row with the children they hold a live, portal-enabled
        `student_guardians` link to, and a second copy of that predicate is a
        second place for revoked portal access to be forgotten.

        Resolved through the *enrollment*, because a sitting names a section and
        a student's section is recorded on their enrollment for the session.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.student_management.models import EnrollmentStatus, Student, StudentEnrollment

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        sections = (
            StudentEnrollment.objects.alive()
            .filter(student__in=visible, status=EnrollmentStatus.ACTIVE)
            .values_list("section_id", flat=True)
        )
        return queryset.filter(section_id__in=sections)

    @classmethod
    def filter_assigned_to_user(cls, queryset, user):
        """Record scope `assigned` — a teacher's own section, or their invigilations.

        The union is deliberate. A class teacher needs their section's schedule;
        an invigilator needs the sittings they are supervising, which are
        routinely *not* their own section — that is the point of an invigilator.
        Narrowing to either one alone would hide half of what each needs.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.staff_management.models import EmploymentStatus, Staff

        staff_ids = list(
            Staff.objects.alive()
            .filter(user_id=user.pk, employment_status=EmploymentStatus.ACTIVE)
            .values_list("pk", flat=True)
        )
        if not staff_ids:
            return queryset.none()
        return queryset.filter(
            models.Q(section__class_teacher_staff_id__in=staff_ids)
            | models.Q(invigilator_staff_id__in=staff_ids)
        ).distinct()


class AdmitCard(TenantOwnedModel):
    """One student's admit card for one exam — §5.3.

    `admit_card_no` is tenant-unique and generated server-side. It is the number
    a student writes on a paper and an invigilator checks against a list, so it
    has to be stable and unguessable-by-accident rather than merely unique: two
    students holding the same number is a spoiled sitting.

    `file` is nullable and stays that way after a successful issue: the PDF is
    rendered by a background job, so a row exists in `generated` before its
    document does, and §16's `:issue-admit-cards` returns 202 rather than
    waiting on a hall's worth of renders.
    """

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="admit_cards")
    student = models.ForeignKey(
        "student_management.Student", on_delete=models.PROTECT, related_name="admit_cards"
    )
    admit_card_no = models.CharField(max_length=50)
    file = models.ForeignKey(
        "files.File",
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
        db_column="file_id",
    )
    status = models.CharField(
        max_length=20, choices=AdmitCardStatus.choices, default=AdmitCardStatus.GENERATED
    )
    issued_by = models.UUIDField(null=True, blank=True)
    issued_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        db_table = "admit_cards"
        ordering = ["admit_card_no"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "exam", "student"],
                name="admit_cards_one_per_student_per_exam",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "admit_card_no"],
                name="admit_cards_number_unique",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # A revocation without a reason is unauditable: §5.3 makes revocation
            # a policy decision (fee clearance, typically), and "why" is the part
            # a parent will ask about.
            models.CheckConstraint(
                condition=(
                    ~models.Q(status=AdmitCardStatus.REVOKED)
                    | models.Q(revoked_reason__isnull=False)
                ),
                name="admit_cards_revocation_has_a_reason",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "exam", "status"], name="admit_cards_exam_status_idx"),
            models.Index(fields=["tenant", "student"], name="admit_cards_student_idx"),
        ]

    def __str__(self) -> str:
        return self.admit_card_no

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — a student's own card, a guardian's children's."""
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.student_management.models import Student

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        return queryset.filter(student__in=visible)

    @classmethod
    def filter_assigned_to_user(cls, queryset, user):
        """Record scope `assigned` — a class teacher's own section's cards."""
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.staff_management.models import EmploymentStatus, Staff
        from apps.student_management.models import EnrollmentStatus, StudentEnrollment

        staff_ids = list(
            Staff.objects.alive()
            .filter(user_id=user.pk, employment_status=EmploymentStatus.ACTIVE)
            .values_list("pk", flat=True)
        )
        if not staff_ids:
            return queryset.none()
        student_ids = (
            StudentEnrollment.objects.alive()
            .filter(
                status=EnrollmentStatus.ACTIVE,
                section__class_teacher_staff_id__in=staff_ids,
            )
            .values_list("student_id", flat=True)
        )
        return queryset.filter(student_id__in=student_ids)


class MarksStatus(models.TextChoices):
    """§5.4's entry lifecycle: draft → submitted → locked.

    `draft` is a teacher's working state — saved but not claimed as finished,
    so the missing-entries dashboard (§6) still counts it as outstanding.
    `submitted` is the claim. `locked` is set by `:lock-marks` and is what
    result processing requires.

    The three are a *row* state, while `exam_subjects.marks_locked_at` is the
    *window* state, and both exist on purpose: locking a subject stamps its
    rows, but a row can be `submitted` while the subject is still open, which
    is what lets a teacher finish Maths while Physics is still being entered.
    """

    DRAFT = "draft", "Draft"
    SUBMITTED = "submitted", "Submitted"
    LOCKED = "locked", "Locked"


class Marks(TenantOwnedModel):
    """One student's marks for one exam-subject — §5.4, and the input to §5.5.

    **AI grading assistance never writes here.** `entities/examinations.md` says
    so in its own header and AGENTS.md invariant 5 requires it: AI-EXM-02
    suggests a score to a teacher, who confirms or adjusts it, and the confirmed
    value is what reaches this table. There is no `source` column because there
    is only one source — a person.

    **The upper bound on a mark is a service rule, not a constraint.** A CHECK
    cannot read `exam_subjects.max_marks` from this row, so the database holds
    what it can — nothing negative, and marks mutually exclusive with `absent` —
    while `services.assert_marks_within_maximum` holds the rest. That is the
    same split `grade_bands` draws for its contiguity rule and `attendance`
    drew for `late_minutes`.
    """

    exam_subject = models.ForeignKey(ExamSubject, on_delete=models.CASCADE, related_name="marks")
    student = models.ForeignKey(
        "student_management.Student", on_delete=models.PROTECT, related_name="marks"
    )
    theory_marks = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Null when the student was absent or exempt.",
    )
    practical_marks = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    is_absent = models.BooleanField(
        default=False, help_text="Mutually exclusive with a mark (§11)."
    )
    is_exempt = models.BooleanField(
        default=False, help_text="Excluded from the aggregate rather than scored zero."
    )
    status = models.CharField(max_length=20, choices=MarksStatus.choices, default=MarksStatus.DRAFT)
    entered_by = models.UUIDField(help_text="The teacher or exam staff who entered it.")
    remarks = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        db_table = "marks"
        ordering = ["student__admission_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "exam_subject", "student"],
                name="marks_one_per_student_per_exam_subject",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # The half of §11's range rule a constraint can hold. The upper
            # bound lives in `services` because it is on another table.
            models.CheckConstraint(
                condition=models.Q(theory_marks__isnull=True) | models.Q(theory_marks__gte=0),
                name="marks_theory_not_negative",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(practical_marks__isnull=True) | models.Q(practical_marks__gte=0)
                ),
                name="marks_practical_not_negative",
            ),
            # §11 — "absent flag and marks are mutually exclusive". Both columns
            # are on this row, so this one the database can genuinely enforce:
            # an absent student with a score is a contradiction that would
            # otherwise reach a report card.
            models.CheckConstraint(
                condition=(
                    models.Q(is_absent=False)
                    | models.Q(theory_marks__isnull=True, practical_marks__isnull=True)
                ),
                name="marks_absent_has_no_score",
            ),
            # Absent and exempt are different claims — "did not sit" versus "was
            # not required to" — and a row asserting both describes neither.
            models.CheckConstraint(
                condition=~models.Q(is_absent=True, is_exempt=True),
                name="marks_absent_and_exempt_are_exclusive",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "student"], name="marks_student_idx"),
            models.Index(
                fields=["tenant", "exam_subject", "status"], name="marks_subject_status_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.student_id} @ {self.exam_subject_id}"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — a student's own marks, a guardian's children's.

        Delegates to `Student.filter_owned_by_user`, which already unions a
        student's own row with the children they hold a live, portal-enabled
        link to. §4 grants no portal role a marks key today — results are what
        a student sees, and §5.6 gates those behind publishing — but the hook
        exists so that if one is ever granted, the narrowing is the same one
        every other table in this platform uses rather than a fresh predicate.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.student_management.models import Student

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        return queryset.filter(student__in=visible)

    @classmethod
    def filter_assigned_to_user(cls, queryset, user):
        """Record scope `assigned` — §4's marks-entry rights.

        **Two notions of "assigned", unioned, and both are needed.**

        - The *subject* teacher, through `academics.TeacherSubjectAllocation`.
          That table's own docstring says it exists for "timetable (scheduling
          input) and examinations (marks-entry rights)", and
          `timetable/conflicts.py` already treats it as the source of truth for
          who teaches what.
        - The *class* teacher, through `sections.class_teacher_staff_id`. §3
          gives them a review role over their homeroom's results, which is a
          different thing from teaching the subject.

        Narrowing to either alone would hide half of what each role needs. The
        allocation side is restricted to *current* rows (`effective_to IS
        NULL`), so a reassigned teacher stops being able to enter marks for a
        class they no longer teach — the reason that column is end-dated rather
        than deleted.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.academics.models import TeacherSubjectAllocation
        from apps.staff_management.models import EmploymentStatus, Staff
        from apps.student_management.models import EnrollmentStatus, StudentEnrollment

        staff_ids = list(
            Staff.objects.alive()
            .filter(user_id=user.pk, employment_status=EmploymentStatus.ACTIVE)
            .values_list("pk", flat=True)
        )
        if not staff_ids:
            return queryset.none()

        # (section, subject) pairs this user currently teaches.
        allocations = list(
            TeacherSubjectAllocation.objects.alive()
            .filter(staff_id__in=staff_ids, effective_to__isnull=True)
            .values_list("section_id", "subject_id")
        )
        # Sections they are class teacher of.
        homeroom_sections = list(
            StudentEnrollment.objects.alive()
            .filter(status=EnrollmentStatus.ACTIVE, section__class_teacher_staff_id__in=staff_ids)
            .values_list("section_id", flat=True)
            .distinct()
        )

        predicate = models.Q(pk__in=[])
        for section_id, subject_id in allocations:
            # Marks name a student and an exam-subject, so "the section I teach"
            # resolves through the student's active enrollment in it.
            predicate |= models.Q(
                exam_subject__subject_id=subject_id,
                student__enrollments__section_id=section_id,
                student__enrollments__status=EnrollmentStatus.ACTIVE,
                student__enrollments__deleted_at__isnull=True,
            )
        if homeroom_sections:
            predicate |= models.Q(
                student__enrollments__section_id__in=homeroom_sections,
                student__enrollments__status=EnrollmentStatus.ACTIVE,
                student__enrollments__deleted_at__isnull=True,
            )
        return queryset.filter(predicate).distinct()


class ResultOutcome(models.TextChoices):
    """§5.5's verdict on one student's exam.

    `absent` is **not** a fail, and the distinction is the point: a student who
    did not sit has no percentage to judge, and scoring them zero would put
    them bottom of the rank and count against the section's pass rate — a data
    error presented as a child's result.

    `withheld` is §5.6's per-student hold. It is an outcome rather than a flag
    so that a withheld result is excluded from publishing by the same query
    that includes everything else, instead of by a condition each caller has to
    remember.
    """

    PASS = "pass", "Pass"
    FAIL = "fail", "Fail"
    ABSENT = "absent", "Absent"
    WITHHELD = "withheld", "Withheld"


class ResultStatus(models.TextChoices):
    """§5.6's approval chain, on the result row rather than only on the exam.

    Per row, because §5.6 supports withholding *one* student's result while the
    rest of a section publishes — which a status on the exam alone cannot
    express.
    """

    PROCESSING = "processing", "Processing"
    PENDING_APPROVAL = "pending_approval", "Pending approval"
    APPROVED = "approved", "Approved"
    PUBLISHED = "published", "Published"


class ReportCardStatus(models.TextChoices):
    """§5.7's report-card states."""

    DRAFT = "draft", "Draft"
    GENERATED = "generated", "Generated"
    PUBLISHED = "published", "Published"


class Result(TenantOwnedModel):
    """One student's processed outcome for one exam — §5.5.

    **Recomputed idempotently until approved.** §6 says "recompute is idempotent
    and re-runnable until approval", so processing updates this row in place
    rather than inserting a second one; the unique index below is what makes
    that a requirement rather than a preference.

    `section_id` is the section **at processing time**, denormalised
    deliberately. A student who changes section after results are published
    must not retroactively move their result into the new section's rank list,
    and resolving the section through the enrolment at read time would do
    exactly that.

    `created_by` is the processing initiator, and `approved_by` must differ from
    it — §4's closing line and auth-and-rbac §2.4's segregation of duties. That
    is checked in `services`, not here, because a CHECK cannot compare a column
    against another row's author and the rule has to hold for any caller.
    """

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="results")
    student = models.ForeignKey(
        "student_management.Student", on_delete=models.PROTECT, related_name="results"
    )
    section = models.ForeignKey(
        "school_organization.Section",
        on_delete=models.PROTECT,
        related_name="+",
        help_text="The section at processing time; never resolved again at read time.",
    )
    total_max_marks = models.DecimalField(max_digits=8, decimal_places=2)
    total_obtained_marks = models.DecimalField(max_digits=8, decimal_places=2)
    percentage = models.DecimalField(max_digits=5, decimal_places=2)
    grade_band = models.ForeignKey(
        GradeBand, on_delete=models.PROTECT, related_name="+", null=True, blank=True
    )
    gpa = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    rank_in_section = models.IntegerField(null=True, blank=True)
    rank_in_class = models.IntegerField(null=True, blank=True)
    outcome = models.CharField(max_length=20, choices=ResultOutcome.choices)
    grace_marks = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        default=0,
        help_text="Moderation adjustment; audited (§19).",
    )
    status = models.CharField(
        max_length=20, choices=ResultStatus.choices, default=ResultStatus.PROCESSING
    )
    approved_by = models.UUIDField(
        null=True, blank=True, help_text="Must differ from the processing initiator (§4)."
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "results"
        ordering = ["-percentage"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "exam", "student"],
                name="results_one_per_student_per_exam",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.CheckConstraint(
                condition=models.Q(percentage__gte=0, percentage__lte=100),
                name="results_percentage_in_range",
            ),
            models.CheckConstraint(
                condition=models.Q(total_obtained_marks__gte=0, total_max_marks__gte=0),
                name="results_totals_not_negative",
            ),
            models.CheckConstraint(
                condition=models.Q(grace_marks__gte=0),
                name="results_grace_marks_not_negative",
            ),
            # An approval without an approver, or an approver with no timestamp,
            # is an audit trail with a hole in it — and this is the row a school
            # points at when a parent disputes a grade.
            models.CheckConstraint(
                condition=(
                    models.Q(status__in=[ResultStatus.PROCESSING, ResultStatus.PENDING_APPROVAL])
                    | models.Q(approved_by__isnull=False, approved_at__isnull=False)
                ),
                name="results_approval_is_attributable",
            ),
            models.CheckConstraint(
                condition=(
                    ~models.Q(status=ResultStatus.PUBLISHED) | models.Q(published_at__isnull=False)
                ),
                name="results_publication_has_a_timestamp",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "exam", "section"], name="results_exam_section_idx"),
            models.Index(fields=["tenant", "student"], name="results_student_idx"),
            models.Index(fields=["tenant", "status"], name="results_status_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.student_id} @ {self.exam_id}: {self.percentage}%"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — a student's own result, a guardian's children's.

        Delegates to `Student.filter_owned_by_user` rather than restating the
        guardian join, which already unions a student's own row with the
        children they hold a live, portal-enabled link to.

        **This hook does not decide whether an unpublished result is visible.**
        §5.6 gates that, and the viewset narrows a restricted principal to
        `published` separately — record scope answers "whose", not "when".
        Conflating the two here would put a publishing rule in a place nobody
        looks for one.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.student_management.models import Student

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        return queryset.filter(student__in=visible)

    @classmethod
    def filter_assigned_to_user(cls, queryset, user):
        """Record scope `assigned` — §13's "teachers see assigned sections".

        Resolved on this table's own `section_id`, not through an enrolment: a
        result records the section it was processed in, and that is the section
        whose teacher is entitled to see it.
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


class ReportCard(TenantOwnedModel):
    """A generated report card — §5.7.

    **Exactly one of `exam` or `term` is set**, enforced by a CHECK and by two
    disjoint partial unique indexes. That is the same shape
    `student_attendance` uses for its daily-versus-period split, and for the
    same reason: PostgreSQL treats NULLs as distinct, so one unique index over
    both columns would let a student collect two exam cards for one exam and
    never notice.

    `attendance_summary` is a **snapshot** taken at generation time, not a live
    join. A card is a document a school hands to a parent; if it were computed
    on read, last year's card would silently restate itself against this year's
    register every time anyone opened it.

    `version` increments on regeneration rather than a second row being written
    — §6 asks for "regeneration versioning", and a school that reissues a card
    after fixing a remark needs the old one to stop being the current card
    without the record of it disappearing.
    """

    exam = models.ForeignKey(
        Exam, on_delete=models.CASCADE, related_name="report_cards", null=True, blank=True
    )
    term = models.ForeignKey(
        "school_organization.Term",
        on_delete=models.PROTECT,
        related_name="report_cards",
        null=True,
        blank=True,
        help_text="Set instead of `exam` for a term-consolidated card.",
    )
    student = models.ForeignKey(
        "student_management.Student", on_delete=models.PROTECT, related_name="report_cards"
    )
    result = models.ForeignKey(
        Result,
        on_delete=models.PROTECT,
        related_name="report_cards",
        null=True,
        blank=True,
        help_text="Null for a term consolidation, which spans several results.",
    )
    file = models.ForeignKey(
        "files.File",
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
        db_column="file_id",
    )
    class_teacher_remarks = models.CharField(max_length=1000, null=True, blank=True)
    principal_remarks = models.CharField(max_length=1000, null=True, blank=True)
    attendance_summary = models.JSONField(
        null=True,
        blank=True,
        help_text="Snapshot from the attendance module at generation time.",
    )
    version = models.IntegerField(default=1)
    status = models.CharField(
        max_length=20, choices=ReportCardStatus.choices, default=ReportCardStatus.DRAFT
    )
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "report_cards"
        ordering = ["student__admission_number"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(exam__isnull=False, term__isnull=True)
                    | models.Q(exam__isnull=True, term__isnull=False)
                ),
                name="report_cards_exactly_one_scope",
            ),
            models.UniqueConstraint(
                fields=["tenant", "exam", "student"],
                name="report_cards_one_per_exam",
                condition=models.Q(exam__isnull=False, deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "term", "student"],
                name="report_cards_one_per_term",
                condition=models.Q(term__isnull=False, deleted_at__isnull=True),
            ),
            models.CheckConstraint(
                condition=models.Q(version__gte=1), name="report_cards_version_positive"
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "exam", "status"], name="report_cards_exam_idx"),
            models.Index(fields=["tenant", "student"], name="report_cards_student_idx"),
        ]

    def __str__(self) -> str:
        return f"report card {self.student_id} v{self.version}"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — a student's own card, a guardian's children's."""
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.student_management.models import Student

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        return queryset.filter(student__in=visible)

    @classmethod
    def filter_assigned_to_user(cls, queryset, user):
        """Record scope `assigned` — §3 gives a class teacher their homeroom's.

        Resolved through the *result*'s section where there is one, because that
        is the section recorded at processing time. A term-consolidated card has
        no single result, so it falls back to the student's active enrolment —
        which is the right answer for a card that spans a whole term anyway.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.staff_management.models import EmploymentStatus, Staff
        from apps.student_management.models import EnrollmentStatus, StudentEnrollment

        staff_ids = list(
            Staff.objects.alive()
            .filter(user_id=user.pk, employment_status=EmploymentStatus.ACTIVE)
            .values_list("pk", flat=True)
        )
        if not staff_ids:
            return queryset.none()
        homeroom_students = (
            StudentEnrollment.objects.alive()
            .filter(status=EnrollmentStatus.ACTIVE, section__class_teacher_staff_id__in=staff_ids)
            .values_list("student_id", flat=True)
        )
        return queryset.filter(
            models.Q(result__section__class_teacher_staff_id__in=staff_ids)
            | models.Q(result__isnull=True, student_id__in=homeroom_students)
        ).distinct()


class QuestionBankStatus(models.TextChoices):
    """§5.8's bank states. `archived` keeps a bank's history without offering it.

    Not a soft delete: a paper assembled last year cites questions from a bank,
    and `questions.usage_count` records that it did. Deleting the bank would
    strand both.
    """

    ACTIVE = "active", "Active"
    ARCHIVED = "archived", "Archived"


class QuestionType(models.TextChoices):
    """§5.8's question types.

    `mcq` and `true_false` are the two that *require* `options`, enforced by a
    CHECK below: a multiple-choice question with no choices is not a question,
    and a paper assembled from one would print a stem with nothing under it.
    """

    MCQ = "mcq", "Multiple choice"
    TRUE_FALSE = "true_false", "True or false"
    SHORT_ANSWER = "short_answer", "Short answer"
    LONG_ANSWER = "long_answer", "Long answer"
    FILL_BLANK = "fill_blank", "Fill in the blank"
    NUMERICAL = "numerical", "Numerical"


CHOICE_QUESTION_TYPES = (QuestionType.MCQ, QuestionType.TRUE_FALSE)


class QuestionDifficulty(models.TextChoices):
    """§5.8's three levels — the axis a paper blueprint mixes along."""

    EASY = "easy", "Easy"
    MEDIUM = "medium", "Medium"
    HARD = "hard", "Hard"


class QuestionSource(models.TextChoices):
    """Where a question came from — and the reason `is_approved` exists.

    `ai_generated` is declared and **unreachable today**: §14's AI-EXM-01 needs
    `core/ai`, which does not exist, and AGENTS.md hard rule 6 forbids reaching
    a provider SDK directly. The value ships now precisely so the generator
    drops in later without a migration, and so the approval gate §7.2 requires
    is already the thing standing in front of it.
    """

    MANUAL = "manual", "Manual"
    AI_GENERATED = "ai_generated", "AI generated"
    IMPORTED = "imported", "Imported"


class QuestionBank(TenantOwnedModel):
    """A collection of questions for one subject — §5.8.

    `school_class` is nullable, and null means *every* level — the same reading
    `Period.campus` and `ClassSubject.campus` already use for a nullable
    narrowing reference. A bank of general-knowledge questions is not wrong for
    having no year group.
    """

    subject = models.ForeignKey(
        "school_organization.Subject", on_delete=models.PROTECT, related_name="question_banks"
    )
    school_class = models.ForeignKey(
        "school_organization.Class",
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
        db_column="class_id",
        help_text="Null means every level.",
    )
    name = models.CharField(max_length=150)
    description = models.CharField(max_length=500, null=True, blank=True)
    status = models.CharField(
        max_length=20, choices=QuestionBankStatus.choices, default=QuestionBankStatus.ACTIVE
    )

    class Meta:
        db_table = "question_banks"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "subject", "name"],
                name="question_banks_name_unique_per_subject",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "school_class"], name="question_banks_class_idx"),
        ]

    def __str__(self) -> str:
        return self.name

    @classmethod
    def filter_assigned_to_user(cls, queryset, user):
        """Record scope `assigned` — the subjects a teacher currently teaches.

        Through `academics.TeacherSubjectAllocation`, the same table
        `Marks.filter_assigned_to_user` resolves entry rights through. §4 gives
        `exams.question.approve` to a "`teacher` (assigned subject)", and this
        is what makes "assigned subject" mean something.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.academics.models import TeacherSubjectAllocation
        from apps.staff_management.models import EmploymentStatus, Staff

        staff_ids = list(
            Staff.objects.alive()
            .filter(user_id=user.pk, employment_status=EmploymentStatus.ACTIVE)
            .values_list("pk", flat=True)
        )
        if not staff_ids:
            return queryset.none()
        subject_ids = (
            TeacherSubjectAllocation.objects.alive()
            .filter(staff_id__in=staff_ids, effective_to__isnull=True)
            .values_list("subject_id", flat=True)
        )
        return queryset.filter(subject_id__in=list(subject_ids))


class Question(TenantOwnedModel):
    """One question in a bank — §5.8, and §7.2's approval gate.

    **`is_approved` defaults to True and is forced False for `ai_generated`.**
    That asymmetry is AGENTS.md invariant 5 in a column: a teacher writing a
    question has already exercised judgement, and asking them to approve their
    own is friction with no safeguard behind it. An AI draft has had no human
    judgement applied, and §7.2 requires one before it can reach a paper.

    `usage_count` is incremented by paper assembly rather than derived, because
    §6 wants "usage tracking (which paper used which question)" and papers are
    stored as files with no table to join against — a decision §15 records.
    """

    question_bank = models.ForeignKey(
        QuestionBank, on_delete=models.CASCADE, related_name="questions"
    )
    question_text = models.TextField()
    question_type = models.CharField(max_length=20, choices=QuestionType.choices)
    difficulty = models.CharField(
        max_length=10, choices=QuestionDifficulty.choices, default=QuestionDifficulty.MEDIUM
    )
    default_marks = models.DecimalField(max_digits=5, decimal_places=2, default=1)
    options = models.JSONField(null=True, blank=True, help_text="Required for mcq and true_false.")
    answer_key = models.JSONField(null=True, blank=True)
    topic = models.CharField(
        max_length=150, null=True, blank=True, help_text="The blueprint filter (§6)."
    )
    source = models.CharField(
        max_length=20, choices=QuestionSource.choices, default=QuestionSource.MANUAL
    )
    is_approved = models.BooleanField(
        default=True, help_text="False on creation for ai_generated; flipped by :approve."
    )
    approved_by = models.UUIDField(null=True, blank=True)
    usage_count = models.IntegerField(default=0)

    class Meta:
        db_table = "questions"
        ordering = ["created_at"]
        constraints = [
            # A multiple-choice question with no choices is not a question, and
            # a paper assembled from one would print a stem with nothing under
            # it. Held at the database because a paper is a document that goes
            # to a hall of students.
            models.CheckConstraint(
                condition=(
                    ~models.Q(question_type__in=CHOICE_QUESTION_TYPES)
                    | models.Q(options__isnull=False)
                ),
                name="questions_choice_types_have_options",
            ),
            models.CheckConstraint(
                condition=models.Q(default_marks__gt=0),
                name="questions_marks_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(usage_count__gte=0),
                name="questions_usage_count_not_negative",
            ),
            # Scoped to `ai_generated`, and the scoping is the whole rule.
            # `is_approved=True` on a *manual* question means "no approval was
            # needed" — a teacher writing a question has already exercised the
            # judgement — so demanding an approver there would block ordinary
            # creation for no safeguard. On an AI draft it means somebody
            # actually looked, and §7.2 makes that the gate, so the signature
            # is the point.
            models.CheckConstraint(
                condition=(
                    ~models.Q(source=QuestionSource.AI_GENERATED)
                    | models.Q(is_approved=False)
                    | models.Q(approved_by__isnull=False)
                ),
                name="questions_ai_approval_is_attributable",
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "question_bank", "difficulty"],
                name="questions_bank_difficulty_idx",
            ),
            models.Index(
                fields=["tenant", "question_bank", "topic"], name="questions_bank_topic_idx"
            ),
            models.Index(fields=["tenant", "source", "is_approved"], name="questions_source_idx"),
        ]

    def __str__(self) -> str:
        return self.question_text[:60]
