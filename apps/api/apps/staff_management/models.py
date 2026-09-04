"""Staff management — the durable employee master record.

Columns, defaults, uniques and indexes follow
docs/05-database/entities/people.md's Staff Domain; behaviour follows
docs/03-modules/staff-management.md.

Deliberate deviation from the entity doc, matching student_management's own
documented deviation: ``user_id`` is a plain UUID column, not a ForeignKey to
``rbac.User``. ``User.objects`` is deliberately unfiltered (authentication has
to find a user *before* any tenant context exists), so a
``PrimaryKeyRelatedField`` bound to it would happily resolve another tenant's
user id — a cross-tenant identity leak, not just a modelling choice.
``services.resolve_tenant_staff_id``/``resolve_tenant_user_id`` do the
tenant-checked resolution an FK cannot express here. The same reasoning
applies to every ``verified_by`` column below: always set server-side from
``request.user.pk``, never client-supplied, so it stays a plain UUID column
purely for consistency with student_management's established audit-reference
pattern rather than out of the same leak concern.

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


class StaffType(models.TextChoices):
    TEACHING = "teaching", "Teaching"
    NON_TEACHING = "non_teaching", "Non-teaching"


class EmploymentType(models.TextChoices):
    FULL_TIME = "full_time", "Full time"
    PART_TIME = "part_time", "Part time"
    CONTRACT = "contract", "Contract"
    VISITING = "visiting", "Visiting"


class EmploymentStatus(models.TextChoices):
    """Lifecycle of a staff record (module doc §6/§11).

    ``SUSPENDED`` is in the entity doc's enum but not in §6's prose transition
    list — the entity doc's superset is implemented here (docs/AGENTS.md rule
    2: storage wins for what gets persisted), and the discrepancy is flagged in
    docs/project-status.md rather than silently resolved either way.
    """

    ACTIVE = "active", "Active"
    ON_LEAVE = "on_leave", "On leave"
    SUSPENDED = "suspended", "Suspended"
    RESIGNED = "resigned", "Resigned"
    RETIRED = "retired", "Retired"
    TERMINATED = "terminated", "Terminated"


class QualificationType(models.TextChoices):
    DEGREE = "degree", "Degree"
    DIPLOMA = "diploma", "Diploma"
    CERTIFICATION = "certification", "Certification"
    TRAINING = "training", "Training"
    LICENSE = "license", "License"


class VerificationStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    VERIFIED = "verified", "Verified"
    REJECTED = "rejected", "Rejected"


# Seeded document types (module doc §5/§6); a tenant may extend this list via
# TenantSettings.hr["staff_document_types"] — see services.py, mirroring
# student_management's DEFAULT_DOCUMENT_TYPES convention.
DEFAULT_DOCUMENT_TYPES = (
    "contract",
    "national_id",
    "resume",
    "police_clearance",
    "medical_certificate",
    "other",
)


class Staff(TenantOwnedModel):
    """The employee master record — teaching and non-teaching staff.

    ``reports_to`` is self-referential and must be acyclic (§11); enforced in
    ``services.assert_reports_to_acyclic``, not the database (Postgres has no
    portable "no cycles" constraint over an adjacency column).
    """

    employee_number = models.CharField(
        max_length=32,
        help_text="Generated per the tenant's employee-number pattern. Immutable "
        "after creation (§11) — see services.assert_employee_number_immutable.",
    )
    user_id = models.UUIDField(
        null=True, blank=True, help_text="users(id) — portal account, tenant-checked at write time."
    )
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    # Not nullable, unlike the entity doc's suggested column — mirrors
    # student_management.Student.gender exactly: `Gender.UNSPECIFIED` already
    # covers "prefer not to say"/"not yet known", and a nullable CharField
    # with `choices` generates a redundant `EnumType | null` union in the
    # OpenAPI-derived TS client (a codegen limitation, not a modelling need).
    gender = models.CharField(max_length=20, choices=Gender.choices, default=Gender.UNSPECIFIED)
    date_of_birth = models.DateField(null=True, blank=True)
    photo_file = models.ForeignKey(
        "files.File",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        db_column="photo_file_id",
    )
    staff_type = models.CharField(max_length=20, choices=StaffType.choices)
    campus = models.ForeignKey(
        "school_organization.Campus", on_delete=models.PROTECT, related_name="staff"
    )
    department = models.ForeignKey(
        "school_organization.Department",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="staff",
    )
    designation = models.ForeignKey(
        "Designation",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="staff",
    )
    reports_to = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="direct_reports",
        db_column="reports_to_staff_id",
    )
    employment_type = models.CharField(
        max_length=20, choices=EmploymentType.choices, default=EmploymentType.FULL_TIME
    )
    employment_status = models.CharField(
        max_length=20, choices=EmploymentStatus.choices, default=EmploymentStatus.ACTIVE
    )
    joining_date = models.DateField()
    exit_date = models.DateField(null=True, blank=True)
    exit_reason = models.CharField(max_length=300, null=True, blank=True)
    email = models.EmailField(max_length=254, null=True, blank=True)
    phone = models.CharField(max_length=32)
    national_id = models.CharField(max_length=64, null=True, blank=True)
    public_bio = models.TextField(
        null=True, blank=True, help_text="Opt-in website-published bio (§10)."
    )
    address = models.JSONField(null=True, blank=True)
    custom_fields = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "staff"
        ordering = ["last_name", "first_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "employee_number"],
                name="staff_unique_employee_number_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "user_id"],
                name="staff_unique_user_per_tenant",
                condition=models.Q(deleted_at__isnull=True, user_id__isnull=False),
            ),
            models.UniqueConstraint(
                fields=["tenant", "national_id"],
                name="staff_unique_national_id_per_tenant",
                condition=models.Q(deleted_at__isnull=True, national_id__isnull=False),
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(exit_date__isnull=True)
                    | models.Q(exit_date__gte=models.F("joining_date"))
                ),
                name="staff_exit_on_or_after_joining",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "campus"], name="staff_tenant_campus_idx"),
            models.Index(fields=["tenant", "department"], name="staff_tenant_department_idx"),
            models.Index(fields=["tenant", "employment_status"], name="staff_tenant_status_idx"),
            models.Index(fields=["tenant", "staff_type"], name="staff_tenant_type_idx"),
            models.Index(
                fields=["tenant", "last_name", "first_name"], name="staff_tenant_name_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.first_name} {self.last_name} ({self.employee_number})"

    @classmethod
    def filter_assigned_to_user(cls, queryset, user):
        """Record scope ``assigned`` (auth-and-rbac.md §2.3) for a department head.

        A ``school_admin``/head with ``assigned`` scope sees the staff who
        report to them, directly — mirrors the acyclic ``reports_to`` chain
        this module owns. Unlike student_management's version of this hook
        (blocked on this very table), the join is local and can be real from
        day one.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        # Matches student_management.Student.filter_assigned_to_user's employment-status
        # check on the acting user's own staff record — an on-leave/exited manager
        # should not keep "assigned" visibility into their former reports any more than
        # an on-leave/exited class teacher keeps it into their former students.
        return queryset.filter(
            reports_to__deleted_at__isnull=True,
            reports_to__employment_status=EmploymentStatus.ACTIVE,
            reports_to__user_id=user.pk,
        )


class Designation(TenantOwnedModel):
    """Tenant-defined designation catalog (e.g. Senior Teacher, Coordinator)."""

    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20, null=True, blank=True)
    description = models.CharField(max_length=300, null=True, blank=True)
    level = models.SmallIntegerField(
        null=True, blank=True, help_text="Optional seniority ordering."
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "designations"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "name"],
                name="designations_unique_name_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "code"],
                name="designations_unique_code_per_tenant",
                condition=models.Q(deleted_at__isnull=True, code__isnull=False),
            ),
        ]

    def __str__(self) -> str:
        return self.name


class StaffQualification(TenantOwnedModel):
    """A degree/diploma/certification/training/license, with verification."""

    staff = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name="qualifications")
    qualification_type = models.CharField(max_length=30, choices=QualificationType.choices)
    title = models.CharField(max_length=200)
    institution = models.CharField(max_length=200, null=True, blank=True)
    field_of_study = models.CharField(max_length=120, null=True, blank=True)
    year_awarded = models.SmallIntegerField(null=True, blank=True)
    grade = models.CharField(max_length=50, null=True, blank=True)
    document_file = models.ForeignKey(
        "files.File",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        db_column="document_file_id",
    )
    verification_status = models.CharField(
        max_length=20, choices=VerificationStatus.choices, default=VerificationStatus.PENDING
    )
    verified_by = models.UUIDField(null=True, blank=True, help_text="users(id).")
    verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "staff_qualifications"
        ordering = ["staff_id", "-year_awarded"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(
                        verification_status=VerificationStatus.PENDING,
                        verified_by__isnull=True,
                        verified_at__isnull=True,
                    )
                    | (
                        ~models.Q(verification_status=VerificationStatus.PENDING)
                        & models.Q(verified_by__isnull=False, verified_at__isnull=False)
                    )
                ),
                name="staff_qualifications_verifier_required_when_decided",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "staff"], name="staff_qual_tenant_staff_idx"),
            models.Index(fields=["tenant", "qualification_type"], name="staff_qual_type_idx"),
            models.Index(
                fields=["tenant", "field_of_study"],
                name="staff_qual_field_idx",
                condition=models.Q(field_of_study__isnull=False),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.staff_id})"


class StaffDocument(TenantOwnedModel):
    """A typed, verifiable document in a staff member's document vault."""

    staff = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name="documents")
    file = models.ForeignKey(
        "files.File", on_delete=models.PROTECT, related_name="+", db_column="file_id"
    )
    document_type = models.CharField(
        max_length=50,
        help_text=f"Tenant-extensible; seeded values: {', '.join(DEFAULT_DOCUMENT_TYPES)}.",
    )
    title = models.CharField(max_length=200)
    notes = models.CharField(max_length=500, null=True, blank=True)
    verification_status = models.CharField(
        max_length=20, choices=VerificationStatus.choices, default=VerificationStatus.PENDING
    )
    verified_by = models.UUIDField(null=True, blank=True, help_text="users(id).")
    verified_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "staff_documents"
        ordering = ["staff_id", "document_type"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(
                        verification_status=VerificationStatus.PENDING,
                        verified_by__isnull=True,
                        verified_at__isnull=True,
                    )
                    | (
                        ~models.Q(verification_status=VerificationStatus.PENDING)
                        & models.Q(verified_by__isnull=False, verified_at__isnull=False)
                    )
                ),
                name="staff_documents_verifier_required_when_decided",
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "staff", "document_type"], name="staff_documents_type_idx"
            ),
            models.Index(
                fields=["tenant", "verification_status"], name="staff_documents_status_idx"
            ),
            models.Index(
                fields=["tenant", "expires_at"],
                name="staff_documents_expiry_idx",
                condition=models.Q(expires_at__isnull=False),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.staff_id})"
