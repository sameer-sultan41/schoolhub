"""Shared setup for the fees-finance tests.

Builds the minimum structure fee configuration is meaningful inside: a
**current** session with a term, a class, a campus, this tenant's system ledger
accounts, and a caller holding every key this PR registers.

Two parts of that are load-bearing rather than scenery:

- **The system accounts.** `ensure_system_accounts` is what a real tenant gets
  at provisioning, and a fee head must map to an *income* account. A fixture
  that created accounts ad hoc would make a test fail on the account type rather
  than on what it asserts, so every test starts from the real seeded chart.
- **The caller holds every key.** A cross-tenant test that passed because a
  permission was missing would prove nothing about tenant scoping — the failure
  mode `timetable/tests/test_cross_tenant.py`'s own header names.

The session is `is_current=True` for the reason timetable's, attendance's and
examinations' fixtures give: services fall back to the current session when a
caller names none, and there would otherwise be nothing to fall back to.
"""

from __future__ import annotations

from django.db import transaction
from rest_framework.test import APITestCase

from apps.fees_finance.services import ensure_system_accounts
from apps.fees_finance.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    TenantFactory,
    TermFactory,
    UserFactory,
    authenticate,
    enable_feature,
    grant,
)
from core.tenancy.context import tenant_context

FEATURE = "module.fees_finance"

# Every key this PR registers. Later PRs extend this tuple as they add keys.
ALL_KEYS = (
    "fees.fee-structure.view",
    "fees.fee-structure.create",
    "fees.fee-structure.update",
    "fees.fee-structure.delete",
    "fees.ledger.view",
    "fees.ledger.create",
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
            self.session = AcademicSessionFactory(tenant=self.tenant, is_current=True)
            self.term = TermFactory(tenant=self.tenant, academic_session=self.session, sequence=1)
            self.school_class = ClassFactory(tenant=self.tenant, level=8)

            # The chart of accounts a real tenant is provisioned with. `atomic`
            # because `ensure_system_accounts` writes, and the RLS policy reads
            # the tenant bound for the transaction.
            with transaction.atomic():
                self.accounts = ensure_system_accounts(tenant_id=self.tenant.pk)

        self.fee_income = self.accounts["4000"]
        self.cash = self.accounts["1000"]
        self.bank = self.accounts["1010"]
