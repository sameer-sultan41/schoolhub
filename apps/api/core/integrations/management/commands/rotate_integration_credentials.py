"""Re-encrypt every stored integration credential and secret under the newest key.

Run after adding a new key at the front of ``INTEGRATIONS_ENCRYPTION_KEYS``, and before the
old key is removed. Safe to re-run: re-encrypting an already-current token is harmless.
Runbook: infra/runbooks/rotate-integration-credentials.md.
"""

from __future__ import annotations

import uuid

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.integrations.crypto import registered_global_rotators, registered_rotators
from core.tenancy.maintenance import for_each_tenant


def _rotate_tenant(tenant_id: uuid.UUID) -> int:
    # for_each_tenant has bound this tenant, so each rotator sees only its rows.
    return sum(rotator() for rotator in registered_rotators())


class Command(BaseCommand):
    help = (
        "Re-encrypt stored integration credentials under the newest "
        "INTEGRATIONS_ENCRYPTION_KEYS key."
    )

    def handle(self, *args, **options) -> None:
        # Tables with no RLS (users' TOTP secrets), once, with no tenant bound.
        with transaction.atomic():
            platform_wide = sum(rotator() for rotator in registered_global_rotators())
        self.stdout.write(f"Rotated {platform_wide} platform-wide secret(s).")

        summary = for_each_tenant(_rotate_tenant, job="rotate-integration-credentials")
        self.stdout.write(
            f"Rotated {summary['affected']} credential(s) across {summary['tenants']} tenant(s); "
            f"{summary['failed']} failure(s)."
        )
        if summary["failed"]:
            raise CommandError("Some tenants failed; do not remove the old key. See the logs.")
