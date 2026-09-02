"""Seed a sample tenant and a logged-in-ready user for local development.

Idempotent — safe to run on every ``seed-dev.sh`` invocation. Never runs against
anything but a local dev database: it hardcodes dummy credentials that must never
reach staging or production.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from core.rbac.models import Permission, RecordScope, Role, RolePermission, User, UserRole
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant, TenantSettings, TenantStatus

DEMO_TENANT_SLUG = "demo"
DEMO_OWNER_EMAIL = "owner@demo.localhost"
DEMO_OWNER_PASSWORD = "demo12345"  # noqa: S105 — dev-only seed data, never real credentials


class Command(BaseCommand):
    help = "Seed a sample tenant, the school_owner role, and a demo login for local dev."

    @transaction.atomic
    def handle(self, *args, **options):
        tenant, created = Tenant.objects.get_or_create(
            slug=DEMO_TENANT_SLUG,
            defaults={"name": "Demo School", "status": TenantStatus.ACTIVE},
        )
        if not created and tenant.status != TenantStatus.ACTIVE:
            tenant.status = TenantStatus.ACTIVE
            tenant.save(update_fields=["status"])

        with tenant_context(tenant.id):
            TenantSettings.all_tenants.get_or_create(tenant=tenant)

        # school_owner "can hold every permission" (docs/00-overview/users-and-roles.md
        # §3) — granting the full current registry keeps this in sync as permissions
        # are added, rather than hardcoding a subset that would silently go stale.
        role, _ = Role.objects.get_or_create(
            tenant=None,
            slug="school_owner",
            defaults={"name": "School Owner", "is_default": True},
        )
        granted_permission_ids = set(
            RolePermission.objects.filter(role=role).values_list("permission_id", flat=True)
        )
        RolePermission.objects.bulk_create(
            [
                RolePermission(role=role, permission=permission)
                for permission in Permission.objects.exclude(id__in=granted_permission_ids)
            ],
            batch_size=500,
            ignore_conflicts=True,
        )

        user, user_created = User.objects.get_or_create(
            tenant=tenant,
            email=DEMO_OWNER_EMAIL,
            defaults={
                "first_name": "Demo",
                "last_name": "Owner",
                "is_active": True,
            },
        )
        if user_created:
            user.set_password(DEMO_OWNER_PASSWORD)
            user.save(update_fields=["password"])

        UserRole.objects.get_or_create(
            user=user,
            role=role,
            scope=RecordScope.ALL,
            scope_ref=None,
            defaults={"tenant": tenant},
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded tenant '{tenant.slug}' with login {DEMO_OWNER_EMAIL} / "
                f"{DEMO_OWNER_PASSWORD}"
            )
        )
