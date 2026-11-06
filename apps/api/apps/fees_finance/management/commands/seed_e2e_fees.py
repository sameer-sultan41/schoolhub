"""Seed the fees & finance dashboard's live-lane fixtures: a fee head and a draft structure.

Run by `seed_e2e_data` (after it has seeded the tenant, the baseline session, campus and
class, and the parent portal's own fee fixtures), never on its own against anything but a
local or CI database. A command of this app, not a step in `core`, because it writes
`fees_finance` models and `core` imports no app (ADR-0013). The finance logins and the
`module.fees_finance` flag are `seed_e2e_data`'s: users and flags are `core` concerns.

Separate from the portal's head and structure on purpose: those are activated and billed so
the portal has an invoice to show, while the fees dashboard's specs need a structure still in
`draft` to edit, activate and delete. The draft is scoped to the second campus because
`activate_fee_structure` refuses a second active structure for the same session, class and
campus: at the baseline campus it could never be activated beside the portal's.
Later fees-dashboard PRs add their fixtures here.

Idempotent: each row has a natural key (head code, structure scope and name, head within a
structure). A re-run never touches an existing row, so a structure a spec has activated stays
activated.
"""

from __future__ import annotations

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.fees_finance import services as fee_services
from apps.fees_finance.models import (
    FeeFrequency,
    FeeHead,
    FeeHeadCategory,
    FeeSchedule,
    FeeStructure,
)
from apps.school_organization.models import AcademicSession, Campus, Class
from core.rbac.management.commands.seed_e2e_data import (
    E2E_CLASS_NAME,
    E2E_SECOND_CAMPUS_CODE,
    E2E_SESSION_NAME,
    E2E_TENANT_SLUG,
)
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant

# Mirrored in e2e/src/lib/seed-constants.ts.
E2E_FINANCE_FEE_HEAD_CODE = "E2E-LIBRARY"
E2E_FINANCE_FEE_HEAD_NAME = "E2E Library Fee"
E2E_FINANCE_DRAFT_STRUCTURE_NAME = "E2E Draft Fees"
E2E_FINANCE_DRAFT_AMOUNT = Decimal("750.00")
E2E_FINANCE_DRAFT_DUE_DAY = 15
# System account 4000 is the tenant's income account (`ensure_system_accounts`).
E2E_FINANCE_INCOME_ACCOUNT_CODE = "4000"


class Command(BaseCommand):
    help = (
        "Seed the fees dashboard's live-lane fixtures: a fee head mapped to the income "
        "account and a draft fee structure with one schedule. Run by seed_e2e_data."
    )

    @transaction.atomic
    def handle(self, *args, **options):
        tenant = Tenant.objects.get(slug=E2E_TENANT_SLUG)
        with tenant_context(tenant.id):
            session = AcademicSession.objects.get(name=E2E_SESSION_NAME)
            campus = Campus.objects.get(code=E2E_SECOND_CAMPUS_CODE)
            school_class = Class.objects.get(name=E2E_CLASS_NAME)

            accounts = fee_services.ensure_system_accounts(tenant_id=tenant.id)
            head, _ = FeeHead.objects.get_or_create(
                tenant=tenant,
                code=E2E_FINANCE_FEE_HEAD_CODE,
                defaults={
                    "name": E2E_FINANCE_FEE_HEAD_NAME,
                    "category": FeeHeadCategory.LIBRARY,
                    "ledger_account": accounts[E2E_FINANCE_INCOME_ACCOUNT_CODE],
                },
            )
            structure, _ = FeeStructure.objects.get_or_create(
                tenant=tenant,
                academic_session=session,
                school_class=school_class,
                campus=campus,
                name=E2E_FINANCE_DRAFT_STRUCTURE_NAME,
            )
            FeeSchedule.objects.get_or_create(
                tenant=tenant,
                fee_structure=structure,
                fee_head=head,
                defaults={
                    "amount": E2E_FINANCE_DRAFT_AMOUNT,
                    "frequency": FeeFrequency.MONTHLY,
                    "due_day": E2E_FINANCE_DRAFT_DUE_DAY,
                },
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded fee head {E2E_FINANCE_FEE_HEAD_CODE} and draft structure "
                f"'{E2E_FINANCE_DRAFT_STRUCTURE_NAME}' for tenant '{tenant.slug}'"
            )
        )
