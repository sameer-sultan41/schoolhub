"""Seed the tenants and admin the e2e `live` lane's E2E_LIVE_* defaults expect.

Idempotent — safe to run on every ``seed-dev.sh`` invocation and every CI run of
the e2e-live workflow. Never runs against anything but a local/CI dev database:
it hardcodes dummy credentials that must never reach staging or production. Kept
alongside ``seed_dev_data`` (same app, same imports) rather than under
``apps.school_organization``, even though most of the data it creates lives
there, so both seed commands stay discoverable together.

Password comes from ``E2E_LIVE_ADMIN_PASSWORD`` so it can never drift from
``e2e/src/env.ts``'s zod default, which reads the same env var.
"""

import os
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    Section,
    SessionStatus,
    Term,
)
from core.rbac.seeding import ensure_admin_user, ensure_school_owner_role, ensure_tenant
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant, TenantSettings

E2E_TENANT_SLUG = "e2e-school"
E2E_OTHER_TENANT_SLUG = "e2e-other-school"
E2E_ADMIN_EMAIL = "e2e-admin@schoolhub.test"
# A distinct email, not the same one disambiguated by `school`: the dashboard's login
# form never sends `school` (it derives it from the subdomain, and the dashboard itself
# has no tenant subdomain — see apps/dashboard/src/features/auth/login-form.tsx), so two
# accounts sharing one email across tenants make every browser-driven live-lane login
# genuinely ambiguous, not just theoretically. Confirmed against the real API, not assumed.
E2E_OTHER_ADMIN_EMAIL = "e2e-admin-other@schoolhub.test"
# Dev/CI-only seed data, matches e2e/src/env.ts's own fallback. `or`, not
# `.get(key, default)`: an unset CI secret still sets the env var to an empty
# string via `-e VAR` in the workflow, which `.get` would happily return.
E2E_ADMIN_PASSWORD = os.environ.get("E2E_LIVE_ADMIN_PASSWORD") or "e2e-not-a-real-password"  # noqa: S105

E2E_CAMPUS_CODE = "MAIN"
E2E_CLASS_NAME = "Grade 1"
E2E_SECTION_NAME = "A"
E2E_SESSION_NAME = "E2E Baseline"


class Command(BaseCommand):
    help = (
        "Seed the two tenants and the admin the e2e `live` lane's E2E_LIVE_* env "
        "defaults expect, plus enough baseline school_organization data for the "
        "academic-session activation journey to pass its completeness check."
    )

    @transaction.atomic
    def handle(self, *args, **options):
        tenant = ensure_tenant(E2E_TENANT_SLUG, "E2E School")
        other_tenant = ensure_tenant(E2E_OTHER_TENANT_SLUG, "E2E Other School")

        role = ensure_school_owner_role()
        ensure_admin_user(
            tenant,
            role,
            email=E2E_ADMIN_EMAIL,
            password=E2E_ADMIN_PASSWORD,
            first_name="E2E",
            last_name="Admin",
        )
        # A distinct email (not the same one disambiguated by `school`) — lets a live spec
        # log in as a real admin of the *other* tenant to prove cross-tenant isolation
        # against a real second identity, not just a placeholder id under the first
        # tenant's own session.
        ensure_admin_user(
            other_tenant,
            role,
            email=E2E_OTHER_ADMIN_EMAIL,
            password=E2E_ADMIN_PASSWORD,
            first_name="E2E",
            last_name="Admin",
        )

        with tenant_context(tenant.id):
            TenantSettings.all_tenants.get_or_create(tenant=tenant)
            campus = self._ensure_campus(tenant)
            self._ensure_class_and_section(tenant, campus)
            self._ensure_baseline_session(tenant)

        # TODO(website-cms): no public-content/CMS backend module exists yet
        # (apps/api/config/api_v1.py routes only core.rbac and
        # apps.school_organization) — there is nothing here to seed real tenant
        # website content into. e2e/tests/live/website-tenant-resolution.spec.ts
        # pins the real current (degraded) behavior instead; revisit this seed
        # once that module ships.

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded tenant '{tenant.slug}' with admin {E2E_ADMIN_EMAIL} and tenant "
                f"'{E2E_OTHER_TENANT_SLUG}' with admin {E2E_OTHER_ADMIN_EMAIL}"
            )
        )

    def _ensure_campus(self, tenant: Tenant) -> Campus:
        campus, _ = Campus.objects.get_or_create(
            tenant=tenant,
            code=E2E_CAMPUS_CODE,
            defaults={"name": "Main Campus", "is_primary": True, "is_active": True},
        )
        return campus

    def _ensure_class_and_section(self, tenant: Tenant, campus: Campus) -> None:
        school_class, _ = Class.objects.get_or_create(
            tenant=tenant,
            name=E2E_CLASS_NAME,
            defaults={"level": 1, "is_active": True},
        )
        Section.objects.get_or_create(
            tenant=tenant,
            school_class=school_class,
            campus=campus,
            name=E2E_SECTION_NAME,
            defaults={"capacity": 30, "is_active": True},
        )

    def _ensure_baseline_session(self, tenant: Tenant) -> None:
        if AcademicSession.objects.filter(tenant=tenant, name=E2E_SESSION_NAME).exists():
            return

        today = timezone.now().date()
        start_date = today - timedelta(days=30)
        end_date = start_date + timedelta(days=364)

        session = AcademicSession.objects.create(
            tenant=tenant,
            name=E2E_SESSION_NAME,
            start_date=start_date,
            end_date=end_date,
            status=SessionStatus.ACTIVE,
            is_current=True,
        )
        Term.objects.create(
            tenant=tenant,
            academic_session=session,
            name="Full Year",
            sequence=1,
            start_date=start_date,
            end_date=end_date,
        )
