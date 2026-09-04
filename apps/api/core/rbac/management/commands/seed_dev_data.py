"""Seed a sample tenant and a logged-in-ready user for local development.

Idempotent — safe to run on every ``seed-dev.sh`` invocation. Never runs against
anything but a local dev database: it hardcodes dummy credentials that must never
reach staging or production.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from core.rbac.seeding import ensure_admin_user, ensure_school_owner_role, ensure_tenant
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantSettings

DEMO_TENANT_SLUG = "demo"
DEMO_OWNER_EMAIL = "owner@demo.localhost"
DEMO_OWNER_PASSWORD = "demo12345"  # noqa: S105 — dev-only seed data, never real credentials


class Command(BaseCommand):
    help = "Seed a sample tenant, the school_owner role, and a demo login for local dev."

    @transaction.atomic
    def handle(self, *args, **options):
        tenant = ensure_tenant(DEMO_TENANT_SLUG, "Demo School")

        with tenant_context(tenant.id):
            TenantSettings.all_tenants.get_or_create(tenant=tenant)

        role = ensure_school_owner_role()
        ensure_admin_user(
            tenant,
            role,
            email=DEMO_OWNER_EMAIL,
            password=DEMO_OWNER_PASSWORD,
            first_name="Demo",
            last_name="Owner",
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded tenant '{tenant.slug}' with login {DEMO_OWNER_EMAIL} / "
                f"{DEMO_OWNER_PASSWORD}"
            )
        )
