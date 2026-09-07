"""Cross-tenant access on every fees-finance endpoint.

testing-strategy.md §3 and AGENTS.md invariant 2: for each endpoint, a tenant-A
caller reaching for a tenant-B resource must get **404, never 403** — a 403
confirms the row exists, which is the leak the rule exists to prevent.

The acting user holds every key this module declares, `all`-scoped, and the flag
is on for both tenants, so a denial here can only come from tenant scoping.
Without that these would pass for the wrong reason the moment someone forgot a
permission.

Two shapes fail differently from a plain detail lookup, and both are asserted:

- **A body-referenced id** — `POST /fee-schedules` names its structure and head
  in the body. A foreign id fails to resolve through the serializer's
  tenant-scoped `PrimaryKeyRelatedField`, which is a **400**: the field
  genuinely does not validate. That leaks nothing, because the message says the
  id is invalid, not that it belongs to someone else.
- **`:post-journal`** names its accounts in the body too, and a foreign account
  is refused by `ledger.assert_accounts_are_postable` as *unknown* — the
  tenant-scoped manager cannot see it, so from this caller's side it does not
  exist. Which is the correct thing to say.

Because the money tables are where a leak would matter most, this file also
proves the isolation is the *database's* rather than the manager's, by reading
`ledger_entries` through `all_tenants` — the manager that does no filtering at
all — and asserting the row still does not come back.
"""

from __future__ import annotations

from decimal import Decimal

from rest_framework import status

from apps.fees_finance.models import LedgerEntry
from apps.fees_finance.services import ensure_system_accounts
from apps.fees_finance.tests.base import FEATURE, FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import (
    AcademicSessionFactory,
    FeeHeadFactory,
    FeeScheduleFactory,
    FeeStructureFactory,
    LedgerAccountFactory,
    TenantFactory,
    enable_feature,
    posting,
)
from core.tenancy.context import tenant_context


class FinanceCrossTenantTests(FeesFinanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        from django.db import transaction

        self.other_tenant = TenantFactory()
        enable_feature(self.other_tenant, FEATURE)

        with tenant_context(self.other_tenant.id):
            with transaction.atomic():
                other_accounts = ensure_system_accounts(tenant_id=self.other_tenant.pk)
            self.other_income = other_accounts["4000"]
            self.other_cash = other_accounts["1000"]
            self.other_session = AcademicSessionFactory(tenant=self.other_tenant, is_current=True)
            self.other_head = FeeHeadFactory(
                tenant=self.other_tenant, ledger_account=self.other_income
            )
            self.other_structure = FeeStructureFactory(
                tenant=self.other_tenant, academic_session=self.other_session
            )
            self.other_schedule = FeeScheduleFactory(
                tenant=self.other_tenant,
                fee_structure=self.other_structure,
                fee_head=self.other_head,
            )
            self.other_extra_account = LedgerAccountFactory(tenant=self.other_tenant, code="4321")

    def test_a_foreign_ledger_account_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/ledger-accounts/{self.other_extra_account.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_fee_head_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/fee-heads/{self.other_head.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_fee_structure_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/fee-structures/{self.other_structure.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_fee_schedule_is_not_found(self) -> None:
        response = self.client.get(f"/api/v1/fee-schedules/{self.other_schedule.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_activating_a_foreign_structure_is_not_found(self) -> None:
        response = self.client.post(f"/api/v1/fee-structures/{self.other_structure.pk}:activate")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_archiving_a_foreign_structure_is_not_found(self) -> None:
        response = self.client.post(f"/api/v1/fee-structures/{self.other_structure.pk}:archive")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_deleting_a_foreign_fee_head_is_not_found(self) -> None:
        response = self.client.delete(f"/api/v1/fee-heads/{self.other_head.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_foreign_structure_named_in_a_body_does_not_validate(self) -> None:
        response = self.client.post(
            "/api/v1/fee-schedules",
            {
                "fee_structure": str(self.other_structure.pk),
                "fee_head": str(self.other_head.pk),
                "amount": "100.00",
                "frequency": "monthly",
                "due_day": 5,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_ledger_account_cannot_be_posted_to(self) -> None:
        """Refused as *unknown* rather than as forbidden, which is the honest
        answer: the tenant-scoped manager cannot see it, so from this caller's
        side it does not exist."""
        response = self.client.post(
            "/api/v1/ledger-entries:post-journal",
            {
                "entry_date": "2026-09-01",
                "memo": "Cross-tenant attempt",
                "lines": [
                    {"ledger_account": str(self.cash.pk), "debit": "10.00"},
                    {"ledger_account": str(self.other_income.pk), "credit": "10.00"},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn(
            str(self.other_income.pk),
            response.json()["error"]["meta"]["unknown_account_ids"],
        )
        with tenant_context(self.tenant.id):
            self.assertEqual(LedgerEntry.objects.count(), 0)

    def test_a_foreign_account_cannot_be_made_a_parent(self) -> None:
        response = self.client.post(
            "/api/v1/ledger-accounts",
            {
                "code": "4002",
                "name": "Grafted",
                "account_type": "income",
                "parent": str(self.other_income.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_tenant_s_ledger_entries_are_never_listed(self) -> None:
        posting(
            self.other_tenant,
            debit_account=self.other_cash,
            credit_account=self.other_income,
            amount=Decimal("999.00"),
        )

        response = self.client.get("/api/v1/ledger-entries")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"], [])

    def test_the_database_hides_a_foreign_posting_not_just_the_manager(self) -> None:
        """Read through `all_tenants`, which does no tenant filtering at all.

        Money is where a leak would be worst, so this asserts the *database* is
        the boundary — the same thing `tests/test_rls_enforcement.py` does for
        `school_organization`, repeated here because a new base class
        (`AppendOnlyTenantModel`) is carrying the policy for the first time and
        "it inherited the right thing" is worth proving rather than assuming.
        """
        posting(
            self.other_tenant,
            debit_account=self.other_cash,
            credit_account=self.other_income,
        )

        with tenant_context(self.tenant.id):
            self.assertEqual(LedgerEntry.all_tenants.count(), 0)
