"""Models for the academics module.

Behaviour: docs/03-modules/academics.md. Column-level specs:
docs/05-database/entities/academics.md §"Curriculum, Allocation & Promotion".

**`class_subjects` is not defined here.** The model lives in
`apps.school_organization.models.ClassSubject` because that app shipped it first
and its session-clone wizard writes it directly. Moving a model between apps is
migration risk with no runtime payoff — the table name is unchanged either way —
so academics imports it instead and owns only its *API* (see views.py, which is
where `school-organization.md` §6's "curriculum mapping to classes lives in
academics.md" actually gets honoured).

Nullable string columns below are NULL-not-blank by design — see
school_organization/models.py's header for why — hence the blanket DJ001 suppression.
"""
# ruff: noqa: DJ001

from __future__ import annotations

from django.db import models

from core.tenancy.models import TenantOwnedModel


class PromotionDecision(models.TextChoices):
    PROMOTED = "promoted", "Promoted"
    RETAINED = "retained", "Retained"
    PROMOTED_ON_TRIAL = "promoted_on_trial", "Promoted on trial"
    GRADUATED = "graduated", "Graduated"


class PromotionStatus(models.TextChoices):
    """Batch-wide states (§7.2). Every row in a batch moves together."""

    DRAFT = "draft", "Draft"
    PENDING_APPROVAL = "pending_approval", "Pending approval"
    APPROVED = "approved", "Approved"
    EXECUTED = "executed", "Executed"
    REVERTED = "reverted", "Reverted"


class TeacherSubjectAllocation(TenantOwnedModel):
    """A teacher assigned to teach one subject to one section, for one session.

    Consumed by timetable (scheduling input) and examinations (marks-entry
    rights), so the uniqueness rules here are load-bearing for two later modules
    rather than tidiness: exactly one *primary* teacher per (section, subject)
    at a time, with co-teachers alongside and reassignment history preserved by
    end-dating rather than deleting.
    """

    academic_session = models.ForeignKey(
        "school_organization.AcademicSession",
        on_delete=models.PROTECT,
        related_name="teacher_allocations",
    )
    section = models.ForeignKey(
        "school_organization.Section", on_delete=models.PROTECT, related_name="teacher_allocations"
    )
    subject = models.ForeignKey(
        "school_organization.Subject", on_delete=models.PROTECT, related_name="teacher_allocations"
    )
    staff = models.ForeignKey(
        "staff_management.Staff",
        on_delete=models.PROTECT,
        related_name="subject_allocations",
        db_column="staff_id",
    )
    is_primary = models.BooleanField(
        default=True, help_text="One primary per (section, subject); others are co-teachers."
    )
    weekly_periods = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Overrides class_subjects.weekly_periods for this allocation's load math.",
    )
    effective_from = models.DateField(null=True, blank=True)
    effective_to = models.DateField(
        null=True, blank=True, help_text="Null = current. Set rather than deleted on reassignment."
    )

    class Meta:
        db_table = "teacher_subject_allocations"
        ordering = ["section_id", "subject_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "academic_session", "section", "subject", "staff"],
                name="tsa_unique_allocation",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # The primary teacher is unique only among *current* allocations, so
            # an end-dated predecessor can coexist with its replacement — which is
            # exactly what "reassignment preserves history" requires.
            models.UniqueConstraint(
                fields=["tenant", "academic_session", "section", "subject"],
                name="tsa_one_primary_per_section_subject",
                condition=models.Q(
                    is_primary=True, effective_to__isnull=True, deleted_at__isnull=True
                ),
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(effective_to__isnull=True)
                    | models.Q(effective_from__isnull=True)
                    | models.Q(effective_to__gte=models.F("effective_from"))
                ),
                name="tsa_effective_range_ordered",
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "staff", "academic_session"], name="tsa_tenant_staff_idx"
            ),
            models.Index(fields=["tenant", "section", "subject"], name="tsa_section_subject_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.staff_id} -> {self.section_id}/{self.subject_id}"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — a teacher sees their own allocations (§4).

        `staff.user_id` is the link; a user with no staff row matches nothing.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        return queryset.filter(staff__user_id=user.pk, staff__deleted_at__isnull=True)


class StudentPromotion(TenantOwnedModel):
    """One student's promotion decision inside an approvable batch.

    There is no `promotion_batches` table: `batch_id` is a logical grouping and
    status moves batch-wide, which the entity doc settles explicitly ("no
    separate batch table — see §Open Items"). That keeps a batch's existence a
    consequence of its rows rather than a parent that can drift out of sync with
    them.
    """

    batch_id = models.UUIDField(
        help_text="Logical batch grouping — one per class per rollover. No batch table."
    )
    student = models.ForeignKey(
        "student_management.Student", on_delete=models.PROTECT, related_name="promotions"
    )
    from_enrollment = models.ForeignKey(
        "student_management.StudentEnrollment",
        on_delete=models.PROTECT,
        related_name="promotions",
        db_column="from_enrollment_id",
    )
    from_academic_session = models.ForeignKey(
        "school_organization.AcademicSession",
        on_delete=models.PROTECT,
        related_name="promotions_from",
        db_column="from_academic_session_id",
    )
    to_academic_session = models.ForeignKey(
        "school_organization.AcademicSession",
        on_delete=models.PROTECT,
        related_name="promotions_to",
        db_column="to_academic_session_id",
    )
    from_class = models.ForeignKey(
        "school_organization.Class",
        on_delete=models.PROTECT,
        related_name="promotions_from",
        db_column="from_class_id",
    )
    to_class = models.ForeignKey(
        "school_organization.Class",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="promotions_to",
        db_column="to_class_id",
        help_text="Null when decision = graduated.",
    )
    to_section = models.ForeignKey(
        "school_organization.Section",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="promotions_to",
        db_column="to_section_id",
        help_text="Assigned at or before execution.",
    )
    decision = models.CharField(max_length=30, choices=PromotionDecision.choices)
    decision_basis = models.JSONField(
        null=True,
        blank=True,
        help_text="Snapshot of result aggregates, attendance %, rule evaluation at proposal time.",
    )
    override_reason = models.CharField(
        max_length=500,
        null=True,
        blank=True,
        help_text="Required when the decision deviates from the rule proposal.",
    )
    remarks = models.CharField(max_length=500, null=True, blank=True)
    status = models.CharField(
        max_length=30, choices=PromotionStatus.choices, default=PromotionStatus.DRAFT
    )
    approved_by = models.UUIDField(
        null=True, blank=True, help_text="users(id) — must differ from the preparer."
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    executed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "student_promotions"
        ordering = ["student_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "batch_id", "student"],
                name="promotions_unique_student_per_batch",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # `graduated` is the only decision with no target class, and every
            # other one requires it. Enforced here rather than only in services
            # because an execution reading a null to_class would create an
            # enrollment with no class at all.
            models.CheckConstraint(
                condition=(
                    models.Q(decision="graduated", to_class__isnull=True)
                    | (~models.Q(decision="graduated") & models.Q(to_class__isnull=False))
                ),
                name="promotions_target_class_matches_decision",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(approved_by__isnull=True, approved_at__isnull=True)
                    | models.Q(approved_by__isnull=False, approved_at__isnull=False)
                ),
                name="promotions_approval_fields_together",
            ),
            # One live batch per student per session pair. The batch itself
            # cannot be made unique — this table holds one row per student, so
            # (from_session, to_session, from_class) repeats by design — but a
            # student sitting in two live batches for the same rollover is
            # exactly the corruption a duplicate batch causes, and *that* is
            # indexable. `create_promotion_batch` still checks first so the
            # ordinary case gets a sentence explaining itself; this is what holds
            # when two creates race past that unlocked `.exists()`, and the
            # loser reaches the client as the same 409 through
            # core/api/exceptions.py's IntegrityError translation. `reverted` is
            # excluded so a withdrawn batch can be proposed again.
            models.UniqueConstraint(
                fields=["tenant", "student", "from_academic_session", "to_academic_session"],
                name="promotions_student_live_once",
                condition=models.Q(deleted_at__isnull=True) & ~models.Q(status="reverted"),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "batch_id", "status"], name="promotions_batch_idx"),
            models.Index(fields=["tenant", "student"], name="promotions_student_idx"),
            models.Index(
                fields=["tenant", "to_academic_session"], name="promotions_to_session_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.student_id}: {self.decision} ({self.status})"
