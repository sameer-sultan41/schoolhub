"""§13's report rows and the student statement, as typed response shapes.

One serializer per `kind`, mirroring what `reports.py` emits field for field,
so the generated client types every report instead of an untyped list
(ADR-0005, ADR-0022). `reports.py` itself keeps returning plain dicts — the CSV
writer and the PDF renderer read those — so the renames below (`student__admission_number`
-> `admission_number`) are the wire shape only; an export's columns are unchanged.

`kind` is the discriminator: `serialize_report_rows` adds it, and
`REPORT_ROW_SERIALIZERS` dispatches on it at runtime while
`PolymorphicProxySerializer` only documents it.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.fees_finance.models import (
    ExpenseStatus,
    GrantValueType,
    LedgerAccountType,
    PaymentMethod,
)

#: The `kind` of a student statement line. Declared once: the statement endpoint's
#: rows and the `student-ledger` report's `entry_type` both use it, and
#: `ENUM_NAME_OVERRIDES` pins one component name to it.
STATEMENT_ENTRY_KINDS = [("invoice", "invoice"), ("payment", "payment"), ("refund", "refund")]
#: The `grant-register` row's own `kind` values (a discount, a scholarship, a waived fine).
GRANT_KINDS = [
    ("discount", "discount"),
    ("scholarship", "scholarship"),
    ("fine_waiver", "fine_waiver"),
]


def _report_kind(kind: str) -> serializers.ChoiceField:
    """The discriminator: a one-value choice, so the schema names each row type's `kind`."""
    return serializers.ChoiceField(choices=[(kind, kind)], read_only=True)


def _money() -> serializers.DecimalField:
    return serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)


class CollectionReportRowSerializer(serializers.Serializer):
    """`reports.collection_report`: confirmed money by day, method or cashier.

    The row carries only the key it was grouped by; the other two are null.
    They are not `read_only` so the schema does not list them as always present.
    """

    kind = _report_kind("collection")
    day = serializers.DateField(required=False, allow_null=True)
    method = serializers.ChoiceField(choices=PaymentMethod.choices, required=False, allow_null=True)
    received_by = serializers.UUIDField(required=False, allow_null=True)
    total = _money()
    count = serializers.IntegerField(read_only=True)


class OutstandingAgingReportRowSerializer(serializers.Serializer):
    """`reports.outstanding_and_aging`: one student's balance, bucketed by days past due."""

    kind = _report_kind("outstanding-aging")
    student_id = serializers.UUIDField(read_only=True)
    admission_number = serializers.CharField(source="student__admission_number", read_only=True)
    first_name = serializers.CharField(source="student__first_name", read_only=True)
    last_name = serializers.CharField(source="student__last_name", read_only=True)
    total_outstanding = _money()
    invoice_count = serializers.IntegerField(read_only=True)
    not_yet_due = _money()
    bucket_0_30 = _money()
    bucket_31_60 = _money()
    bucket_61_90 = _money()
    bucket_90_plus = _money()


class StudentStatementEntrySerializer(serializers.Serializer):
    """One line of a student's statement: a charge, a payment or a refund, with its running balance.

    The wire shape of `GET /students/{id}/ledger`. `kind` here is the line's own
    type, so the report row (which needs `kind` for the discriminator) carries it
    as `entry_type` instead.
    """

    date = serializers.DateField(read_only=True, allow_null=True)
    kind = serializers.ChoiceField(choices=STATEMENT_ENTRY_KINDS, read_only=True)
    reference = serializers.CharField(read_only=True)
    description = serializers.CharField(read_only=True)
    debit = _money()
    credit = _money()
    balance = _money()


class StudentLedgerReportRowSerializer(serializers.Serializer):
    """`reports.student_ledger`: a statement line, the discriminator on `kind`."""

    kind = _report_kind("student-ledger")
    entry_type = serializers.ChoiceField(choices=STATEMENT_ENTRY_KINDS, read_only=True)
    date = serializers.DateField(read_only=True, allow_null=True)
    reference = serializers.CharField(read_only=True)
    description = serializers.CharField(read_only=True)
    debit = _money()
    credit = _money()
    balance = _money()


class GrantRegisterReportRowSerializer(serializers.Serializer):
    """`reports.grant_and_waiver_register`: a reduction granted or a fine waived, and by whom.

    `grant_type` is the source's own `kind` (a discount, a scholarship or a waived
    fine); `status` is that source's status, so it is not one fixed set.
    """

    kind = _report_kind("grant-register")
    id = serializers.UUIDField(read_only=True)
    grant_type = serializers.ChoiceField(choices=GRANT_KINDS, read_only=True)
    name = serializers.CharField(read_only=True)
    value_type = serializers.ChoiceField(choices=GrantValueType.choices, read_only=True)
    value = _money()
    status = serializers.CharField(read_only=True)
    approved_by = serializers.UUIDField(read_only=True, allow_null=True)
    admission_number = serializers.CharField(read_only=True)
    granted_at = serializers.DateTimeField(read_only=True)


class _AccountTotalsRowSerializer(serializers.Serializer):
    """The ledger-account columns the two ledger reports share."""

    ledger_account_id = serializers.UUIDField(read_only=True)
    account_type = serializers.ChoiceField(choices=LedgerAccountType.choices, read_only=True)
    total_debit = _money()
    total_credit = _money()


class IncomeVsExpenseReportRowSerializer(_AccountTotalsRowSerializer):
    """`reports.income_vs_expense`: an income or expense account's net over the period."""

    kind = _report_kind("income-vs-expense")
    code = serializers.CharField(source="ledger_account__code", read_only=True)
    name = serializers.CharField(source="ledger_account__name", read_only=True)
    net = _money()


class TrialBalanceReportRowSerializer(_AccountTotalsRowSerializer):
    """`ledger.trial_balance`: every account's debit and credit totals, and their difference."""

    kind = _report_kind("trial-balance")
    code = serializers.CharField(read_only=True)
    name = serializers.CharField(read_only=True)
    balance = _money()


class BudgetVarianceReportRowSerializer(serializers.Serializer):
    """`reports.budget_variance`: one approved budget against its actual spend."""

    kind = _report_kind("budget-variance")
    budget_id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    period_start = serializers.DateField(read_only=True)
    period_end = serializers.DateField(read_only=True)
    budgeted = _money()
    actual = _money()
    variance = _money()
    utilisation_percent = _money()


class ExpenseRegisterReportRowSerializer(serializers.Serializer):
    """`reports.expense_register`: one expense, whatever its status."""

    kind = _report_kind("expense-register")
    id = serializers.UUIDField(read_only=True)
    expense_no = serializers.CharField(read_only=True)
    expense_date = serializers.DateField(read_only=True)
    vendor_name = serializers.CharField(read_only=True, allow_null=True)
    description = serializers.CharField(read_only=True)
    amount = _money()
    tax_amount = _money()
    status = serializers.ChoiceField(choices=ExpenseStatus.choices, read_only=True)
    approved_by = serializers.UUIDField(read_only=True, allow_null=True)
    category_code = serializers.CharField(source="expense_category__code", read_only=True)
    category_name = serializers.CharField(source="expense_category__name", read_only=True)
    campus_name = serializers.CharField(source="campus__name", read_only=True, allow_null=True)


#: The runtime dispatch, by `kind`; `PolymorphicProxySerializer` only documents it (ADR-0022).
#: Keyed like `reports.REPORT_KINDS`; a test holds the two equal.
REPORT_ROW_SERIALIZERS: dict[str, type[serializers.Serializer]] = {
    "collection": CollectionReportRowSerializer,
    "outstanding-aging": OutstandingAgingReportRowSerializer,
    "student-ledger": StudentLedgerReportRowSerializer,
    "grant-register": GrantRegisterReportRowSerializer,
    "income-vs-expense": IncomeVsExpenseReportRowSerializer,
    "budget-variance": BudgetVarianceReportRowSerializer,
    "expense-register": ExpenseRegisterReportRowSerializer,
    "trial-balance": TrialBalanceReportRowSerializer,
}

#: Kinds whose raw rows already use `kind` for something else; the row's own value
#: moves to the named field so the discriminator can take `kind`.
_ROW_KIND_MOVES_TO = {"student-ledger": "entry_type", "grant-register": "grant_type"}


def serialize_report_rows(kind: str, rows: list[dict]) -> list[dict]:
    """The wire rows for `kind`: each carries `kind` as the discriminator (ADR-0022)."""
    moved = _ROW_KIND_MOVES_TO.get(kind)
    prepared = [{**row, "kind": kind, **({moved: row["kind"]} if moved else {})} for row in rows]
    return REPORT_ROW_SERIALIZERS[kind](prepared, many=True).data


class ReportMetaSerializer(serializers.Serializer):
    """`meta` of `GET /reports/finance-summary`: what ran, and over what window."""

    kind = serializers.ChoiceField(choices=[(kind, kind) for kind in REPORT_ROW_SERIALIZERS])
    row_count = serializers.IntegerField()
    date_from = serializers.DateField()
    date_to = serializers.DateField()


class StudentLedgerMetaSerializer(serializers.Serializer):
    """`meta` of `GET /students/{id}/ledger`: the line count and the server's closing balance."""

    row_count = serializers.IntegerField()
    closing_balance = serializers.DecimalField(max_digits=12, decimal_places=2)
