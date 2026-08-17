"""School & organization structure — the tenant's single structural source of truth.

Every downstream module (attendance, examinations, fees, timetable) resolves
campuses, sessions, classes, sections and subjects by id from here rather than
modelling them again, which is what keeps organizational variation a matter of
configuration instead of a code fork per school.

Columns, defaults, uniques and indexes follow
schoolhub-srd/docs/05-database/entities/academics.md; behaviour follows
schoolhub-srd/docs/03-modules/school-organization.md.

Two deliberate schema choices:

* ``head_staff_id``, ``class_teacher_staff_id``, ``house_master_staff_id``,
  ``room_id`` and ``syllabus_file_id`` are plain UUID columns, not ForeignKeys.
  The tables they point at (``staff``, ``rooms``, ``files``) are owned by modules
  that ship later; promoting each to a real FK belongs in the migration of the
  module that introduces the target table.
* Uniques are expressed as partial ``UniqueConstraint``s excluding soft-deleted
  rows, so a soft-deleted campus does not permanently reserve its code.

Nullable varchar columns below are specified by the entity doc, and NULL is not
interchangeable with '': it carries meaning ("inherit the tenant timezone") and
it is what the partial uniques on optional ``code`` columns key off — hence the
blanket DJ001 suppression rather than a stream of per-field ones.
"""
# ruff: noqa: DJ001

from django.core.validators import MinValueValidator
from django.db import models

from core.tenancy.models import TenantOwnedModel


class DepartmentType(models.TextChoices):
    ACADEMIC = "academic", "Academic"
    ADMINISTRATIVE = "administrative", "Administrative"


class SessionStatus(models.TextChoices):
    """Lifecycle of an academic session (module doc §5.4)."""

    PLANNED = "planned", "Planned"
    ACTIVE = "active", "Active"
    CLOSED = "closed", "Closed"
    ARCHIVED = "archived", "Archived"


class SubjectType(models.TextChoices):
    CORE = "core", "Core"
    ELECTIVE = "elective", "Elective"
    CO_CURRICULAR = "co_curricular", "Co-curricular"


class Campus(TenantOwnedModel):
    """A physical branch. The primary campus supplies defaults for tenant-wide lookups."""

    name = models.CharField(max_length=150)
    code = models.CharField(max_length=20)
    address = models.JSONField(null=True, blank=True)
    phone = models.CharField(max_length=32, null=True, blank=True)
    email = models.EmailField(max_length=254, null=True, blank=True)
    timezone = models.CharField(
        max_length=64,
        null=True,
        blank=True,
        help_text="IANA identifier. Null inherits the tenant timezone.",
    )
    head_staff_id = models.UUIDField(null=True, blank=True, help_text="staff(id) — campus head.")
    is_primary = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "campuses"
        ordering = ["name"]
        verbose_name_plural = "campuses"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "code"],
                name="campuses_unique_code_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant"],
                name="campuses_one_primary_per_tenant",
                condition=models.Q(is_primary=True, deleted_at__isnull=True),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.code})"


class Department(TenantOwnedModel):
    """Academic or administrative department; optionally scoped to one campus."""

    name = models.CharField(max_length=150)
    code = models.CharField(max_length=20)
    department_type = models.CharField(
        max_length=20, choices=DepartmentType.choices, default=DepartmentType.ACADEMIC
    )
    campus = models.ForeignKey(
        Campus,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="departments",
        help_text="Null means the department spans every campus.",
    )
    head_staff_id = models.UUIDField(null=True, blank=True, help_text="staff(id) — head of dept.")
    description = models.CharField(max_length=300, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "departments"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "code"],
                name="departments_unique_code_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "campus"], name="departments_tenant_campus_idx"),
            models.Index(
                fields=["tenant", "department_type"], name="departments_tenant_type_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.code})"


class AcademicSession(TenantOwnedModel):
    """A school year. Exactly one session per tenant may be current at a time."""

    name = models.CharField(max_length=50, help_text='School year label, e.g. "2026–27".')
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(
        max_length=20, choices=SessionStatus.choices, default=SessionStatus.PLANNED
    )
    is_current = models.BooleanField(default=False)

    class Meta:
        db_table = "academic_sessions"
        ordering = ["-start_date"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "name"],
                name="sessions_unique_name_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant"],
                name="sessions_one_current_per_tenant",
                condition=models.Q(is_current=True, deleted_at__isnull=True),
            ),
            models.CheckConstraint(
                condition=models.Q(end_date__gt=models.F("start_date")),
                name="sessions_end_after_start",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "status"], name="sessions_tenant_status_idx"),
        ]

    def __str__(self) -> str:
        return self.name

    @property
    def is_writable(self) -> bool:
        """Closed and archived sessions are read-only for transactional modules (§11)."""
        return self.status in {SessionStatus.PLANNED, SessionStatus.ACTIVE}


class Term(TenantOwnedModel):
    """Term/semester subdivision of a session; dates must nest inside the session window."""

    academic_session = models.ForeignKey(
        AcademicSession, on_delete=models.PROTECT, related_name="terms"
    )
    name = models.CharField(max_length=50)
    sequence = models.PositiveSmallIntegerField(help_text="Order within the session, 1-based.")
    start_date = models.DateField()
    end_date = models.DateField()

    class Meta:
        db_table = "terms"
        ordering = ["academic_session_id", "sequence"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "academic_session", "name"],
                name="terms_unique_name_per_session",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "academic_session", "sequence"],
                name="terms_unique_sequence_per_session",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.CheckConstraint(
                condition=models.Q(end_date__gt=models.F("start_date")),
                name="terms_end_after_start",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.academic_session_id})"


class Class(TenantOwnedModel):
    """A grade level. ``level`` is the promotion ladder, so it is unique per tenant.

    Structural rather than session-scoped: the same "Grade 6" persists across years
    and is referenced by enrollments, curriculum and fee structures.
    """

    name = models.CharField(max_length=80)
    code = models.CharField(max_length=20, null=True, blank=True)
    level = models.PositiveSmallIntegerField(
        help_text="Promotion ordering; the next level up is the promotion target."
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "classes"
        ordering = ["level"]
        verbose_name = "class"
        verbose_name_plural = "classes"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "name"],
                name="classes_unique_name_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "level"],
                name="classes_unique_level_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "code"],
                name="classes_unique_code_per_tenant",
                condition=models.Q(deleted_at__isnull=True, code__isnull=False),
            ),
        ]

    def __str__(self) -> str:
        return self.name


class Section(TenantOwnedModel):
    """A division of a class at one campus, e.g. "Grade 6 – A, North Campus".

    The Python field is ``school_class`` because ``class`` is a reserved word; the
    column and the API contract both keep the specified ``class_id`` name.
    """

    school_class = models.ForeignKey(
        Class, on_delete=models.PROTECT, related_name="sections", db_column="class_id"
    )
    campus = models.ForeignKey(Campus, on_delete=models.PROTECT, related_name="sections")
    name = models.CharField(max_length=30, help_text='Division label, e.g. "A".')
    capacity = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Enrollment ceiling. Null means unlimited."
    )
    class_teacher_staff_id = models.UUIDField(
        null=True, blank=True, help_text="staff(id) — homeroom teacher."
    )
    room_id = models.UUIDField(null=True, blank=True, help_text="rooms(id) — default homeroom.")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "sections"
        ordering = ["school_class_id", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "school_class", "campus", "name"],
                name="sections_unique_name_per_class_campus",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "campus"], name="sections_tenant_campus_idx"),
            models.Index(
                fields=["tenant", "class_teacher_staff_id"], name="sections_class_teacher_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.school_class_id}-{self.name}"


class Subject(TenantOwnedModel):
    """Tenant-wide subject catalog. Which class studies it is a ClassSubject row."""

    name = models.CharField(max_length=120)
    code = models.CharField(max_length=20)
    subject_type = models.CharField(
        max_length=20, choices=SubjectType.choices, default=SubjectType.CORE
    )
    department = models.ForeignKey(
        Department, on_delete=models.PROTECT, null=True, blank=True, related_name="subjects"
    )
    description = models.CharField(max_length=300, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "subjects"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "name"],
                name="subjects_unique_name_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "code"],
                name="subjects_unique_code_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "department"], name="subjects_tenant_dept_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.code})"


class ClassSubject(TenantOwnedModel):
    """Session-scoped curriculum row: this class studies this subject this year.

    Session-scoped rather than structural because a curriculum is re-decided every
    year; session rollover clones these rows forward (module doc §7.2).
    """

    academic_session = models.ForeignKey(
        AcademicSession, on_delete=models.PROTECT, related_name="class_subjects"
    )
    school_class = models.ForeignKey(
        Class, on_delete=models.PROTECT, related_name="class_subjects", db_column="class_id"
    )
    subject = models.ForeignKey(
        Subject, on_delete=models.PROTECT, related_name="class_subjects"
    )
    campus = models.ForeignKey(
        Campus,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="class_subjects",
        help_text="Null means the mapping applies to every campus.",
    )
    is_elective = models.BooleanField(default=False)
    elective_group = models.CharField(
        max_length=50,
        null=True,
        blank=True,
        help_text='Options sharing a group are mutually choosable ("choose 1 of N").',
    )
    weekly_periods = models.PositiveSmallIntegerField(
        default=1, validators=[MinValueValidator(1)], help_text="Target periods per week."
    )
    syllabus_file_id = models.UUIDField(null=True, blank=True, help_text="files(id).")
    term_plans = models.JSONField(
        null=True, blank=True, help_text="[{term_id, topics: [...]}] per-term topic plan."
    )
    notes = models.CharField(max_length=500, null=True, blank=True)

    class Meta:
        db_table = "class_subjects"
        ordering = ["academic_session_id", "school_class_id", "subject_id"]
        constraints = [
            # nulls_distinct=False: a campus-agnostic mapping (campus_id NULL) must
            # collide with itself, which the SQL default of NULL != NULL would allow.
            models.UniqueConstraint(
                fields=["tenant", "academic_session", "school_class", "subject", "campus"],
                name="class_subjects_unique_mapping",
                condition=models.Q(deleted_at__isnull=True),
                nulls_distinct=False,
            ),
            models.CheckConstraint(
                condition=models.Q(weekly_periods__gte=1),
                name="class_subjects_weekly_periods_positive",
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "academic_session", "school_class"],
                name="class_subjects_session_idx",
            ),
            models.Index(
                fields=["tenant", "subject"], name="class_subjects_subject_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.school_class_id}/{self.subject_id}"


class House(TenantOwnedModel):
    """Student grouping for sports, discipline and points. Clubs are houses with a label."""

    name = models.CharField(max_length=80)
    code = models.CharField(max_length=20, null=True, blank=True)
    color = models.CharField(max_length=20, null=True, blank=True, help_text="Token or hex.")
    motto = models.CharField(max_length=200, null=True, blank=True)
    house_master_staff_id = models.UUIDField(null=True, blank=True, help_text="staff(id).")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "houses"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "name"],
                name="houses_unique_name_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "code"],
                name="houses_unique_code_per_tenant",
                condition=models.Q(deleted_at__isnull=True, code__isnull=False),
            ),
        ]

    def __str__(self) -> str:
        return self.name
