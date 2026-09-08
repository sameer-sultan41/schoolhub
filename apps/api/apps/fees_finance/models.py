"""Models for the fees-finance module.

Behaviour: docs/03-modules/fees-finance.md. Column-level specs:
docs/05-database/entities/finance.md.

**`ledger_entries` is the first append-only tenant-owned table on the platform,
and that is a structural claim, not a naming convention.** AGENTS.md invariant 4
says money is append-only: a ledger line is inserted once and never updated or
deleted, and a mistake is corrected by appending its reversal. `core/audit`
established the shape and its migration carries the argument — "an audit trail
the application can rewrite is not evidence" — but `AuditLog` could not simply
be reused here, because it is platform-scoped, with a nullable tenant and no RLS
policy, and money is tenant-owned data that must be behind RLS.

So `LedgerEntry` inherits `AppendOnlyTenantModel`, which is
`TenantOwnedModel`'s sibling: same tenant column, same RLS coverage, minus
`updated_at`, `updated_by` and `deleted_at`. That last omission is the load-
bearing one — **soft delete is an UPDATE**, and this table has UPDATE revoked
from the application role, so soft delete and append-only cannot coexist. Read
`core/tenancy/models.py`'s `AppendOnlyTenantModel` docstring for the three
levels the guarantee is enforced at and why one level is not enough.

The single exception is `reversed_by_transaction_id`, stamped on the original
lines when a reversal supersedes them. It is the one column a later row needs to
write on an earlier one, and it is allowed by a PostgreSQL *column-level* UPDATE
grant rather than by convention: an ordinary `save()` writes every column and is
still refused, while `save(update_fields=["reversed_by_transaction_id"])` gets
through. Which columns are mutable is therefore a database fact, and
`tests/test_append_only_coverage.py` fails the build if the grant and the
model's `MUTABLE_FIELDS` ever disagree.

**Double-entry balance is a service rule, not a constraint,** for the same
reason grade-band contiguity is in examinations: the rule is about the *set* of
lines sharing a `transaction_id`, and a CHECK cannot see a sibling row. The
database holds what it can — exactly one of debit/credit is positive on each
row, neither is negative — and `core.money.assert_balanced`, called from
`ledger.post_transaction`, holds the rest. Where the two overlap the duplication
is deliberate.

**Nothing in this module writes to `ledger_entries` except
`ledger.post_transaction`.** Every later PR — payments, refunds, expenses —
posts through it, so there is one place that validates balance, refuses archived
accounts and assigns a `transaction_id`.

Nullable string columns below are NULL-not-blank by design — see
school_organization/models.py's header for why — hence the blanket DJ001
suppression.
"""
# ruff: noqa: DJ001

from __future__ import annotations

import uuid

from django.db import models

from core.tenancy.models import AppendOnlyTenantModel, TenantOwnedModel


class LedgerAccountType(models.TextChoices):
    ASSET = "asset", "Asset"
    LIABILITY = "liability", "Liability"
    EQUITY = "equity", "Equity"
    INCOME = "income", "Income"
    EXPENSE = "expense", "Expense"


class LedgerReferenceType(models.TextChoices):
    """What caused a posting. §5.8's list, plus `manual` and `reversal`.

    `manual` is an accountant's journal entry with no platform record behind it;
    `reversal` is what a correction posts as. Both are deliberately distinct
    from the five origin types, because a trial balance that cannot tell an
    automatic posting from a hand correction cannot be audited.
    """

    PAYMENT = "payment", "Payment"
    REFUND = "refund", "Refund"
    EXPENSE = "expense", "Expense"
    PAYROLL_RUN = "payroll_run", "Payroll run"
    FINE = "fine", "Fine"
    MANUAL = "manual", "Manual journal"
    REVERSAL = "reversal", "Reversal"


class FeeHeadCategory(models.TextChoices):
    TUITION = "tuition", "Tuition"
    ADMISSION = "admission", "Admission"
    TRANSPORT = "transport", "Transport"
    LIBRARY = "library", "Library"
    EXAM = "exam", "Exam"
    FINE = "fine", "Fine"
    OTHER = "other", "Other"


class FeeStructureStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    ACTIVE = "active", "Active"
    ARCHIVED = "archived", "Archived"


class FeeFrequency(models.TextChoices):
    ONE_TIME = "one_time", "One time"
    MONTHLY = "monthly", "Monthly"
    PER_TERM = "per_term", "Per term"
    ANNUAL = "annual", "Annual"


class InvoiceStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    ISSUED = "issued", "Issued"
    PARTIALLY_PAID = "partially_paid", "Partially paid"
    PAID = "paid", "Paid"
    OVERDUE = "overdue", "Overdue"
    CANCELED = "canceled", "Canceled"


class InvoiceLineSource(models.TextChoices):
    SCHEDULE = "schedule", "Fee schedule"
    FINE = "fine", "Fine"
    ADJUSTMENT = "adjustment", "Adjustment"


class GrantValueType(models.TextChoices):
    """Shared by discounts and scholarships — §15 gives both the same two shapes."""

    PERCENT = "percent", "Percent"
    FIXED = "fixed", "Fixed amount"


class DiscountStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    EXPIRED = "expired", "Expired"
    REVOKED = "revoked", "Revoked"


class ScholarshipType(models.TextChoices):
    MERIT = "merit", "Merit"
    NEED = "need", "Need"
    SPORTS = "sports", "Sports"
    STAFF_WARD = "staff_ward", "Staff ward"
    OTHER = "other", "Other"


class ScholarshipStatus(models.TextChoices):
    APPLIED = "applied", "Applied"
    APPROVED = "approved", "Approved"
    ACTIVE = "active", "Active"
    ENDED = "ended", "Ended"
    REVOKED = "revoked", "Revoked"


class FineType(models.TextChoices):
    LATE_FEE = "late_fee", "Late fee"
    LIBRARY = "library", "Library"
    TRANSPORT = "transport", "Transport"
    DAMAGE = "damage", "Damage"
    DISCIPLINE = "discipline", "Discipline"
    OTHER = "other", "Other"


class FineStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    INVOICED = "invoiced", "Invoiced"
    PAID = "paid", "Paid"
    WAIVED = "waived", "Waived"


class PaymentMethod(models.TextChoices):
    CASH = "cash", "Cash"
    CHEQUE = "cheque", "Cheque"
    BANK_TRANSFER = "bank_transfer", "Bank transfer"
    CARD = "card", "Card"
    ONLINE_GATEWAY = "online_gateway", "Online gateway"


class PaymentStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    CONFIRMED = "confirmed", "Confirmed"
    FAILED = "failed", "Failed"
    REVERSED = "reversed", "Reversed"


class RefundStatus(models.TextChoices):
    REQUESTED = "requested", "Requested"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    PROCESSED = "processed", "Processed"


class VoucherProvider(models.TextChoices):
    """§15 calls this tenant-configurable, and these are the three named.

    Kept as an enum rather than a free string because the *adapter* registry is
    keyed on it (`adapters/`), so a value with no adapter behind it is a voucher
    nothing can ever reconcile.
    """

    BANK_BRANCH = "bank_branch", "Bank branch"
    EASYPAISA = "easypaisa", "Easypaisa"
    JAZZCASH = "jazzcash", "JazzCash"


class VoucherStatus(models.TextChoices):
    ISSUED = "issued", "Issued"
    PAID = "paid", "Paid"
    VOID = "void", "Void"
    EXPIRED = "expired", "Expired"


class ImportStatus(models.TextChoices):
    PROCESSING = "processing", "Processing"
    COMPLETED = "completed", "Completed"
    FAILED = "failed", "Failed"


class LedgerAccount(TenantOwnedModel):
    """One line of the tenant's chart of accounts.

    Hierarchical via `parent`, so a school can nest "Tuition — Primary" under
    "Tuition" and report at either level. `is_system` marks the accounts seeded
    at provisioning (`services.seed_system_accounts`): they are what fee heads
    and expense categories map to out of the box, and deleting one would orphan
    every posting that referenced it, so the constraint below refuses.

    `is_active=False` is the archive: existing entries stay readable and
    reportable, new postings are refused by `ledger.post_transaction`. Deleting
    an account that has been posted to is never the right operation — the
    history is the point.
    """

    code = models.CharField(max_length=20)
    name = models.CharField(max_length=120)
    account_type = models.CharField(max_length=15, choices=LedgerAccountType.choices)
    parent = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="children"
    )
    is_system = models.BooleanField(
        default=False,
        help_text="Seeded at provisioning; cannot be deleted (see the delete constraint).",
    )
    is_active = models.BooleanField(
        default=True, help_text="Archived accounts reject new postings but keep their history."
    )

    class Meta:
        db_table = "ledger_accounts"
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "code"],
                name="ledger_accounts_code_unique",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # A system account is deleted only by un-flagging it first, which is
            # a deliberate two-step. Without this, one soft delete orphans every
            # fee head mapped to it and every posting already made against it.
            models.CheckConstraint(
                condition=~models.Q(is_system=True) | models.Q(deleted_at__isnull=True),
                name="ledger_accounts_system_not_deleted",
            ),
        ]
        indexes = [models.Index(fields=["tenant", "account_type"])]

    def __str__(self) -> str:
        return f"{self.code} {self.name}"


class LedgerEntry(AppendOnlyTenantModel):
    """One side of one double-entry posting. Never updated, never deleted.

    Lines sharing a `transaction_id` are one posting and must balance; see the
    module docstring for why that is a service rule rather than a constraint,
    and `core/tenancy/models.py` for how the append-only guarantee is enforced.

    `reference_type` / `reference_id` are a deliberate polymorphic pair rather
    than seven nullable FKs. A posting's origin is read for display and for the
    §13 reports, never joined in a hot path, and seven mostly-null columns on
    the platform's highest-volume money table costs more than it buys. The index
    on `(tenant, reference_type, reference_id)` is what makes "show me the
    postings for this payment" a lookup rather than a scan.
    """

    #: The one column a later row may stamp on an earlier one. Must stay in step
    #: with `append_only_operations(mutable_columns=...)` in the migration —
    #: `tests/test_append_only_coverage.py` asserts exactly that.
    MUTABLE_FIELDS = frozenset({"reversed_by_transaction_id"})

    transaction_id = models.UUIDField(
        default=uuid.uuid4,
        help_text="Groups the balanced lines of one posting. Assigned by ledger.post_transaction.",
    )
    entry_date = models.DateField(help_text="Posting date, which is not always the creation date.")
    ledger_account = models.ForeignKey(
        LedgerAccount, on_delete=models.PROTECT, related_name="entries"
    )
    debit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    credit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Not nullable, which is a deliberate narrowing of the entities doc. Every
    # posting has an origin: `manual` is the value for an accountant's journal
    # with no platform record behind it, and `reversal` for a correction, so
    # there is no state a NULL would describe. Keeping it nullable would also
    # put a `NullEnum` union into the generated TypeScript client for a case
    # that cannot arise.
    reference_type = models.CharField(max_length=30, choices=LedgerReferenceType.choices)
    reference_id = models.UUIDField(
        null=True,
        blank=True,
        help_text="The origin record, per reference_type. Null for a manual journal, "
        "which has no platform record behind it.",
    )
    memo = models.CharField(max_length=255, null=True, blank=True)
    reversed_by_transaction_id = models.UUIDField(
        null=True,
        blank=True,
        help_text="Set when a reversal supersedes this posting. The only mutable column.",
    )

    class Meta:
        db_table = "ledger_entries"
        ordering = ["-entry_date", "created_at"]
        constraints = [
            # Exactly one side carries the amount. A row with both set is
            # arithmetically ambiguous, and a row with neither is a line that
            # balances while moving nothing.
            models.CheckConstraint(
                condition=(
                    (models.Q(debit__gt=0) & models.Q(credit=0))
                    | (models.Q(credit__gt=0) & models.Q(debit=0))
                ),
                name="ledger_entries_exactly_one_side",
            ),
            # A negative debit *is* a credit. Allowing one would let a posting
            # balance while every account balance computed from it came out
            # wrong — the worst available failure, because it is silent.
            models.CheckConstraint(
                condition=models.Q(debit__gte=0) & models.Q(credit__gte=0),
                name="ledger_entries_no_negative_amounts",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "transaction_id"]),
            models.Index(fields=["tenant", "ledger_account", "entry_date"]),
            models.Index(fields=["tenant", "reference_type", "reference_id"]),
        ]

    def __str__(self) -> str:
        side = f"Dr {self.debit}" if self.debit else f"Cr {self.credit}"
        return f"{self.entry_date} {side} {self.ledger_account_id}"


class FeeHead(TenantOwnedModel):
    """A chargeable category, mapped to the income account its revenue posts to.

    The mapping is why `ledger_account` is not null: a fee collected with nowhere
    to post it is a payment that never reaches the books, and discovering that
    at collection time means an unreconcilable receipt. `services.assert_*`
    refuses a head pointing at anything but an income account — the type is on
    the account row, so a CHECK here cannot see it.

    `is_refundable` exists for §7.3: a refund against a non-refundable head
    (an admission fee, typically) is refused at request time rather than after
    an approver has already agreed to it.
    """

    name = models.CharField(max_length=120)
    code = models.CharField(max_length=30)
    category = models.CharField(
        max_length=20, choices=FeeHeadCategory.choices, default=FeeHeadCategory.OTHER
    )
    ledger_account = models.ForeignKey(
        LedgerAccount, on_delete=models.PROTECT, related_name="fee_heads"
    )
    is_refundable = models.BooleanField(default=True)
    is_active = models.BooleanField(
        default=True, help_text="Inactive heads are excluded from new structures."
    )

    class Meta:
        db_table = "fee_heads"
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "code"],
                name="fee_heads_code_unique",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [models.Index(fields=["tenant", "category"])]

    def __str__(self) -> str:
        return f"{self.code} {self.name}"


class FeeStructure(TenantOwnedModel):
    """A named fee set for a session, optionally narrowed to a class and campus.

    Both narrowings are nullable and mean "all": a session-wide structure has
    `class_id IS NULL`, an all-campus one has `campus_id IS NULL`. That makes
    the uniqueness rule below span nullable columns, and PostgreSQL treats NULLs
    as *distinct* by default — so two session-wide structures with the same name
    would both be allowed, which is precisely the collision the index exists to
    stop. `nulls_distinct=False` is what makes "no class" a value that can
    collide with "no class" rather than a wildcard that never matches.

    `services` still holds the narrower rule that no two *active* structures may
    cover one scope, which no index can express: the key includes `name`, so two
    differently named structures at one scope are legitimately storable and only
    one of them may be active.

    `status` is the lifecycle: a `draft` structure is editable and invoices
    nothing, `active` is what invoice generation reads, `archived` keeps last
    year's prices readable without offering them.
    """

    name = models.CharField(max_length=120)
    academic_session = models.ForeignKey(
        "school_organization.AcademicSession",
        on_delete=models.PROTECT,
        related_name="fee_structures",
    )
    school_class = models.ForeignKey(
        "school_organization.Class",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="fee_structures",
        db_column="class_id",
        help_text="Null means the structure applies session-wide.",
    )
    campus = models.ForeignKey(
        "school_organization.Campus",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="fee_structures",
        help_text="Null means all campuses.",
    )
    status = models.CharField(
        max_length=15, choices=FeeStructureStatus.choices, default=FeeStructureStatus.DRAFT
    )

    class Meta:
        db_table = "fee_structures"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "academic_session", "school_class", "campus", "name"],
                name="fee_structures_scope_name_unique",
                condition=models.Q(deleted_at__isnull=True),
                # NULLS NOT DISTINCT (PostgreSQL 15+). `class_id`/`campus_id`
                # NULL means "all", which has to be a value that collides with
                # itself — the default would make every session-wide structure
                # unique from every other and the guard would never fire.
                nulls_distinct=False,
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "academic_session", "status"]),
        ]

    def __str__(self) -> str:
        return self.name


class FeeSchedule(TenantOwnedModel):
    """One line of a structure: which head, how much, and when it falls due.

    This is also the installment schedule — `frequency` is what turns one line
    into twelve monthly charges or three per-term ones, and invoice generation
    reads it to decide what a given period owes.

    Two due rules, and which one applies depends on the frequency: `due_day` is
    a day-of-month for `monthly`, `due_date` a fixed calendar date for
    `one_time` and `annual`. `per_term` takes neither and derives its due date
    from the term. The constraints below pin each pairing, because a schedule
    with a frequency and no matching due rule produces invoices with no due date
    — which silently exempts a whole class from the aging report and the
    reminder sweep.
    """

    fee_structure = models.ForeignKey(
        FeeStructure, on_delete=models.CASCADE, related_name="schedules"
    )
    fee_head = models.ForeignKey(FeeHead, on_delete=models.PROTECT, related_name="schedules")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    frequency = models.CharField(
        max_length=15, choices=FeeFrequency.choices, default=FeeFrequency.MONTHLY
    )
    term = models.ForeignKey(
        "school_organization.Term",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="fee_schedules",
        help_text="Required when frequency is per_term.",
    )
    due_day = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Day-of-month due rule for monthly schedules."
    )
    due_date = models.DateField(
        null=True, blank=True, help_text="Fixed due date for one_time and annual schedules."
    )
    late_fee_policy = models.JSONField(
        null=True,
        blank=True,
        help_text="Grace days and fixed/percent late fee, tenant-configured. Read by the "
        "overdue sweep; absent means no automatic late fee.",
    )

    class Meta:
        db_table = "fee_schedules"
        ordering = ["fee_head__code"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "fee_structure", "fee_head", "frequency", "term"],
                name="fee_schedules_line_unique",
                condition=models.Q(deleted_at__isnull=True),
                # NULLS NOT DISTINCT, and load-bearing for the *common* case:
                # `term` is NULL for every non-per-term line, so under the
                # default a structure could carry the same monthly charge twice
                # and bill it twice.
                nulls_distinct=False,
            ),
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="fee_schedules_amount_positive",
            ),
            # per_term needs its term, and only per_term may carry one: a term on
            # a monthly line is a scoping error that would bill the same charge
            # in every term.
            models.CheckConstraint(
                condition=(
                    models.Q(frequency=FeeFrequency.PER_TERM, term__isnull=False)
                    | (~models.Q(frequency=FeeFrequency.PER_TERM) & models.Q(term__isnull=True))
                ),
                name="fee_schedules_term_matches_frequency",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(frequency=FeeFrequency.MONTHLY, due_day__isnull=False)
                    | (~models.Q(frequency=FeeFrequency.MONTHLY) & models.Q(due_day__isnull=True))
                ),
                name="fee_schedules_due_day_matches_frequency",
            ),
            # Day 29-31 is not a due rule every month can honour; the generator
            # clamps to the month's last day, and the constraint keeps the input
            # to days that exist in every month so the clamp is a rare path
            # rather than the normal one.
            models.CheckConstraint(
                condition=models.Q(due_day__isnull=True)
                | (models.Q(due_day__gte=1) & models.Q(due_day__lte=28)),
                name="fee_schedules_due_day_in_every_month",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(
                        frequency__in=[FeeFrequency.ONE_TIME, FeeFrequency.ANNUAL],
                        due_date__isnull=False,
                    )
                    | (
                        ~models.Q(frequency__in=[FeeFrequency.ONE_TIME, FeeFrequency.ANNUAL])
                        & models.Q(due_date__isnull=True)
                    )
                ),
                name="fee_schedules_due_date_matches_frequency",
            ),
        ]
        indexes = [models.Index(fields=["tenant", "fee_structure"])]

    def __str__(self) -> str:
        return f"{self.fee_head_id} {self.amount} {self.frequency}"


class Discount(TenantOwnedModel):
    """A student-level reduction, granted for a session and optionally one head.

    `fee_head` NULL means every head, which is the sibling-discount case. Scoped
    to a session rather than open-ended so a grant does not silently carry into
    next year's higher prices — §6's "sibling-aware structures via discounts"
    depends on a grant being re-considered each session.

    `approved_by` is not decoration: §4 puts granting behind
    `fees.discount.create` and waiving behind `fees.discount.waive`, and a
    reduction nobody is recorded as having authorised is the finding an auditor
    writes up. The constraint below makes that attributable at the database.
    """

    student = models.ForeignKey(
        "student_management.Student", on_delete=models.PROTECT, related_name="fee_discounts"
    )
    academic_session = models.ForeignKey(
        "school_organization.AcademicSession", on_delete=models.PROTECT, related_name="discounts"
    )
    name = models.CharField(max_length=120)
    discount_type = models.CharField(max_length=10, choices=GrantValueType.choices)
    value = models.DecimalField(
        max_digits=12, decimal_places=2, help_text="Percent (0-100) or a fixed amount."
    )
    fee_head = models.ForeignKey(
        FeeHead,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="discounts",
        help_text="Null applies the discount to every head.",
    )
    valid_from = models.DateField(null=True, blank=True)
    valid_to = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=15, choices=DiscountStatus.choices, default=DiscountStatus.ACTIVE
    )
    reason = models.TextField(null=True, blank=True)
    approved_by = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = "discounts"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(value__gt=0),
                name="discounts_value_positive",
            ),
            # A percent grant above 100 would take a line below zero, and the
            # line-level floor would silently absorb it — so the nonsense is
            # caught where it is entered rather than where it is applied.
            models.CheckConstraint(
                condition=(
                    ~models.Q(discount_type=GrantValueType.PERCENT) | models.Q(value__lte=100)
                ),
                name="discounts_percent_within_range",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(valid_from__isnull=True)
                    | models.Q(valid_to__isnull=True)
                    | models.Q(valid_to__gte=models.F("valid_from"))
                ),
                name="discounts_validity_ordered",
            ),
            # Same "is attributable" shape as examinations'
            # results_approval_is_attributable: an active reduction must name
            # who granted it. A revoked or expired one need not, because those
            # are end states a sweep can reach on its own.
            models.CheckConstraint(
                condition=(
                    ~models.Q(status=DiscountStatus.ACTIVE) | models.Q(approved_by__isnull=False)
                ),
                name="discounts_active_is_attributable",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "student", "academic_session", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} for {self.student_id}"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — a student's own grants, a guardian's children's.

        Delegates to `Student.filter_owned_by_user` rather than restating the
        guardian join: that hook already unions a student's own row with the
        children they hold a live, portal-enabled link to, and a second copy of
        that predicate is a second place for revoked portal access to be
        forgotten.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.student_management.models import Student

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        return queryset.filter(student__in=visible)


class Scholarship(TenantOwnedModel):
    """An award covering part of a session's fees, with a lifecycle and a sponsor.

    Separate from `Discount` despite the arithmetic being identical, because the
    *lifecycle* differs and that is what the table is for: a scholarship is
    applied for, approved, becomes active, and ends, and a school reports on
    awards by type and sponsor. Folding the two together would mean a
    `discount_type` column carrying `merit` and a status enum with five values
    that mean nothing for a sibling discount.

    Applied per session and always across all heads — §15 gives no `fee_head_id`
    here, unlike `discounts`, because an award covers a proportion of what a
    student owes rather than a specific charge.
    """

    student = models.ForeignKey(
        "student_management.Student", on_delete=models.PROTECT, related_name="scholarships"
    )
    academic_session = models.ForeignKey(
        "school_organization.AcademicSession",
        on_delete=models.PROTECT,
        related_name="scholarships",
    )
    name = models.CharField(max_length=120)
    scholarship_type = models.CharField(
        max_length=20, choices=ScholarshipType.choices, default=ScholarshipType.MERIT
    )
    coverage_type = models.CharField(max_length=10, choices=GrantValueType.choices)
    value = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text="Percent (0-100) or a fixed amount for the session.",
    )
    sponsor = models.CharField(max_length=120, null=True, blank=True)
    status = models.CharField(
        max_length=15, choices=ScholarshipStatus.choices, default=ScholarshipStatus.APPROVED
    )
    approved_by = models.UUIDField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "scholarships"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(value__gt=0),
                name="scholarships_value_positive",
            ),
            models.CheckConstraint(
                condition=(
                    ~models.Q(coverage_type=GrantValueType.PERCENT) | models.Q(value__lte=100)
                ),
                name="scholarships_percent_within_range",
            ),
            # `applied` is the one status with no approver yet — that is what
            # "applied" means. Every state past it must name one.
            models.CheckConstraint(
                condition=(
                    models.Q(status=ScholarshipStatus.APPLIED) | models.Q(approved_by__isnull=False)
                ),
                name="scholarships_decision_is_attributable",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "student", "academic_session", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} for {self.student_id}"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — see `Discount.filter_owned_by_user`."""
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.student_management.models import Student

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        return queryset.filter(student__in=visible)


class Fine(TenantOwnedModel):
    """A charge raised outside the fee structure, folded onto the next invoice.

    `source_module` / `source_reference` are the inbound edge §18 declares from
    library, transport and this module's own overdue sweep. Nothing produces
    them yet except the late-fee sweep — the other modules are Tier 7 — and the
    columns ship now precisely so those modules drop in without a migration.

    `status` is what keeps a fine from being billed twice: generation picks up
    `pending` rows and moves them to `invoiced` in the same transaction as the
    line it creates. A waiver is a terminal state requiring both an actor and a
    reason, by constraint — §4 puts it behind `fees.fine.waive`, and a waived
    charge nobody is recorded as having waived is exactly the audit finding the
    permission exists to prevent.
    """

    student = models.ForeignKey(
        "student_management.Student", on_delete=models.PROTECT, related_name="fines"
    )
    fee_head = models.ForeignKey(FeeHead, on_delete=models.PROTECT, related_name="fines")
    fine_type = models.CharField(max_length=20, choices=FineType.choices, default=FineType.OTHER)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.TextField()
    source_module = models.CharField(
        max_length=30,
        null=True,
        blank=True,
        help_text="Originating module slug, e.g. `library`. Null for a hand-raised fine.",
    )
    source_reference = models.UUIDField(null=True, blank=True)
    status = models.CharField(max_length=15, choices=FineStatus.choices, default=FineStatus.PENDING)
    waived_by = models.UUIDField(null=True, blank=True)
    waived_reason = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "fines"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="fines_amount_positive",
            ),
            models.CheckConstraint(
                condition=(
                    ~models.Q(status=FineStatus.WAIVED)
                    | (models.Q(waived_by__isnull=False) & ~models.Q(waived_reason=""))
                ),
                name="fines_waiver_is_attributable",
            ),
            # A cross-module fine is idempotent on its origin: the library
            # raising the same overdue charge twice must be refused, not billed
            # twice. Partial over live rows with a source, so hand-raised fines
            # (both columns null) are unaffected — and NULLS NOT DISTINCT is
            # unnecessary here because the condition already excludes nulls.
            models.UniqueConstraint(
                fields=["tenant", "source_module", "source_reference"],
                name="fines_source_unique",
                condition=models.Q(
                    deleted_at__isnull=True,
                    source_module__isnull=False,
                    source_reference__isnull=False,
                ),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "student", "status"]),
            models.Index(fields=["tenant", "source_module", "source_reference"]),
        ]

    def __str__(self) -> str:
        return f"{self.fine_type} {self.amount} for {self.student_id}"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — see `Discount.filter_owned_by_user`."""
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.student_management.models import Student

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        return queryset.filter(student__in=visible)


class FeeInvoice(TenantOwnedModel):
    """What one student owes for one period, with its totals denormalized.

    **The totals are a CHECK, not a convention.** `balance_due` must equal
    `subtotal - discount_total + fine_total - paid_total` at all times, because
    a parent reads the balance and an accountant reads the components, and a
    denormalized total that can drift is an invoice the two of them read
    differently. Every service that touches money on this row recomputes all
    five together.

    **The duplicate guard is the load-bearing index.** A partial unique on
    `(tenant, student, fee_structure, period_label)` over rows that are not
    canceled, with NULLS NOT DISTINCT — `fee_structure` is null on an ad-hoc
    invoice and `period_label` on a one-time charge, and under PostgreSQL's
    default those nulls would make every such invoice unique from every other,
    which is precisely the double-billing the guard exists to stop. Excluding
    `canceled` is what makes "cancel and re-issue" a workable correction rather
    than a dead end.

    `student_enrollment` records the class and section at billing time. Held as
    a snapshot FK rather than resolved live because a student who changes
    section mid-term must not retroactively change which class's prices their
    issued invoice was built from.
    """

    invoice_no = models.CharField(max_length=30)
    student = models.ForeignKey(
        "student_management.Student", on_delete=models.PROTECT, related_name="fee_invoices"
    )
    student_enrollment = models.ForeignKey(
        "student_management.StudentEnrollment",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="fee_invoices",
        help_text="Class/section at billing time. A snapshot, not a live lookup.",
    )
    academic_session = models.ForeignKey(
        "school_organization.AcademicSession", on_delete=models.PROTECT, related_name="fee_invoices"
    )
    fee_structure = models.ForeignKey(
        FeeStructure,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="invoices",
        help_text="Null for an ad-hoc invoice raised outside any structure.",
    )
    period_label = models.CharField(
        max_length=40,
        null=True,
        blank=True,
        help_text='e.g. "2026-09" or "Term 1". Part of the duplicate guard.',
    )
    issue_date = models.DateField()
    due_date = models.DateField()
    status = models.CharField(
        max_length=20, choices=InvoiceStatus.choices, default=InvoiceStatus.DRAFT
    )
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discount_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    fine_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    paid_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    balance_due = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    canceled_reason = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "fee_invoices"
        ordering = ["-issue_date", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "invoice_no"],
                name="fee_invoices_no_unique",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "student", "fee_structure", "period_label"],
                name="fee_invoices_no_duplicate_period",
                condition=models.Q(deleted_at__isnull=True)
                & ~models.Q(status=InvoiceStatus.CANCELED),
                nulls_distinct=False,
            ),
            models.CheckConstraint(
                condition=models.Q(due_date__gte=models.F("issue_date")),
                name="fee_invoices_due_after_issue",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(subtotal__gte=0)
                    & models.Q(discount_total__gte=0)
                    & models.Q(fine_total__gte=0)
                    & models.Q(paid_total__gte=0)
                ),
                name="fee_invoices_no_negative_totals",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    balance_due=(
                        models.F("subtotal")
                        - models.F("discount_total")
                        + models.F("fine_total")
                        - models.F("paid_total")
                    )
                ),
                name="fee_invoices_balance_is_derived",
            ),
            # A discount cannot exceed what is being charged; if it could, the
            # balance would go negative and the school would appear to owe the
            # parent.
            models.CheckConstraint(
                condition=models.Q(discount_total__lte=models.F("subtotal")),
                name="fee_invoices_discount_within_subtotal",
            ),
            models.CheckConstraint(
                condition=(
                    ~models.Q(status=InvoiceStatus.CANCELED)
                    | (models.Q(canceled_reason__isnull=False) & ~models.Q(canceled_reason=""))
                ),
                name="fee_invoices_cancellation_is_attributable",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "student", "status"]),
            # Aging reads this: buckets are a date comparison across every
            # unpaid invoice in the tenant.
            models.Index(fields=["tenant", "due_date"]),
        ]

    def __str__(self) -> str:
        return f"{self.invoice_no} ({self.balance_due})"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — §4 gives a guardian and student their own.

        Delegates to `Student.filter_owned_by_user`, the same delegation
        `StudentAttendance` and examinations' `Result` use, and for the same
        reason: `has_portal_access` gates that hook, so a guardian whose access
        was revoked stops seeing their child's fees without a second predicate
        having to remember to check.

        No `filter_assigned_to_user` hook exists and none is wanted — an invoice
        has no "assigned" notion. Worth stating, because `scope_queryset` falls
        through to `.none()` for an `assigned`-scoped principal on a model
        without one: silent empty results with no error to explain them.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.student_management.models import Student

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        return queryset.filter(student__in=visible)


class FeeInvoiceLine(TenantOwnedModel):
    """One charge on an invoice, with the origin that produced it.

    `source_type` / `source_id` are polymorphic rather than two nullable FKs,
    matching `ledger_entries`' reasoning: the origin is read for display and for
    §13's registers, never joined in a hot path.

    `discount_amount` is the portion of the student's grants applied to *this*
    line, held per line rather than only in the header so a parent can see which
    charge was reduced. The header's `discount_total` is the sum of these, and
    `services` writes both together.
    """

    fee_invoice = models.ForeignKey(FeeInvoice, on_delete=models.CASCADE, related_name="lines")
    fee_head = models.ForeignKey(FeeHead, on_delete=models.PROTECT, related_name="invoice_lines")
    description = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    source_type = models.CharField(
        max_length=20, choices=InvoiceLineSource.choices, default=InvoiceLineSource.SCHEDULE
    )
    source_id = models.UUIDField(
        null=True,
        blank=True,
        help_text="The fee_schedules or fines row per source_type. Null for an adjustment.",
    )

    class Meta:
        db_table = "fee_invoice_lines"
        ordering = ["fee_head__code"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gte=0) & models.Q(discount_amount__gte=0),
                name="fee_invoice_lines_no_negative_amounts",
            ),
            # The line-level floor §11 asks for. A grant larger than the charge
            # is clamped by the service; this refuses the state outright, so a
            # bug there cannot produce a line the school owes money on.
            models.CheckConstraint(
                condition=models.Q(discount_amount__lte=models.F("amount")),
                name="fee_invoice_lines_discount_within_amount",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "fee_invoice"]),
            models.Index(fields=["tenant", "source_type", "source_id"]),
        ]

    def __str__(self) -> str:
        return f"{self.description} {self.amount}"


class Payment(TenantOwnedModel):
    """Money received against one invoice.

    One invoice per payment, by §15's own note — a family settling two invoices
    at one counter visit makes two payments. That keeps `amount` unambiguously
    comparable to one invoice's balance, which is the rule §11 states and the
    thing a receipt has to be able to say.

    **`status` is a lifecycle, and only `confirmed` moves an invoice.** A cash
    payment is confirmed as it is taken; a gateway payment sits `pending` until
    its webhook arrives. Nothing about a pending row touches `paid_total`,
    because a balance that moved on an unconfirmed payment is a receipt the
    school cannot honour.

    `idempotency_key` is a *column*, not only a header. `replay_or_execute`
    documents itself as not concurrency-safe — it checks then stores — so the
    partial unique index here is what actually stops two simultaneous submits
    from both taking the money. The two layers cover different failures.
    """

    fee_invoice = models.ForeignKey(FeeInvoice, on_delete=models.PROTECT, related_name="payments")
    student = models.ForeignKey(
        "student_management.Student",
        on_delete=models.PROTECT,
        related_name="fee_payments",
        help_text="Denormalized from the invoice so the student ledger is one query.",
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=20, choices=PaymentMethod.choices)
    reference_no = models.CharField(max_length=80, null=True, blank=True)
    gateway_provider = models.CharField(max_length=40, null=True, blank=True)
    gateway_payload = models.JSONField(
        null=True,
        blank=True,
        help_text="Sanitized confirmation snapshot. Never holds card data or credentials.",
    )
    status = models.CharField(
        max_length=15, choices=PaymentStatus.choices, default=PaymentStatus.PENDING
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    received_by = models.UUIDField(
        null=True, blank=True, help_text="Null for a gateway or voucher self-service payment."
    )
    idempotency_key = models.CharField(max_length=80, null=True, blank=True)

    class Meta:
        db_table = "payments"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="payments_amount_positive",
            ),
            # A confirmed payment has a time. Without it the collection report
            # cannot bucket by day and the student ledger cannot order itself.
            models.CheckConstraint(
                condition=(
                    ~models.Q(status=PaymentStatus.CONFIRMED) | models.Q(paid_at__isnull=False)
                ),
                name="payments_confirmed_has_a_time",
            ),
            models.CheckConstraint(
                condition=(
                    ~models.Q(method=PaymentMethod.ONLINE_GATEWAY)
                    | models.Q(gateway_provider__isnull=False)
                ),
                name="payments_gateway_names_its_provider",
            ),
            models.UniqueConstraint(
                fields=["tenant", "idempotency_key"],
                name="payments_idempotency_key_unique",
                condition=models.Q(deleted_at__isnull=True, idempotency_key__isnull=False),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "fee_invoice"]),
            models.Index(fields=["tenant", "student", "paid_at"]),
            models.Index(fields=["tenant", "status", "method"]),
        ]

    def __str__(self) -> str:
        return f"{self.amount} {self.method} for {self.fee_invoice_id}"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — see `FeeInvoice.filter_owned_by_user`."""
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.student_management.models import Student

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        return queryset.filter(student__in=visible)


class Receipt(TenantOwnedModel):
    """The numbered acknowledgement of one confirmed payment.

    1:1 with a payment and created in the same transaction, because a payment a
    parent has no receipt for is a payment they cannot prove they made. The
    number is gapless through `core.tenancy.sequences` for the same reason
    invoice numbers are: a receipt book with holes in it is what an auditor asks
    about first.

    `amount` is a snapshot rather than a join to the payment. A receipt is a
    document handed over at a moment in time; if the payment were ever adjusted,
    the piece of paper in the parent's hand would still say what it said.
    """

    payment = models.OneToOneField(Payment, on_delete=models.PROTECT, related_name="receipt")
    receipt_no = models.CharField(max_length=30)
    issued_at = models.DateTimeField(auto_now_add=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    pdf_file = models.ForeignKey(
        "files.File",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="fee_receipts",
        db_column="pdf_file_id",
    )

    class Meta:
        db_table = "receipts"
        ordering = ["-issued_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "receipt_no"],
                name="receipts_no_unique",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="receipts_amount_positive",
            ),
        ]
        indexes = [models.Index(fields=["tenant", "issued_at"])]

    def __str__(self) -> str:
        return self.receipt_no

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own`, resolved through the payment's student."""
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.student_management.models import Student

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        return queryset.filter(payment__student__in=visible)


class Refund(TenantOwnedModel):
    """A request to return money, under §7.3's approval workflow.

    **The approver may not be the requester**, and that is a service check
    rather than only a constraint, because the rule is the module's: it has to
    hold when a later caller approves through some other door. The constraint
    below is the half a CHECK can hold — both columns are on the row.

    `amount` is bounded by the *refundable remainder* of the payment, not by the
    payment itself: two partial refunds against one payment must not together
    exceed it. That is a set-level rule and lives in `services`.
    """

    payment = models.ForeignKey(Payment, on_delete=models.PROTECT, related_name="refunds")
    student = models.ForeignKey(
        "student_management.Student", on_delete=models.PROTECT, related_name="fee_refunds"
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.TextField()
    status = models.CharField(
        max_length=15, choices=RefundStatus.choices, default=RefundStatus.REQUESTED
    )
    requested_by = models.UUIDField()
    approved_by = models.UUIDField(null=True, blank=True)
    decision_note = models.TextField(null=True, blank=True)
    method = models.CharField(max_length=20, choices=PaymentMethod.choices, null=True, blank=True)
    reference_no = models.CharField(max_length=80, null=True, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    idempotency_key = models.CharField(max_length=80, null=True, blank=True)

    class Meta:
        db_table = "refunds"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="refunds_amount_positive",
            ),
            # Segregation of duties, as far as a CHECK can carry it. The service
            # holds the rest — a constraint cannot know who is asking.
            models.CheckConstraint(
                condition=(
                    models.Q(approved_by__isnull=True)
                    | ~models.Q(approved_by=models.F("requested_by"))
                ),
                name="refunds_approver_is_not_the_requester",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(status=RefundStatus.REQUESTED) | models.Q(approved_by__isnull=False)
                ),
                name="refunds_decision_is_attributable",
            ),
            models.CheckConstraint(
                condition=(
                    ~models.Q(status=RefundStatus.PROCESSED)
                    | (models.Q(processed_at__isnull=False) & models.Q(method__isnull=False))
                ),
                name="refunds_processed_records_how_and_when",
            ),
            models.UniqueConstraint(
                fields=["tenant", "idempotency_key"],
                name="refunds_idempotency_key_unique",
                condition=models.Q(deleted_at__isnull=True, idempotency_key__isnull=False),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "status"]),
            models.Index(fields=["tenant", "payment"]),
            models.Index(fields=["tenant", "student"]),
        ]

    def __str__(self) -> str:
        return f"Refund {self.amount} ({self.status})"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — see `FeeInvoice.filter_owned_by_user`."""
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.student_management.models import Student

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        return queryset.filter(student__in=visible)


class FeeVoucher(TenantOwnedModel):
    """A printable slip payable off-platform at a bank counter or wallet agent.

    §7.2's flow, and the reason it exists: most of the families this platform
    serves pay at a bank branch, not with a card. The voucher carries a consumer
    number the provider's own systems key on, and a daily settlement file
    matches paid vouchers back to invoices.

    **A voucher is never edited once issued** — a correction voids it and issues
    a new one, mirroring the append-only money rule §7.2 states outright. It is
    also voided automatically once the invoice settles by any other channel, so
    a parent who paid at the counter cannot also pay the voucher at a bank.

    `amount` is a snapshot of the balance at issuance. If the balance later
    changes, the printed slip still says what the bank will collect — which is
    exactly why the settlement matcher compares against the *voucher*, not
    against the live invoice.
    """

    fee_invoice = models.ForeignKey(FeeInvoice, on_delete=models.PROTECT, related_name="vouchers")
    student = models.ForeignKey(
        "student_management.Student", on_delete=models.PROTECT, related_name="fee_vouchers"
    )
    provider = models.CharField(max_length=40, choices=VoucherProvider.choices)
    consumer_number = models.CharField(max_length=60)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    due_date = models.DateField()
    status = models.CharField(
        max_length=15, choices=VoucherStatus.choices, default=VoucherStatus.ISSUED
    )
    payment = models.ForeignKey(
        Payment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="vouchers",
        help_text="Set when a settlement row matches.",
    )
    voided_reason = models.TextField(null=True, blank=True)
    issued_by = models.UUIDField()

    class Meta:
        db_table = "fee_vouchers"
        ordering = ["-created_at"]
        constraints = [
            # The provider's own key. Two live vouchers sharing one consumer
            # number would make a settlement row ambiguous about which invoice
            # it paid — the one thing the matcher cannot recover from.
            models.UniqueConstraint(
                fields=["tenant", "provider", "consumer_number"],
                name="fee_vouchers_consumer_number_unique",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="fee_vouchers_amount_positive",
            ),
            models.CheckConstraint(
                condition=(~models.Q(status=VoucherStatus.PAID) | models.Q(payment__isnull=False)),
                name="fee_vouchers_paid_names_its_payment",
            ),
            models.CheckConstraint(
                condition=(
                    ~models.Q(status=VoucherStatus.VOID)
                    | (models.Q(voided_reason__isnull=False) & ~models.Q(voided_reason=""))
                ),
                name="fee_vouchers_void_is_attributable",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "fee_invoice"]),
            models.Index(fields=["tenant", "status", "due_date"]),
        ]

    def __str__(self) -> str:
        return f"{self.provider} {self.consumer_number}"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — a family downloads their own voucher to pay it."""
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        from apps.student_management.models import Student

        visible = Student.filter_owned_by_user(Student.objects.alive(), user)
        return queryset.filter(student__in=visible)


class VoucherCollectionImport(TenantOwnedModel):
    """One settlement file and what came of it.

    `exceptions` is a JSONB list rather than a table on purpose: an unmatched row
    is a work item an accountant resolves the same day, not a record with a
    lifecycle. §7.2 asks that a row that cannot be matched land in a queue for
    manual review rather than failing the file — one bank's typo must not stop
    the other four hundred rows posting.
    """

    provider = models.CharField(max_length=40, choices=VoucherProvider.choices)
    file = models.ForeignKey(
        "files.File",
        on_delete=models.PROTECT,
        related_name="voucher_imports",
        db_column="file_id",
    )
    imported_by = models.UUIDField()
    status = models.CharField(
        max_length=15, choices=ImportStatus.choices, default=ImportStatus.PROCESSING
    )
    row_count = models.PositiveIntegerField(default=0)
    matched_count = models.PositiveIntegerField(default=0)
    exceptions = models.JSONField(
        default=list,
        blank=True,
        help_text="Unmatched rows: {row, provider_reference, amount, reason}.",
    )
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "voucher_collection_imports"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(matched_count__lte=models.F("row_count")),
                name="voucher_imports_matched_within_rows",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "provider", "created_at"]),
            models.Index(fields=["tenant", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.provider} import ({self.matched_count}/{self.row_count})"


class SettlementRow(TenantOwnedModel):
    """One line of a settlement file, kept so a re-import cannot post twice.

    **Not in §15's table list, and added deliberately.** §11 requires that "a
    settlement-file row can post at most once, keyed on
    `(provider, consumer_number, transaction_reference)`" — and a rule about
    what may happen *at most once* needs somewhere to record that it happened.
    Without this table the guarantee would rest on the voucher's status alone,
    which cannot distinguish "already posted by this exact row" from "paid by
    some other channel", and re-importing yesterday's file is a normal
    operational event rather than an error.

    Recorded in §20 as a schema addition, with this reasoning.
    """

    voucher_import = models.ForeignKey(
        VoucherCollectionImport, on_delete=models.CASCADE, related_name="rows"
    )
    provider = models.CharField(max_length=40, choices=VoucherProvider.choices)
    consumer_number = models.CharField(max_length=60)
    transaction_reference = models.CharField(max_length=80)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    paid_on = models.DateField()
    payment = models.ForeignKey(
        Payment, on_delete=models.SET_NULL, null=True, blank=True, related_name="settlement_rows"
    )

    class Meta:
        db_table = "voucher_settlement_rows"
        ordering = ["-paid_on"]
        constraints = [
            # §11's match key, as an index. This is what makes a re-import a
            # no-op rather than a double posting.
            models.UniqueConstraint(
                fields=["tenant", "provider", "consumer_number", "transaction_reference"],
                name="settlement_rows_match_key_unique",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [models.Index(fields=["tenant", "voucher_import"])]

    def __str__(self) -> str:
        return f"{self.provider} {self.transaction_reference}"
