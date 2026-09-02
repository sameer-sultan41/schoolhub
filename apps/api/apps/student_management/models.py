"""Student management — the durable student master record.

PR1 scope: the `students` table only. Guardians, emergency contacts, documents
and enrollments land in later PRs; each adds its own tables to this file and its
own `000N_rls_policies.py`.

Columns, defaults, uniques and indexes follow
docs/05-database/entities/people.md; behaviour follows
docs/03-modules/student-management.md.

Two deliberate deviations from the entity doc, both documented in
docs/project-status.md's plan and to be raised in the module doc:

* ``user_id`` is a plain UUID column, not a ForeignKey to ``rbac.User``. The
  ``User`` manager is deliberately unfiltered (authentication has to find a user
  *before* any tenant context exists), so a ``PrimaryKeyRelatedField`` bound to it
  would happily resolve another tenant's user id — a cross-tenant identity leak,
  not just a modelling choice. ``services.resolve_tenant_user_id`` does the
  tenant-checked resolution an FK cannot express here.
* ``photo_file_id`` is a plain UUID column, matching the ``syllabus_file_id``
  precedent in school_organization: the ``files`` table does not exist yet and
  ships with a later PR.

Nullable varchar columns below are specified by the entity doc and NULL is not
interchangeable with '' — see school_organization/models.py's header for why —
hence the blanket DJ001 suppression.
"""
# ruff: noqa: DJ001

from django.db import models

from core.tenancy.models import TenantOwnedModel


class Gender(models.TextChoices):
    MALE = "male", "Male"
    FEMALE = "female", "Female"
    OTHER = "other", "Other"
    UNSPECIFIED = "unspecified", "Unspecified"


class StudentStatus(models.TextChoices):
    """Lifecycle of a student record (module doc §11). Kept in sync with the

    enrollment-level status enum (`active|promoted|retained|transferred_out|
    withdrawn|graduated`, added in a later PR) by the withdrawal/transfer
    services — the two enums describe different things (the person vs. one
    session's placement) and are deliberately not the same values.
    """

    ACTIVE = "active", "Active"
    SUSPENDED = "suspended", "Suspended"
    TRANSFERRED = "transferred", "Transferred"
    WITHDRAWN = "withdrawn", "Withdrawn"
    GRADUATED = "graduated", "Graduated"


class Student(TenantOwnedModel):
    """The durable person record — separate from ``student_enrollments`` (a later

    PR), which is the per-session placement. This split is the module's stated
    core design decision (§1): every module can ask both "who is this student?"
    and "where were they in session X?" independently.
    """

    admission_number = models.CharField(
        max_length=32,
        help_text="Generated per the tenant's admission-number pattern. Immutable "
        "after creation (§11) — see services.assert_admission_number_immutable.",
    )
    user_id = models.UUIDField(
        null=True, blank=True, help_text="users(id) — portal account, tenant-checked at write time."
    )
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    preferred_name = models.CharField(max_length=100, null=True, blank=True)
    date_of_birth = models.DateField()
    gender = models.CharField(max_length=20, choices=Gender.choices)
    photo_file_id = models.UUIDField(
        null=True, blank=True, help_text="files(id) — promoted when core.files lands."
    )
    campus = models.ForeignKey(
        "school_organization.Campus", on_delete=models.PROTECT, related_name="students"
    )
    house = models.ForeignKey(
        "school_organization.House",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="students",
    )
    status = models.CharField(
        max_length=20, choices=StudentStatus.choices, default=StudentStatus.ACTIVE
    )
    admission_date = models.DateField()
    blood_group = models.CharField(max_length=8, null=True, blank=True)
    nationality = models.CharField(max_length=80, null=True, blank=True)
    religion = models.CharField(
        max_length=80, null=True, blank=True, help_text="Optional/sensitive; a tenant may disable."
    )
    previous_school = models.CharField(max_length=200, null=True, blank=True)
    medical_notes = models.TextField(
        null=True,
        blank=True,
        help_text="Restricted visibility — see serializers.StudentSerializer.to_representation "
        "and core.audit.services._REDACTED_FIELDS.",
    )
    address = models.JSONField(null=True, blank=True)
    custom_fields = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "students"
        ordering = ["last_name", "first_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "admission_number"],
                name="students_unique_admission_number_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "user_id"],
                name="students_unique_user_per_tenant",
                condition=models.Q(deleted_at__isnull=True, user_id__isnull=False),
            ),
            models.CheckConstraint(
                condition=models.Q(admission_date__gte=models.F("date_of_birth")),
                name="students_admission_after_birth",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "status"], name="students_tenant_status_idx"),
            models.Index(fields=["tenant", "campus"], name="students_tenant_campus_idx"),
            models.Index(fields=["tenant", "house"], name="students_tenant_house_idx"),
            models.Index(
                fields=["tenant", "last_name", "first_name"], name="students_tenant_name_idx"
            ),
        ]
        # No GIN index on custom_fields (people.md's own recommendation): nothing
        # queries it yet, and GinIndex would pull django.contrib.postgres into
        # INSTALLED_APPS for no current benefit. Revisit if a filter needs it.

    def __str__(self) -> str:
        return f"{self.first_name} {self.last_name} ({self.admission_number})"

    @classmethod
    def filter_assigned_to_user(cls, queryset, user):
        """Record scope `assigned` (auth-and-rbac.md §2.3) for a class teacher.

        The real join is `student_enrollments.section_id ->
        sections.class_teacher_staff_id -> staff.user_id`, but `student_enrollments`
        does not exist until a later PR and `staff` is the other Tier-1 module,
        not yet built at all. Returning none() here is the fail-closed default
        `core.rbac.permissions.scope_queryset` already falls back to when a model
        has no hook — this override exists only so the gap is documented at the
        model, not silently inherited. A class_teacher with `assigned` scope sees
        zero students until both dependencies land; that is deliberate, not a bug.
        """
        return queryset.none()
