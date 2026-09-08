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
    FeeVoucher,
    Fine,
    GrantValueType,
    LedgerAccount,
    LedgerEntry,
    Payment,
    PaymentMethod,
    Receipt,
    Refund,
    Scholarship,
    VoucherCollectionImport,
    VoucherProvider,
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
        parent = attrs.get("parent") or getattr(self.instance, "parent", None)
        account_type = attrs.get("account_type") or getattr(self.instance, "account_type", None)
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
        return _validate_grant_value(
            attrs,
            instance=self.instance,
            type_field="coverage_type",
        )


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


class PaymentSerializer(serializers.ModelSerializer):
    receipt_no = serializers.CharField(source="receipt.receipt_no", read_only=True)

    class Meta:
        model = Payment
        fields = [
            "id",
            "fee_invoice",
            "student",
            "amount",
            "method",
            "reference_no",
            "gateway_provider",
            "status",
            "paid_at",
            "received_by",
            "receipt_no",
            "created_at",
        ]
        # `gateway_payload` is deliberately absent from the field list: it holds
        # a provider's confirmation snapshot, and echoing it back to a client is
        # how a sanitized blob stops being sanitized.
        read_only_fields = [
            "id",
            "student",
            "status",
            "paid_at",
            "received_by",
            "receipt_no",
            "created_at",
        ]


class RecordPaymentSerializer(serializers.Serializer):
    """⚿ `POST /payments` — money in, at a counter or by bank transfer."""

    fee_invoice = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    method = serializers.ChoiceField(choices=PaymentMethod.choices)
    reference_no = serializers.CharField(max_length=80, required=False, allow_null=True)

    def validate_amount(self, value: Decimal) -> Decimal:
        if value <= 0:
            raise serializers.ValidationError("A payment must be for a positive amount.")
        if value > MONEY_MAX:
            raise serializers.ValidationError(
                f"An amount above {MONEY_MAX} does not fit a money column."
            )
        return value

    def validate(self, attrs: dict) -> dict:
        """A cheque or transfer without a reference cannot be reconciled.

        Cash needs none — the receipt is the reference — but a bank line with no
        reference is a line an accountant cannot match to a statement, which is
        the whole job the collection report exists to make possible.
        """
        needs_reference = {PaymentMethod.CHEQUE, PaymentMethod.BANK_TRANSFER}
        if attrs["method"] in needs_reference and not attrs.get("reference_no"):
            raise serializers.ValidationError(
                {
                    "reference_no": (
                        f"A {attrs['method'].replace('_', ' ')} payment needs its "
                        "reference number to be reconcilable against a statement."
                    )
                }
            )
        if attrs["method"] == PaymentMethod.ONLINE_GATEWAY:
            raise serializers.ValidationError(
                {
                    "method": (
                        "Gateway payments are not accepted through this endpoint. "
                        "The integrations layer they need does not exist yet — see "
                        "§20."
                    )
                }
            )
        return attrs


class ReceiptSerializer(serializers.ModelSerializer):
    student_name = serializers.SerializerMethodField()
    invoice_no = serializers.CharField(source="payment.fee_invoice.invoice_no", read_only=True)

    class Meta:
        model = Receipt
        fields = [
            "id",
            "receipt_no",
            "payment",
            "invoice_no",
            "student_name",
            "amount",
            "issued_at",
            "pdf_file",
        ]
        read_only_fields = fields

    def get_student_name(self, obj: Receipt) -> str:
        student = obj.payment.student
        return f"{student.first_name} {student.last_name}".strip()


class RefundSerializer(serializers.ModelSerializer):
    # Declared explicitly rather than inferred. `Refund.method` is a genuinely
    # nullable choice field — it is set at processing, so a requested refund has
    # none — and drf-spectacular renders a nullable enum as
    # `(MethodEnum | NullEnum) | null`, a union whose `NullEnum` member
    # duplicates the trailing `null`. The generated TypeScript client then fails
    # `@typescript-eslint/no-duplicate-type-constituents`, and the file is
    # generated so it cannot be lint-fixed by hand.
    #
    # PR A hit the same thing on `ledger_entries.reference_type` and resolved it
    # by making the column NOT NULL, because every posting genuinely has an
    # origin. Here the nullability is real, so the fix belongs on the read side:
    # the field is read-only anyway, and a plain string is what a client does
    # with it.
    method = serializers.CharField(read_only=True, allow_null=True)

    class Meta:
        model = Refund
        fields = [
            "id",
            "payment",
            "student",
            "amount",
            "reason",
            "status",
            "requested_by",
            "approved_by",
            "decision_note",
            "method",
            "reference_no",
            "processed_at",
            "created_at",
        ]
        # Every state transition goes through a colon-action, so none of the
        # lifecycle columns is writable here: a PATCH that could set `status` to
        # `processed` would pay out money with no approval behind it.
        read_only_fields = [
            "id",
            "student",
            "status",
            "requested_by",
            "approved_by",
            "decision_note",
            "method",
            "reference_no",
            "processed_at",
            "created_at",
        ]


class RequestRefundSerializer(serializers.Serializer):
    """⚿ `POST /refunds` — §7.3 step one."""

    payment = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    reason = serializers.CharField(max_length=2000)

    def validate_amount(self, value: Decimal) -> Decimal:
        if value <= 0:
            raise serializers.ValidationError("A refund must be for a positive amount.")
        return value


class RefundDecisionSerializer(serializers.Serializer):
    """`:approve` / `:reject` — the note is optional on approval, not on refusal."""

    note = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class ProcessRefundSerializer(serializers.Serializer):
    """⚿ `:process` — how the money actually went back."""

    method = serializers.ChoiceField(choices=PaymentMethod.choices)
    reference_no = serializers.CharField(max_length=80, required=False, allow_null=True)


class FeeVoucherSerializer(serializers.ModelSerializer):
    student_name = serializers.SerializerMethodField()
    invoice_no = serializers.CharField(source="fee_invoice.invoice_no", read_only=True)

    class Meta:
        model = FeeVoucher
        fields = [
            "id",
            "fee_invoice",
            "invoice_no",
            "student",
            "student_name",
            "provider",
            "consumer_number",
            "amount",
            "due_date",
            "status",
            "payment",
            "voided_reason",
            "issued_by",
            "created_at",
        ]
        # Everything but the provider is derived at issuance: the consumer
        # number is generated, the amount is a snapshot of the balance, and the
        # due date comes from tenant settings. A client that could set the
        # amount could print a voucher for a figure the invoice does not owe.
        read_only_fields = fields

    def get_student_name(self, obj: FeeVoucher) -> str:
        return f"{obj.student.first_name} {obj.student.last_name}".strip()


class IssueVoucherSerializer(serializers.Serializer):
    provider = serializers.ChoiceField(choices=VoucherProvider.choices)
    validity_days = serializers.IntegerField(required=False, min_value=1, max_value=365)


class VoucherCollectionImportSerializer(serializers.ModelSerializer):
    class Meta:
        model = VoucherCollectionImport
        fields = [
            "id",
            "provider",
            "file",
            "imported_by",
            "status",
            "row_count",
            "matched_count",
            "exceptions",
            "completed_at",
            "created_at",
        ]
        read_only_fields = fields
