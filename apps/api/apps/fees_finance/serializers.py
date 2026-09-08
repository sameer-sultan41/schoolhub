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
    FeeFrequency,
    FeeHead,
    FeeSchedule,
    FeeStructure,
    LedgerAccount,
    LedgerEntry,
)
from core.money import MONEY_MAX


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
