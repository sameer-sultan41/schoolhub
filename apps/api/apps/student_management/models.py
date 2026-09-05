"""Student management — the durable student master record and PR2/PR3's additions.

PR1 scope was the `students` table only. PR2 added guardians, the student<->
guardian link, emergency contacts, and student documents. PR3 adds the
enrollment lifecycle (`student_enrollments`, `student_transfers`).

Columns, defaults, uniques and indexes follow
docs/05-database/entities/people.md; behaviour follows
docs/03-modules/student-management.md.

Deliberate deviation from the entity doc, documented in docs/project-status.md's
plan and to be raised in the module doc: ``user_id`` (on both ``Student`` and
``Guardian``) is a plain UUID column, not a ForeignKey to ``rbac.User``. The
``User`` manager is deliberately unfiltered (authentication has to find a user
*before* any tenant context exists), so a ``PrimaryKeyRelatedField`` bound to it
would happily resolve another tenant's user id — a cross-tenant identity leak,
not just a modelling choice. ``services.resolve_tenant_user_id`` does the
tenant-checked resolution an FK cannot express here.

``Student.photo_file_id`` and ``StudentDocument.file_id`` ARE real FKs to
``core.files.File`` — that table now exists (PR2) — while
``student_transfers.certificate_document_id`` stays a plain UUID column, since
its target (``generated_documents``, the certificates & documents module) is
Tier 7 and does not exist.

``StudentTransfer.decided_by`` is a plain UUID column too, matching
``StudentDocument.verified_by`` — it is always set server-side from
``request.user.pk`` (never client-supplied), so the cross-tenant leak this
docstring warns about elsewhere does not apply here; it stays a plain column
simply for consistency with that established audit-reference pattern.

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
    photo_file = models.ForeignKey(
        "files.File",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        db_column="photo_file_id",
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
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` (auth-and-rbac.md §2.3) — two distinct principals.

        A `student` sees their own row (`students.user_id`). A `guardian` sees the
        children they are actually linked to, joined through `student_guardians`,
        which is the reading every module doc §4 means when it grants a guardian an
        `own`-scoped view key. Before this hook existed, `scope_queryset` filtered
        `user_id == user.pk` only, so a guardian's portal account matched no student
        at all and the "own children" half of the scope was never enforced.

        `has_portal_access` gates the link deliberately: revoking portal access
        (`access_revoked_reason` on the same row) is the module's own mechanism for
        cutting a guardian off from a child's record without deleting the link, and
        it would be pointless if scoping ignored it.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()

        return queryset.filter(
            models.Q(user_id=user.pk)
            | models.Q(
                guardian_links__deleted_at__isnull=True,
                guardian_links__has_portal_access=True,
                guardian_links__guardian__deleted_at__isnull=True,
                guardian_links__guardian__user_id=user.pk,
            )
        ).distinct()

    @classmethod
    def filter_assigned_to_user(cls, queryset, user):
        """Record scope `assigned` (auth-and-rbac.md §2.3) for a class teacher.

        The real join, now that `staff-management` exists:
        `student_enrollments.section_id -> sections.class_teacher_staff_id ->
        staff.user_id`. A student counts as "assigned" to `user` if they have
        any enrollment in a section whose `class_teacher_staff_id` matches a
        staff row linked to `user`.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()

        from apps.staff_management.models import EmploymentStatus, Staff

        staff_ids = (
            Staff.objects.alive()
            .filter(user_id=user.pk, employment_status=EmploymentStatus.ACTIVE)
            .values_list("pk", flat=True)
        )
        return queryset.filter(
            enrollments__deleted_at__isnull=True,
            enrollments__status=EnrollmentStatus.ACTIVE,
            enrollments__section__class_teacher_staff_id__in=staff_ids,
        ).distinct()


class Relationship(models.TextChoices):
    FATHER = "father", "Father"
    MOTHER = "mother", "Mother"
    GRANDPARENT = "grandparent", "Grandparent"
    SIBLING = "sibling", "Sibling"
    LEGAL_GUARDIAN = "legal_guardian", "Legal guardian"
    OTHER = "other", "Other"


class DocumentVerificationStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    VERIFIED = "verified", "Verified"
    REJECTED = "rejected", "Rejected"


# Seeded document types (module doc §6); a tenant may extend this list via
# TenantSettings.academic["student_document_types"] — see services.py.
DEFAULT_DOCUMENT_TYPES = (
    "birth_certificate",
    "prior_transfer_certificate",
    "immunization_record",
    "photo_id",
    "prior_report_card",
    "other",
)


class Guardian(TenantOwnedModel):
    """A guardian person, linked to students N:M via ``StudentGuardian``."""

    user_id = models.UUIDField(
        null=True, blank=True, help_text="users(id) — portal account, tenant-checked at write time."
    )
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    phone = models.CharField(
        max_length=32, help_text="Primary contact; indexed for duplicate matching."
    )
    alt_phone = models.CharField(max_length=32, null=True, blank=True)
    email = models.EmailField(max_length=254, null=True, blank=True)
    occupation = models.CharField(max_length=120, null=True, blank=True)
    employer = models.CharField(max_length=200, null=True, blank=True)
    national_id = models.CharField(max_length=64, null=True, blank=True)
    photo_file = models.ForeignKey(
        "files.File",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        db_column="photo_file_id",
    )
    address = models.JSONField(null=True, blank=True)
    custom_fields = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "guardians"
        ordering = ["last_name", "first_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "user_id"],
                name="guardians_unique_user_per_tenant",
                condition=models.Q(deleted_at__isnull=True, user_id__isnull=False),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "phone"], name="guardians_tenant_phone_idx"),
            models.Index(fields=["tenant", "email"], name="guardians_tenant_email_idx"),
            models.Index(
                fields=["tenant", "last_name", "first_name"], name="guardians_tenant_name_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.first_name} {self.last_name}"


class StudentGuardian(TenantOwnedModel):
    """A student<->guardian link with per-link flags (module doc §6, entity doc).

    Seven flags, not the module doc §6's five — the entity file is storage, and
    storage wins for what gets persisted (docs/AGENTS.md rule 2): adds
    ``has_portal_access`` and ``access_revoked_reason``.
    """

    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="guardian_links")
    guardian = models.ForeignKey(Guardian, on_delete=models.PROTECT, related_name="student_links")
    relationship = models.CharField(max_length=30, choices=Relationship.choices)
    is_primary = models.BooleanField(default=False)
    is_fee_responsible = models.BooleanField(default=False)
    can_pick_up = models.BooleanField(default=True)
    receives_communications = models.BooleanField(default=True)
    has_portal_access = models.BooleanField(default=True)
    access_revoked_reason = models.CharField(max_length=200, null=True, blank=True)

    class Meta:
        db_table = "student_guardians"
        ordering = ["student_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "student", "guardian"],
                name="student_guardians_unique_link_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "student"],
                name="student_guardians_one_primary_per_student",
                condition=models.Q(is_primary=True, deleted_at__isnull=True),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "guardian"], name="student_guardians_guardian_idx"),
            models.Index(fields=["tenant", "student"], name="student_guardians_student_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.student_id} <-> {self.guardian_id}"


class EmergencyContact(TenantOwnedModel):
    """An ordered emergency contact for a student. ``relationship`` is free text —

    the module doc is explicit that this is not an enum (e.g. "aunt", "neighbor"),
    unlike ``StudentGuardian.relationship``.
    """

    student = models.ForeignKey(
        Student, on_delete=models.PROTECT, related_name="emergency_contacts"
    )
    name = models.CharField(max_length=200)
    relationship = models.CharField(max_length=50)
    phone = models.CharField(max_length=32)
    alt_phone = models.CharField(max_length=32, null=True, blank=True)
    priority = models.PositiveSmallIntegerField(default=1, help_text="Call order; 1 = first.")
    notes = models.CharField(max_length=300, null=True, blank=True)

    class Meta:
        db_table = "emergency_contacts"
        ordering = ["student_id", "priority"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(priority__gte=1), name="emergency_contacts_priority_positive"
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "student", "priority"], name="emergency_contacts_student_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.student_id})"


class StudentDocument(TenantOwnedModel):
    """A typed, verifiable document in a student's document vault."""

    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="documents")
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
        max_length=20,
        choices=DocumentVerificationStatus.choices,
        default=DocumentVerificationStatus.PENDING,
    )
    verified_by = models.UUIDField(null=True, blank=True, help_text="users(id).")
    verified_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "student_documents"
        ordering = ["student_id", "document_type"]
        constraints = [
            # verified_by/verified_at move together: both null while pending,
            # both set the moment the status leaves pending (§11).
            models.CheckConstraint(
                condition=(
                    models.Q(
                        verification_status=DocumentVerificationStatus.PENDING,
                        verified_by__isnull=True,
                        verified_at__isnull=True,
                    )
                    | (
                        ~models.Q(verification_status=DocumentVerificationStatus.PENDING)
                        & models.Q(verified_by__isnull=False, verified_at__isnull=False)
                    )
                ),
                name="student_documents_verifier_required_when_decided",
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "student", "document_type"],
                name="student_documents_type_idx",
            ),
            models.Index(
                fields=["tenant", "verification_status"], name="student_documents_status_idx"
            ),
            models.Index(
                fields=["tenant", "expires_at"],
                name="student_documents_expiry_idx",
                condition=models.Q(expires_at__isnull=False),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.student_id})"


class EnrollmentStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    PROMOTED = "promoted", "Promoted"
    RETAINED = "retained", "Retained"
    TRANSFERRED_OUT = "transferred_out", "Transferred out"
    WITHDRAWN = "withdrawn", "Withdrawn"
    GRADUATED = "graduated", "Graduated"


class StudentEnrollment(TenantOwnedModel):
    """Session-scoped placement: class, section, roll number, and outcome.

    One row per (student, academic_session) — module doc §11's "one *active*
    enrollment per session" reads as "one enrollment, period" here: promotion
    into a new session works only because that is a different
    academic_session_id, per drift #6 in the plan.
    """

    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="enrollments")
    academic_session = models.ForeignKey(
        "school_organization.AcademicSession", on_delete=models.PROTECT, related_name="+"
    )
    # Python field name avoids the `class` keyword; column/API name stays
    # `class_id`, exactly as school_organization.Section already does.
    school_class = models.ForeignKey(
        "school_organization.Class",
        on_delete=models.PROTECT,
        related_name="+",
        db_column="class_id",
    )
    section = models.ForeignKey(
        "school_organization.Section", on_delete=models.PROTECT, related_name="+"
    )
    roll_number = models.CharField(max_length=16, null=True, blank=True)
    enrollment_date = models.DateField()
    end_date = models.DateField(null=True, blank=True, help_text="Set when status leaves active.")
    status = models.CharField(
        max_length=20, choices=EnrollmentStatus.choices, default=EnrollmentStatus.ACTIVE
    )
    # entities/academics.md also lists `elective_subject_ids` as a
    # *(recommendation)* — no caller in this module or any shipped module reads
    # or writes it (elective choice belongs to academics, a later tier), so it
    # is not built. Add it here once academics needs it, not before.

    class Meta:
        db_table = "student_enrollments"
        ordering = ["-enrollment_date"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "student", "academic_session"],
                name="student_enrollments_unique_per_session",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "section", "roll_number"],
                name="student_enrollments_unique_roll_per_section",
                condition=models.Q(deleted_at__isnull=True, roll_number__isnull=False),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "section", "status"], name="student_enroll_section_idx"),
            models.Index(
                fields=["tenant", "academic_session", "school_class"],
                name="student_enroll_sess_class_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.student_id} @ {self.academic_session_id}"


class TransferType(models.TextChoices):
    INTER_CAMPUS = "inter_campus", "Inter-campus"
    OUTGOING = "outgoing", "Outgoing"
    INCOMING = "incoming", "Incoming"


class TransferStatus(models.TextChoices):
    REQUESTED = "requested", "Requested"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    COMPLETED = "completed", "Completed"
    CANCELLED = "cancelled", "Cancelled"


class StudentTransfer(TenantOwnedModel):
    """A transfer request and its lifecycle (module doc §6-§7.2).

    ``incoming`` and ``cancelled`` exist in the entity spec but have no
    workflow in this PR (drift #2/#3 in the plan) — the enum values are here
    for schema parity, ``:cancel`` is a documented gap, and completing an
    ``incoming`` transfer is a no-op beyond the status change (see
    ``services.complete_transfer``).
    """

    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="transfers")
    transfer_type = models.CharField(max_length=20, choices=TransferType.choices)
    from_campus = models.ForeignKey(
        "school_organization.Campus",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    to_campus = models.ForeignKey(
        "school_organization.Campus",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    external_school_name = models.CharField(max_length=200, null=True, blank=True)
    reason = models.TextField()
    status = models.CharField(
        max_length=20, choices=TransferStatus.choices, default=TransferStatus.REQUESTED
    )
    effective_date = models.DateField()
    decided_by = models.UUIDField(null=True, blank=True, help_text="users(id).")
    decided_at = models.DateTimeField(null=True, blank=True)
    certificate_document_id = models.UUIDField(
        null=True, blank=True, help_text="generated_documents(id) — Tier 7, not built yet."
    )

    class Meta:
        db_table = "student_transfers"
        ordering = ["-effective_date"]
        constraints = [
            # decided_by/decided_at move together: null while requested, both
            # set the moment status leaves requested — mirrors
            # student_documents_verifier_required_when_decided.
            models.CheckConstraint(
                condition=(
                    models.Q(
                        status=TransferStatus.REQUESTED,
                        decided_by__isnull=True,
                        decided_at__isnull=True,
                    )
                    | (
                        ~models.Q(status=TransferStatus.REQUESTED)
                        & models.Q(decided_by__isnull=False, decided_at__isnull=False)
                    )
                ),
                name="student_transfers_decider_required_when_decided",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "student"], name="student_transfers_student_idx"),
            models.Index(fields=["tenant", "status"], name="student_transfers_status_idx"),
            models.Index(fields=["tenant", "effective_date"], name="student_transfers_eff_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.student_id} transfer ({self.transfer_type}, {self.status})"

    @classmethod
    def filter_by_campus(cls, queryset, campus_ids):
        """A transfer is visible from **both** ends, not just the one it left.

        There is no single `campus_id` here — a transfer names a `from_campus`
        and a `to_campus`, and both are principals in it. Scoping on the origin
        alone would hide every *incoming* transfer from the campus that is
        expected to approve it, which is the one action the destination has;
        scoping on the destination alone would hide the request from the campus
        the student is actually leaving.

        A cross-campus transfer therefore appears in two queues by design. The
        `:approve` / `:reject` / `:complete` guards in `services` are what decide
        who may act, not this.
        """
        return queryset.filter(
            models.Q(from_campus_id__in=campus_ids) | models.Q(to_campus_id__in=campus_ids)
        )
