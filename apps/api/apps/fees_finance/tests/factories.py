"""Factories for the fees-finance tests.

See school_organization/tests/factories.py's module docstring for why every
factory writes through the tenant-scoped default manager inside
``tenant_context(...)``.

Factories owned by other modules are re-exported here rather than imported per
test file, matching examinations/tests/factories.py: fee configuration means
nothing without a session, a class and a campus to scope it to.

**There is no `LedgerEntryFactory`, deliberately.** `ledger_entries` is
append-only and `ledger.post_transaction` is its only write path; a factory that
inserted one line would let a test build a state the application cannot produce
— an unbalanced posting — and then assert something about it. `posting` below is
the helper tests use instead: it goes through the real engine, so a test's
fixture is a state the application could actually reach.
"""

from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import factory

from apps.fees_finance.models import (
    Discount,
    DiscountStatus,
    FeeFrequency,
    FeeHead,
    FeeHeadCategory,
    FeeInvoice,
    FeeInvoiceLine,
    FeeSchedule,
    FeeStructure,
    FeeStructureStatus,
    Fine,
    FineStatus,
    GrantValueType,
    InvoiceStatus,
    LedgerAccount,
    LedgerAccountType,
    LedgerReferenceType,
    Scholarship,
    ScholarshipStatus,
)
from apps.school_organization.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    SectionFactory,
    SubjectFactory,
    TenantFactory,
    TermFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.student_management.tests.factories import (
    GuardianFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
)
from core.tenancy.context import tenant_context
from core.tenancy.models import FeatureFlag, TenantFeatureOverride

__all__ = [
    "AcademicSessionFactory",
    "CampusFactory",
    "ClassFactory",
    "DiscountFactory",
    "FeeHeadFactory",
    "FeeInvoiceFactory",
    "FeeInvoiceLineFactory",
    "FeeScheduleFactory",
    "FeeStructureFactory",
    "FineFactory",
    "GuardianFactory",
    "LedgerAccountFactory",
    "ScholarshipFactory",
    "SectionFactory",
    "StudentEnrollmentFactory",
    "StudentFactory",
    "StudentGuardianFactory",
    "SubjectFactory",
    "TenantFactory",
    "TermFactory",
    "UserFactory",
    "authenticate",
    "disable_feature",
    "enable_feature",
    "fine_head",
    "grant",
    "income_account",
    "posting",
]


class LedgerAccountFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = LedgerAccount

    code = factory.Sequence(lambda n: f"{4000 + n}")
    name = factory.Sequence(lambda n: f"Account {n}")
    account_type = LedgerAccountType.INCOME
    is_active = True


class FeeHeadFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = FeeHead

    name = factory.Sequence(lambda n: f"Fee head {n}")
    code = factory.Sequence(lambda n: f"HEAD{n}")
    ledger_account = factory.SubFactory(LedgerAccountFactory)
    is_active = True


class FeeStructureFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = FeeStructure

    name = factory.Sequence(lambda n: f"Structure {n}")
    status = FeeStructureStatus.DRAFT


class FeeScheduleFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = FeeSchedule

    amount = Decimal("1000.00")
    # `monthly` is the common case and the one with a due-day rule, so the
    # default carries the matching `due_day` — a factory whose default violates
    # `fee_schedules_due_day_matches_frequency` would make every test that
    # touches a schedule fail on the fixture.
    frequency = FeeFrequency.MONTHLY
    due_day = 10


def income_account(tenant, *, code: str = "4000", name: str = "Fee income") -> LedgerAccount:
    """An income account, which is the only kind a fee head may map to."""
    with tenant_context(tenant.id):
        return LedgerAccountFactory(
            tenant=tenant, code=code, name=name, account_type=LedgerAccountType.INCOME
        )


def posting(
    tenant,
    *,
    debit_account: LedgerAccount,
    credit_account: LedgerAccount,
    amount: Decimal = Decimal("500.00"),
    entry_date: datetime.date | None = None,
    reference_type: str = LedgerReferenceType.MANUAL,
    actor_id=None,
):
    """One balanced two-line posting, through the real engine.

    Tests get their ledger state the way the application does. See the module
    docstring for why there is no factory for a single entry.
    """
    from django.db import transaction

    from apps.fees_finance.ledger import LedgerLine, post_transaction

    with tenant_context(tenant.id), transaction.atomic():
        return post_transaction(
            entry_date=entry_date or datetime.date(2026, 9, 1),
            lines=[
                LedgerLine(ledger_account_id=debit_account.pk, debit=amount),
                LedgerLine(ledger_account_id=credit_account.pk, credit=amount),
            ],
            reference_type=reference_type,
            actor_id=actor_id,
        )


def enable_feature(tenant, key: str) -> None:
    """Force ``key`` on for ``tenant``, regardless of its coded default.

    `module.fees_finance` ships `default_enabled=False` (features.py), so
    without this every request in these tests would be refused with
    `module_disabled` before reaching the code under test.

    `update_or_create`, not `get_or_create`: an existing `enabled=False` row
    would otherwise stick and the test would fail on a disabled module rather
    than on what it meant to assert.
    """
    flag = FeatureFlag.objects.get(key=key)
    with tenant_context(tenant.id):
        TenantFeatureOverride.objects.update_or_create(
            tenant=tenant,
            feature_flag=flag,
            defaults={"enabled": True, "reason": "fees-finance test fixture"},
        )


def disable_feature(tenant, key: str) -> None:
    """The mirror of `enable_feature`, for the module-disabled test.

    Two facts this encodes so nobody rediscovers them: the flag catalogue is
    **platform-level**, so `FeatureFlag` has no `all_tenants` manager and is
    read unscoped; and the override's column is `enabled`, not `is_enabled`.
    """
    flag = FeatureFlag.objects.get(key=key)
    with tenant_context(tenant.id):
        TenantFeatureOverride.objects.update_or_create(
            tenant=tenant,
            feature_flag=flag,
            defaults={"enabled": False, "reason": "fees-finance test fixture"},
        )


class DiscountFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Discount

    name = factory.Sequence(lambda n: f"Discount {n}")
    discount_type = GrantValueType.PERCENT
    value = Decimal("10.00")
    status = DiscountStatus.ACTIVE
    # `discounts_active_is_attributable` refuses an active grant with no
    # approver, so the default has to carry one or every fixture fails on the
    # constraint rather than on what its test asserts.
    approved_by = factory.LazyFunction(uuid.uuid4)


class ScholarshipFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Scholarship

    name = factory.Sequence(lambda n: f"Scholarship {n}")
    coverage_type = GrantValueType.PERCENT
    value = Decimal("25.00")
    status = ScholarshipStatus.APPROVED
    approved_by = factory.LazyFunction(uuid.uuid4)


class FineFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Fine

    amount = Decimal("250.00")
    reason = "Overdue library book"
    status = FineStatus.PENDING


class FeeInvoiceFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = FeeInvoice

    invoice_no = factory.Sequence(lambda n: f"INV-TEST-{n:05d}")
    issue_date = datetime.date(2026, 9, 1)
    due_date = datetime.date(2026, 9, 10)
    status = InvoiceStatus.ISSUED
    subtotal = Decimal("1000.00")
    discount_total = Decimal("0.00")
    fine_total = Decimal("0.00")
    paid_total = Decimal("0.00")
    # `fee_invoices_balance_is_derived` is a CHECK, so a factory whose default
    # balance disagreed with its components would fail on every use.
    balance_due = factory.LazyAttribute(
        lambda o: o.subtotal - o.discount_total + o.fine_total - o.paid_total
    )


class FeeInvoiceLineFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = FeeInvoiceLine

    description = "Tuition"
    amount = Decimal("1000.00")
    discount_amount = Decimal("0.00")


def fine_head(tenant, account: LedgerAccount) -> FeeHead:
    """A fee head in the `fine` category, which is what a fine requires.

    `FineSerializer.validate_fee_head` refuses anything else — §15 says a fine's
    head is category `fine`, and it is a service rule rather than a CHECK
    because `category` lives on the other table.
    """
    with tenant_context(tenant.id):
        return FeeHeadFactory(
            tenant=tenant,
            ledger_account=account,
            category=FeeHeadCategory.FINE,
            code=f"FINE{uuid.uuid4().hex[:6].upper()}",
        )
