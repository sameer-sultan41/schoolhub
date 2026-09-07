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
