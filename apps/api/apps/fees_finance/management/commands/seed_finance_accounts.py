"""Seed a tenant's system ledger accounts — §6's "seeded at provisioning".

Not a `post_migrate` hook, and that is the interesting part: migrations run once
per deploy while tenants are created long afterwards, so there is no moment at
migrate time when the tenant list is known. `core.rbac.sync` can use
`post_migrate` because permission keys are platform-scoped; a chart of accounts
is per-tenant, so it needs an explicit call at the point a tenant starts using
the module.

Idempotent, so running it again after `SYSTEM_ACCOUNTS` gains an entry backfills
only the new one and leaves a school's renamed or archived accounts exactly as
they are.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.fees_finance.services import ensure_system_accounts
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant


class Command(BaseCommand):
    help = "Create the system ledger accounts for one tenant, or for every tenant."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--tenant",
            dest="tenant_slug",
            help="Tenant slug. Omit to seed every operational tenant.",
        )

    def handle(self, *args, **options) -> None:
        slug = options.get("tenant_slug")
        if slug:
            tenants = list(Tenant.objects.filter(slug=slug))
            if not tenants:
                raise CommandError(f"No tenant with slug {slug!r}.")
        else:
            tenants = [t for t in Tenant.objects.all() if t.is_operational]

        for tenant in tenants:
            # `tenant_context` binds `app.tenant_id` for the transaction, which
            # is what the RLS policy reads — without it the INSERT is refused by
            # the database rather than by the manager.
            with tenant_context(tenant.pk), transaction.atomic():
                accounts = ensure_system_accounts(tenant_id=tenant.pk)
            self.stdout.write(
                self.style.SUCCESS(f"{tenant.slug}: {len(accounts)} ledger accounts present")
            )
