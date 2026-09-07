"""Query filters for the fees-finance module.

**Every FK filter is an explicit `UUIDFilter`, never a `Meta.fields` entry.**
A `ModelChoiceFilter` — which `Meta.fields` generates for a relation — builds
its validation queryset at import time, with no tenant bound. Under RLS that
queryset is empty, so the filter answers 400 for the caller's own ids. This is
`timetable/filters.py`'s documented reasoning and it holds identically here.
"""

from __future__ import annotations

import django_filters

from apps.fees_finance.models import (
    Discount,
    FeeHead,
    FeeInvoice,
    FeeSchedule,
    FeeStructure,
    Fine,
    InvoiceStatus,
    LedgerAccount,
    LedgerEntry,
    Scholarship,
)


class LedgerAccountFilterSet(django_filters.FilterSet):
    account_type = django_filters.CharFilter(field_name="account_type", lookup_expr="exact")
    parent_id = django_filters.UUIDFilter(field_name="parent_id")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    is_system = django_filters.BooleanFilter(field_name="is_system")

    class Meta:
        model = LedgerAccount
        fields: list[str] = []


class LedgerEntryFilterSet(django_filters.FilterSet):
    account = django_filters.UUIDFilter(field_name="ledger_account_id")
    transaction_id = django_filters.UUIDFilter(field_name="transaction_id")
    reference_type = django_filters.CharFilter(field_name="reference_type", lookup_expr="exact")
    reference_id = django_filters.UUIDFilter(field_name="reference_id")
    date__gte = django_filters.DateFilter(field_name="entry_date", lookup_expr="gte")
    date__lte = django_filters.DateFilter(field_name="entry_date", lookup_expr="lte")
    # A reversed posting and its reversal both stay in the ledger, so a plain
    # list shows both by design. This is how a reader asks for only what still
    # stands: `is_reversed=false` excludes rows that have been superseded.
    is_reversed = django_filters.BooleanFilter(
        field_name="reversed_by_transaction_id", lookup_expr="isnull", exclude=True
    )

    class Meta:
        model = LedgerEntry
        fields: list[str] = []


class FeeHeadFilterSet(django_filters.FilterSet):
    category = django_filters.CharFilter(field_name="category", lookup_expr="exact")
    ledger_account_id = django_filters.UUIDFilter(field_name="ledger_account_id")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    is_refundable = django_filters.BooleanFilter(field_name="is_refundable")

    class Meta:
        model = FeeHead
        fields: list[str] = []


class FeeStructureFilterSet(django_filters.FilterSet):
    academic_session_id = django_filters.UUIDFilter(field_name="academic_session_id")
    class_id = django_filters.UUIDFilter(field_name="school_class_id")
    campus_id = django_filters.UUIDFilter(field_name="campus_id")
    status = django_filters.CharFilter(field_name="status", lookup_expr="exact")

    class Meta:
        model = FeeStructure
        fields: list[str] = []


class FeeScheduleFilterSet(django_filters.FilterSet):
    fee_structure_id = django_filters.UUIDFilter(field_name="fee_structure_id")
    fee_head_id = django_filters.UUIDFilter(field_name="fee_head_id")
    term_id = django_filters.UUIDFilter(field_name="term_id")
    frequency = django_filters.CharFilter(field_name="frequency", lookup_expr="exact")

    class Meta:
        model = FeeSchedule
        fields: list[str] = []


class FeeInvoiceFilterSet(django_filters.FilterSet):
    student = django_filters.UUIDFilter(field_name="student_id")
    academic_session_id = django_filters.UUIDFilter(field_name="academic_session_id")
    fee_structure_id = django_filters.UUIDFilter(field_name="fee_structure_id")
    status = django_filters.CharFilter(field_name="status", lookup_expr="exact")
    period_label = django_filters.CharFilter(field_name="period_label", lookup_expr="exact")
    due_date__lte = django_filters.DateFilter(field_name="due_date", lookup_expr="lte")
    due_date__gte = django_filters.DateFilter(field_name="due_date", lookup_expr="gte")
    # §13's defaulter list in one query: everything still owing money. `status`
    # alone cannot express it, because a partially-paid invoice owes a balance
    # while an overdue one with a zero balance does not.
    outstanding = django_filters.BooleanFilter(
        field_name="balance_due", lookup_expr="gt", exclude=False, method="filter_outstanding"
    )

    class Meta:
        model = FeeInvoice
        fields: list[str] = []

    def filter_outstanding(self, queryset, name, value):
        if value is None:
            return queryset
        if value:
            return queryset.filter(balance_due__gt=0).exclude(status=InvoiceStatus.CANCELED)
        return queryset.filter(balance_due__lte=0)


class DiscountFilterSet(django_filters.FilterSet):
    student = django_filters.UUIDFilter(field_name="student_id")
    academic_session_id = django_filters.UUIDFilter(field_name="academic_session_id")
    fee_head_id = django_filters.UUIDFilter(field_name="fee_head_id")
    discount_type = django_filters.CharFilter(field_name="discount_type", lookup_expr="exact")
    status = django_filters.CharFilter(field_name="status", lookup_expr="exact")

    class Meta:
        model = Discount
        fields: list[str] = []


class ScholarshipFilterSet(django_filters.FilterSet):
    student = django_filters.UUIDFilter(field_name="student_id")
    academic_session_id = django_filters.UUIDFilter(field_name="academic_session_id")
    scholarship_type = django_filters.CharFilter(field_name="scholarship_type", lookup_expr="exact")
    status = django_filters.CharFilter(field_name="status", lookup_expr="exact")
    sponsor = django_filters.CharFilter(field_name="sponsor", lookup_expr="icontains")

    class Meta:
        model = Scholarship
        fields: list[str] = []


class FineFilterSet(django_filters.FilterSet):
    student = django_filters.UUIDFilter(field_name="student_id")
    fee_head_id = django_filters.UUIDFilter(field_name="fee_head_id")
    fine_type = django_filters.CharFilter(field_name="fine_type", lookup_expr="exact")
    status = django_filters.CharFilter(field_name="status", lookup_expr="exact")
    source_module = django_filters.CharFilter(field_name="source_module", lookup_expr="exact")

    class Meta:
        model = Fine
        fields: list[str] = []
