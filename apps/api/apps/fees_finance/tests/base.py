"""Shared setup for the fees-finance tests.

Builds the minimum structure fee configuration and billing are meaningful
inside: a **current** session with a term, a class and section, a campus, this
tenant's system ledger accounts, three students enrolled in that section, and a
caller holding every key the module registers.

Four parts of that are load-bearing rather than scenery:

- **The system accounts.** `ensure_system_accounts` is what a real tenant gets
  at provisioning, and a fee head must map to an *income* account. A fixture
  that created accounts ad hoc would make a test fail on the account type rather
  than on what it asserts.
- **The enrollments.** Generation bills active enrollments, so a fixture without
  them would make every billing test pass by generating nothing.
- **A guardian with portal access on the first student.** §12's notifications
  resolve recipients through that link, and the reminder tests would otherwise
  pass with an empty recipient list — proving nothing about the fan-out.
- **The caller holds every key.** A cross-tenant test that passed because a
  permission was missing would prove nothing about tenant scoping — the failure
  mode `timetable/tests/test_cross_tenant.py`'s own header names.

The session is `is_current=True` for the reason timetable's, attendance's and
examinations' fixtures give: services fall back to the current session when a
caller names none, and there would otherwise be nothing to fall back to.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.db import transaction
from rest_framework.test import APITestCase

from apps.fees_finance.models import FeeStructureStatus
from apps.fees_finance.services import ensure_system_accounts
from apps.fees_finance.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    FeeHeadFactory,
    FeeScheduleFactory,
    FeeStructureFactory,
    GuardianFactory,
    SectionFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
    TenantFactory,
    TermFactory,
    UserFactory,
    authenticate,
    enable_feature,
    grant,
)
from core.tenancy.context import tenant_context

FEATURE = "module.fees_finance"

#: The session the fixture bills inside. Fixed rather than relative to today so
#: a proration or due-date assertion cannot drift into passing or failing
#: depending on when the suite runs.
SESSION_START = datetime.date(2026, 4, 1)
SESSION_END = datetime.date(2027, 3, 31)
TERM_START = datetime.date(2026, 4, 1)
TERM_END = datetime.date(2026, 8, 31)

# Every key the module registers. Later PRs extend this tuple as they add keys.
ALL_KEYS = (
    "fees.fee-structure.view",
    "fees.fee-structure.create",
    "fees.fee-structure.update",
    "fees.fee-structure.delete",
    "fees.ledger.view",
    "fees.ledger.create",
    "fees.invoice.view",
    "fees.invoice.create",
    "fees.invoice.update",
    "fees.discount.view",
    "fees.discount.create",
    "fees.discount.waive",
    "fees.scholarship.create",
    "fees.fine.view",
    "fees.fine.create",
    "fees.fine.waive",
    "fees.payment.view",
    "fees.payment.collect",
    "fees.payment.refund",
    "fees.refund.approve",
)


class FeesFinanceAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, FEATURE)
        grant(self.user, *ALL_KEYS)

        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(
                tenant=self.tenant,
                is_current=True,
                start_date=SESSION_START,
                end_date=SESSION_END,
            )
            self.term = TermFactory(
                tenant=self.tenant,
                academic_session=self.session,
                sequence=1,
                start_date=TERM_START,
                end_date=TERM_END,
            )
            self.school_class = ClassFactory(tenant=self.tenant, level=8)
            # `campus` explicitly: SectionFactory provides no default, by the
            # same convention StudentFactory documents — every FK must belong to
            # the same tenant, so callers wire them up rather than letting a
            # SubFactory create a stray one.
            self.section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )

            self.students = [
                StudentFactory(tenant=self.tenant, campus=self.campus) for _ in range(3)
            ]
            self.enrollments = [
                StudentEnrollmentFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=self.session,
                    school_class=self.school_class,
                    section=self.section,
                    enrollment_date=SESSION_START,
                )
                for student in self.students
            ]
            self.student = self.students[0]

            # The portal link §12's recipients resolve through. Its user is a
            # real one, so a notification test asserts a delivery rather than an
            # empty list.
            self.guardian_user = UserFactory(tenant=self.tenant)
            # `user_id`, not `user`: Guardian holds a plain UUID column rather
            # than an FK (its own help text notes the tenant is checked at write
            # time), so there is no related object to assign.
            self.guardian = GuardianFactory(tenant=self.tenant, user_id=self.guardian_user.pk)
            StudentGuardianFactory(
                tenant=self.tenant,
                student=self.student,
                guardian=self.guardian,
                has_portal_access=True,
            )

            with transaction.atomic():
                self.accounts = ensure_system_accounts(tenant_id=self.tenant.pk)

        self.fee_income = self.accounts["4000"]
        self.fine_income = self.accounts["4100"]
        self.cash = self.accounts["1000"]
        self.bank = self.accounts["1010"]

    # ---------------------------------------------------------------- helpers

    def active_structure(self, *, amount: Decimal = Decimal("1000.00"), **kwargs):
        """An active structure with one monthly tuition line, ready to bill.

        Almost every invoicing test needs exactly this, and building it inline
        would mean each test also had to remember that an unpriced structure
        cannot be activated.
        """
        with tenant_context(self.tenant.id):
            head = FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income)
            structure = FeeStructureFactory(
                tenant=self.tenant,
                academic_session=self.session,
                status=FeeStructureStatus.ACTIVE,
                **kwargs,
            )
            schedule = FeeScheduleFactory(
                tenant=self.tenant,
                fee_structure=structure,
                fee_head=head,
                amount=amount,
                due_day=10,
            )
        return structure, head, schedule
