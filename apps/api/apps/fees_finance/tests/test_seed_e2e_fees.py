"""Tests for `seed_e2e_fees` — the fees dashboard's live-lane head and draft structure.

Real Postgres via `TestCase`, for the reason core/rbac/tests/test_seed_e2e_data.py gives: the
command writes through `tenant_context`, so RLS has to be live.
"""

from __future__ import annotations

from django.core.management import call_command
from django.test import TestCase

from apps.fees_finance.management.commands.seed_e2e_fees import (
    E2E_FINANCE_DRAFT_AMOUNT,
    E2E_FINANCE_DRAFT_STRUCTURE_NAME,
    E2E_FINANCE_FEE_HEAD_CODE,
    E2E_FINANCE_INCOME_ACCOUNT_CODE,
)
from apps.fees_finance.models import (
    FeeHead,
    FeeSchedule,
    FeeStructure,
    FeeStructureStatus,
    LedgerAccount,
)
from apps.fees_finance.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    TenantFactory,
)
from core.rbac.management.commands.seed_e2e_data import (
    E2E_CAMPUS_CODE,
    E2E_CLASS_NAME,
    E2E_SESSION_NAME,
    E2E_TENANT_SLUG,
)
from core.tenancy.context import tenant_context


class SeedE2EFeesTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        # The command looks the baseline scope up by the names `seed_e2e_data` gives it.
        self.tenant = TenantFactory(slug=E2E_TENANT_SLUG)
        with tenant_context(self.tenant.id):
            CampusFactory(tenant=self.tenant, code=E2E_CAMPUS_CODE)
            AcademicSessionFactory(tenant=self.tenant, name=E2E_SESSION_NAME, is_current=True)
            ClassFactory(tenant=self.tenant, name=E2E_CLASS_NAME)

    def seed(self) -> None:
        call_command("seed_e2e_fees")

    def test_seeds_a_head_on_the_income_account_and_a_draft_structure_with_one_schedule(
        self,
    ) -> None:
        self.seed()

        with tenant_context(self.tenant.id):
            head = FeeHead.objects.get(code=E2E_FINANCE_FEE_HEAD_CODE)
            self.assertEqual(head.ledger_account.code, E2E_FINANCE_INCOME_ACCOUNT_CODE)
            structure = FeeStructure.objects.get(name=E2E_FINANCE_DRAFT_STRUCTURE_NAME)
            self.assertEqual(structure.status, FeeStructureStatus.DRAFT)
            schedule = FeeSchedule.objects.get(fee_structure=structure)
            self.assertEqual(schedule.fee_head, head)
            self.assertEqual(schedule.amount, E2E_FINANCE_DRAFT_AMOUNT)

    def test_is_idempotent(self) -> None:
        self.seed()
        with tenant_context(self.tenant.id):
            before = (
                list(FeeHead.objects.values_list("pk", flat=True)),
                list(FeeStructure.objects.values_list("pk", flat=True)),
                list(FeeSchedule.objects.values_list("pk", flat=True)),
                LedgerAccount.objects.count(),
            )

        self.seed()

        with tenant_context(self.tenant.id):
            after = (
                list(FeeHead.objects.values_list("pk", flat=True)),
                list(FeeStructure.objects.values_list("pk", flat=True)),
                list(FeeSchedule.objects.values_list("pk", flat=True)),
                LedgerAccount.objects.count(),
            )
        self.assertEqual(before, after)
        self.assertEqual((len(before[0]), len(before[1]), len(before[2])), (1, 1, 1))

    def test_a_rerun_leaves_an_activated_structure_active(self) -> None:
        self.seed()
        with tenant_context(self.tenant.id):
            FeeStructure.objects.filter(name=E2E_FINANCE_DRAFT_STRUCTURE_NAME).update(
                status=FeeStructureStatus.ACTIVE
            )

        self.seed()

        with tenant_context(self.tenant.id):
            structure = FeeStructure.objects.get(name=E2E_FINANCE_DRAFT_STRUCTURE_NAME)
            self.assertEqual(structure.status, FeeStructureStatus.ACTIVE)
