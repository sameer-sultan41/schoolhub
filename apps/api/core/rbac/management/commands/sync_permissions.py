"""Manually re-sync permission keys.

Normally unnecessary — the post_migrate hook covers deploys — but useful when
inspecting drift or repairing an environment without running a migration.
"""

from django.core.management.base import BaseCommand

from core.rbac.sync import sync_permissions


class Command(BaseCommand):
    help = "Synchronize the permission registry into the database."

    def handle(self, *args, **options):
        summary = sync_permissions(verbose=True)
        self.stdout.write(
            self.style.SUCCESS(
                f"created={summary['created']} updated={summary['updated']} "
                f"stale={summary['stale']}"
            )
        )
