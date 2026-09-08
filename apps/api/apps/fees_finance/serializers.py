"""Serializers for the fees-finance module.

Shape validation only. Every rule that needs more than the request body — a fee
head's account type, a structure's scope overlap, a posting's balance — is a
`services.assert_*` or `ledger.*` call, so the API, a management command and a
future import all apply the same checks.
"""

from __future__ import annotations

from decimal import Decimal

from rest_framework import serializers

from apps.fees_finance import services
from apps.fees_finance.models import (
    Discount,
    FeeFrequency,
    FeeHead,
    FeeHeadCategory,
    FeeInvoice,
    FeeInvoiceLine,
    FeeSchedule,
    FeeStructure,
    Fine,
    GrantValueType,
    LedgerAccount,
    LedgerEntry,
    Scholarship,
    ScholarshipStatus,
)
from core.money import MONEY_MAX, quantize_money


class LedgerAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = LedgerAccount
        fields = [
            "id",
            "code",
            "name",
            "account_type",
            "parent",
            "is_system",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_system", "created_at", "updated_at"]

    def validate(self, attrs: dict) -> dict:
        # `"parent" in attrs`, not `attrs.get("parent") or ...`: the `or` form
        # cannot tell "the client explicitly sent null to clear it" from "the
        # client didn't mention this field at all", and silently falls back to
        # the instance's stale value in the first case — which validates the
        # wrong intended parent and can raise a spurious type-mismatch error
        # against a client trying to clear it.
        parent = attrs["parent"] if "parent" in attrs else getattr(self.instance, "parent", None)
        account_type = (
            attrs["account_type"]
            if "account_type" in attrs
            else getattr(self.instance, "account_type", None)
        )
        if parent is not None and parent.account_type != account_type:
            raise serializers.ValidationError(
                {
                    "parent": (
                        f"A child account must have its parent's type. "
                        f"{parent.code} is {parent.get_account_type_display().lower()}."
                    )
                }
            )
        if parent is not None and self.instance is not None and parent.pk == self.instance.pk:
            raise serializers.ValidationError({"parent": "An account cannot be its own parent."})

        # Archiving a system account would break collection for the whole
        # tenant, since this module's own postings target them by code.
        if self.instance is not None and attrs.get("is_active") is False:
            services.assert_account_may_be_archived(account=self.instance)
        return attrs


class LedgerEntrySerializer(serializers.ModelSerializer):
    """Read-only. Postings are made by `ledger.post_transaction`, never by a POST.

    There is no create path on this serializer on purpose: a client that could
    insert a single line could insert an unbalanced posting, and the balance rule
    is about the set. `LedgerEntryViewSet` exposes list and retrieve only.
    """

    account_code = serializers.CharField(source="ledger_account.code", read_only=True)
    account_name = serializers.CharField(source="ledger_account.name", read_only=True)

    class Meta:
        model = LedgerEntry
        fields = [
            "id",
            "transaction_id",
            "entry_date",
            "ledger_account",
            "account_code",
            "account_name",
            "debit",
            "credit",
            "reference_type",
            "reference_id",
            "memo",
            "reversed_by_transaction_id",
            "created_at",
        ]
        read_only_fields = fields


class FeeHeadSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeHead
        fields = [
            "id",
            "name",
            "code",
            "category",
            "ledger_account",
            "is_refundable",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_ledger_account(self, value: LedgerAccount) -> LedgerAccount:
        services.assert_fee_head_account_is_income(ledger_account=value)
        return value


class FeeScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeSchedule
        fields = [
            "id",
            "fee_structure",
            "fee_head",
            "amount",
            "frequency",
            "term",
            "due_day",
            "due_date",
            "late_fee_policy",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_amount(self, value: Decimal) -> Decimal:
        if value > MONEY_MAX:
            raise serializers.ValidationError(
                f"An amount above {MONEY_MAX} does not fit a money column."
            )
        return value

    def validate(self, attrs: dict) -> dict:
        """Mirror the frequency/due-rule CHECKs so the client gets a field error.

        The database holds these too, and deliberately: the constraint is what
        survives a code path that skips this serializer. But an IntegrityError
        surfaces as a 409 naming a constraint, and a school administrator filling
        in a form deserves to be told which field is wrong.
        """
        frequency = attrs.get("frequency") or getattr(self.instance, "frequency", None)
        term = attrs.get("term", getattr(self.instance, "term", None))
        due_day = attrs.get("due_day", getattr(self.instance, "due_day", None))
        due_date = attrs.get("due_date", getattr(self.instance, "due_date", None))
        errors: dict[str, str] = {}

        if frequency == FeeFrequency.PER_TERM and term is None:
            errors["term"] = "A per-term schedule must name its term."
        if frequency != FeeFrequency.PER_TERM and term is not None:
            errors["term"] = (
                "Only a per-term schedule carries a term; otherwise the same charge "
                "would be billed in every term."
            )
        if frequency == FeeFrequency.MONTHLY and due_day is None:
            errors["due_day"] = "A monthly schedule needs a day-of-month due rule."
        if frequency != FeeFrequency.MONTHLY and due_day is not None:
            errors["due_day"] = "Only a monthly schedule uses a day-of-month due rule."
        if frequency in {FeeFrequency.ONE_TIME, FeeFrequency.ANNUAL} and due_date is None:
            errors["due_date"] = f"A {frequency} schedule needs a fixed due date."
        if frequency not in {FeeFrequency.ONE_TIME, FeeFrequency.ANNUAL} and due_date is not None:
            errors["due_date"] = f"A {frequency} schedule takes its due date from its rule."
        if errors:
            raise serializers.ValidationError(errors)

        structure = attrs.get("fee_structure") or getattr(self.instance, "fee_structure", None)
        if structure is not None:
            services.assert_structure_is_editable(structure=structure)
        # And the structure being left, if `fee_structure` is changing. Without
        # this, a PATCH moving a schedule out of an ACTIVE structure into a
        # draft one only validated the destination — silently re-pricing the
        # active structure invoices were already generated from, which is
        # exactly what this check exists to prevent.
        current_structure = getattr(self.instance, "fee_structure", None)
        if (
            current_structure is not None
            and "fee_structure" in attrs
            and attrs["fee_structure"] != current_structure
        ):
            services.assert_structure_is_editable(structure=current_structure)
        head = attrs.get("fee_head") or getattr(self.instance, "fee_head", None)
        if head is not None and not head.is_active:
            raise serializers.ValidationError(
                {"fee_head": f"{head.code} {head.name} is inactive and takes no new pricing."}
            )
        return attrs


class FeeStructureSerializer(serializers.ModelSerializer):
    schedules = FeeScheduleSerializer(many=True, read_only=True)

    class Meta:
        model = FeeStructure
        fields = [
            "id",
            "name",
            "academic_session",
            "school_class",
            "campus",
            "status",
            "schedules",
            "created_at",
            "updated_at",
        ]
        # `status` moves through :activate and :archive, which run the set-level
        # checks a PATCH would bypass.
        read_only_fields = ["id", "status", "schedules", "created_at", "updated_at"]

    def validate_academic_session(self, value):
        services.assert_session_is_writable(academic_session=value)
        return value


class LedgerLineSerializer(serializers.Serializer):
    """One line of a manual journal entry."""

    ledger_account = serializers.UUIDField()
    debit = serializers.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    credit = serializers.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    memo = serializers.CharField(max_length=255, required=False, allow_null=True)

    def validate(self, attrs: dict) -> dict:
        debit = attrs.get("debit") or Decimal("0.00")
        credit = attrs.get("credit") or Decimal("0.00")
        if debit < 0 or credit < 0:
            raise serializers.ValidationError(
                "A negative amount on one side is the other side; use the other field."
            )
        if bool(debit) == bool(credit):
            raise serializers.ValidationError(
                "Each line carries exactly one of debit or credit, and it must be positive."
            )
        return attrs


class ManualJournalSerializer(serializers.Serializer):
    """`POST /ledger-entries:post-journal` — §8's hand-written journal entry."""

    entry_date = serializers.DateField()
    memo = serializers.CharField(max_length=255)
    lines = LedgerLineSerializer(many=True)

    def validate_lines(self, value: list[dict]) -> list[dict]:
        if len(value) < 2:
            raise serializers.ValidationError(
                "A double-entry posting has at least two lines — one debit and one credit."
            )
        return value


class FeeInvoiceLineSerializer(serializers.ModelSerializer):
    fee_head_code = serializers.CharField(source="fee_head.code", read_only=True)
    net_amount = serializers.SerializerMethodField()

    class Meta:
        model = FeeInvoiceLine
        fields = [
            "id",
            "fee_head",
            "fee_head_code",
            "description",
            "amount",
            "discount_amount",
            "net_amount",
            "source_type",
            "source_id",
        ]
        read_only_fields = fields

    def get_net_amount(self, obj: FeeInvoiceLine) -> Decimal:
        """What this line actually costs, computed rather than stored.

        A stored net could drift from `amount - discount_amount`, and the header
        already carries the totals a client sums. One derived field is cheaper
        than a fourth column the CHECK constraints would have to police.
        """
        return quantize_money(obj.amount - obj.discount_amount)


class FeeInvoiceSerializer(serializers.ModelSerializer):
    lines = FeeInvoiceLineSerializer(many=True, read_only=True)
    student_name = serializers.SerializerMethodField()

    class Meta:
        model = FeeInvoice
        fields = [
            "id",
            "invoice_no",
            "student",
            "student_name",
            "student_enrollment",
            "academic_session",
            "fee_structure",
            "period_label",
            "issue_date",
            "due_date",
            "status",
            "subtotal",
            "discount_total",
            "fine_total",
            "paid_total",
            "balance_due",
            "canceled_reason",
            "lines",
            "created_at",
            "updated_at",
        ]
        # Every money column and the number are service-owned. A PATCH that
        # could move `paid_total` would let a client mark a bill paid without a
        # payment, and one that could move `balance_due` alone would violate the
        # derived-total CHECK — the serializer refuses before the database has to.
        read_only_fields = [
            "id",
            "invoice_no",
            "status",
            "subtotal",
            "discount_total",
            "fine_total",
            "paid_total",
            "balance_due",
            "canceled_reason",
            "lines",
            "created_at",
            "updated_at",
        ]

    def get_student_name(self, obj: FeeInvoice) -> str:
        student = obj.student
        return f"{student.first_name} {student.last_name}".strip()


class GenerateInvoicesSerializer(serializers.Serializer):
    """`POST /fee-invoices:generate` — one structure, one period.

    Exactly one of `period_start` (a calendar month) or `term` names the period.
    A per-term run takes its whole window from the term, so accepting both would
    leave `period_start` silently ignored — and a caller who passed the wrong
    month would get correct-looking invoices for a period they did not ask for.
    """

    fee_structure = serializers.UUIDField()
    period_start = serializers.DateField(required=False, allow_null=True)
    term = serializers.UUIDField(required=False, allow_null=True)

    def validate(self, attrs: dict) -> dict:
        period_start = attrs.get("period_start")
        term = attrs.get("term")
        if bool(period_start) == bool(term):
            raise serializers.ValidationError(
                "Name exactly one of `period_start` (to bill a calendar month) or "
                "`term` (to bill a whole term)."
            )
        return attrs


class CancelInvoiceSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000)


class DiscountSerializer(serializers.ModelSerializer):
    class Meta:
        model = Discount
        fields = [
            "id",
            "student",
            "academic_session",
            "name",
            "discount_type",
            "value",
            "fee_head",
            "valid_from",
            "valid_to",
            "status",
            "reason",
            "approved_by",
            "created_at",
            "updated_at",
        ]
        # `status` moves through :revoke, which requires a reason and audits.
        # `approved_by` is stamped from the request, never supplied — a grant
        # whose approver a client could name is a grant nobody authorised.
        read_only_fields = ["id", "status", "approved_by", "created_at", "updated_at"]

    def validate(self, attrs: dict) -> dict:
        return _validate_grant_value(
            attrs,
            instance=self.instance,
            type_field="discount_type",
        )


class ScholarshipSerializer(serializers.ModelSerializer):
    class Meta:
        model = Scholarship
        fields = [
            "id",
            "student",
            "academic_session",
            "name",
            "scholarship_type",
            "coverage_type",
            "value",
            "sponsor",
            "status",
            "approved_by",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "approved_by", "created_at", "updated_at"]

    def validate(self, attrs: dict) -> dict:
        attrs = _validate_grant_value(
            attrs,
            instance=self.instance,
            type_field="coverage_type",
        )
        # Ending or revoking an award is a decision with no colon-action of its
        # own — §5.3's lifecycle moves through a plain PATCH — but it must not
        # move through one with no explanation. `notes` is optional everywhere
        # else on this serializer; it stops being optional the moment `status`
        # is heading to a terminal state, which is the same requirement
        # Discount.revoke and Fine.waive both enforce on their own colon-action.
        terminal = {ScholarshipStatus.ENDED, ScholarshipStatus.REVOKED}
        new_status = attrs.get("status")
        if new_status in terminal and not (attrs.get("notes") or "").strip():
            raise serializers.ValidationError(
                {
                    "notes": (
                        f"Say why the award is being {new_status} — an unexplained "
                        "termination of a grant is what an audit flags."
                    )
                }
            )
        return attrs


class FineSerializer(serializers.ModelSerializer):
    class Meta:
        model = Fine
        fields = [
            "id",
            "student",
            "fee_head",
            "fine_type",
            "amount",
            "reason",
            "source_module",
            "source_reference",
            "status",
            "waived_by",
            "waived_reason",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "waived_by",
            "waived_reason",
            "created_at",
            "updated_at",
        ]

    def validate_amount(self, value: Decimal) -> Decimal:
        if value <= 0:
            raise serializers.ValidationError("A fine must be for a positive amount.")
        if value > MONEY_MAX:
            raise serializers.ValidationError(
                f"An amount above {MONEY_MAX} does not fit a money column."
            )
        return value

    def validate_fee_head(self, value: FeeHead) -> FeeHead:
        """§15 says a fine's head has category `fine`.

        Not a CHECK constraint: `category` is on `fee_heads`, and a constraint on
        `fines` cannot read it. Enforced here so a school's income statement
        keeps penalties separate from tuition, which is the reason the category
        exists.
        """
        if value.category != FeeHeadCategory.FINE:
            raise serializers.ValidationError(
                f"A fine must use a fee head in the 'fine' category. "
                f"{value.code} {value.name} is '{value.category}'."
            )
        return value


class WaiveSerializer(serializers.Serializer):
    """Shared by `:waive` and `:revoke`. A reason is not optional.

    §4 gates both behind `fees.*.waive`, and the models' `is_attributable`
    CHECKs refuse a waived row with no reason — so asking for it here turns a
    409 naming a constraint into a field error naming the field.
    """

    reason = serializers.CharField(max_length=2000)


def _validate_grant_value(attrs: dict, *, instance, type_field: str) -> dict:
    """Percent grants are 0-100; fixed grants fit a money column.

    Mirrors the CHECK constraints on both tables. The database is what survives
    a code path that skips this serializer; this is what gives the person filling
    in the form the field name.
    """
    value_type = attrs.get(type_field) or getattr(instance, type_field, None)
    value = attrs.get("value", getattr(instance, "value", None))
    if value is None:
        return attrs

    if value <= 0:
        raise serializers.ValidationError({"value": "A grant must have a positive value."})
    if value_type == GrantValueType.PERCENT and value > 100:
        raise serializers.ValidationError({"value": "A percent grant cannot exceed 100."})
    if value_type == GrantValueType.FIXED and value > MONEY_MAX:
        raise serializers.ValidationError(
            {"value": f"An amount above {MONEY_MAX} does not fit a money column."}
        )

    valid_from = attrs.get("valid_from", getattr(instance, "valid_from", None))
    valid_to = attrs.get("valid_to", getattr(instance, "valid_to", None))
    if valid_from and valid_to and valid_to < valid_from:
        raise serializers.ValidationError({"valid_to": "A grant cannot end before it starts."})
    return attrs
