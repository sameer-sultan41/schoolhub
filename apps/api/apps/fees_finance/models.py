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
    the uniqueness rule below a five-column one over NULL-able columns, and
    PostgreSQL treats NULLs as distinct in a unique index — so two session-wide
    structures with the same name would *both* be allowed. The name is included
    in the key precisely so the collision that matters ("two structures called
    the same thing at the same scope") is still caught; `services` holds the
    narrower rule that two *active* structures must not overlap in scope, which
    no index can express.

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
