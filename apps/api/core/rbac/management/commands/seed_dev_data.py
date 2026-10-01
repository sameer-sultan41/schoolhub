"""Seed a sample tenant and a logged-in-ready user for local development.

Idempotent — safe to run on every ``seed-dev.sh`` invocation. Never runs against
anything but a local dev database: it hardcodes dummy credentials that must never
reach staging or production.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.school_organization.models import Campus, House
from apps.student_management.models import Gender, Student, StudentStatus
from core.rbac.seeding import ensure_school_owner_role, ensure_seed_user, ensure_tenant
from core.tenancy.context import tenant_context
from core.tenancy.models import FeatureFlag, TenantFeatureOverride, TenantSettings

DEMO_TENANT_SLUG = "demo"
DEMO_OWNER_EMAIL = "owner@demo.localhost"
DEMO_OWNER_PASSWORD = "demo12345"  # noqa: S105 — dev-only seed data, never real credentials

DEMO_CAMPUS_CODE = "MAIN"
DEMO_HOUSE_NAMES = ("Griffin", "Phoenix", "Falcon", "Eagle")
# (admission_number, first, last, date_of_birth, gender, house index or None, status)
DEMO_STUDENTS = (
    ("2026-0001", "Ayesha", "Khan", "2012-05-01", Gender.FEMALE, 0, StudentStatus.ACTIVE),
    ("2026-0002", "Bilal", "Ahmed", "2013-02-14", Gender.MALE, 1, StudentStatus.ACTIVE),
    ("2026-0003", "Hamza", "Raza", "2011-09-20", Gender.MALE, 2, StudentStatus.ACTIVE),
    ("2026-0004", "Zainab", "Malik", "2012-11-03", Gender.FEMALE, 3, StudentStatus.ACTIVE),
    ("2026-0005", "Ali", "Hassan", "2010-07-12", Gender.MALE, None, StudentStatus.ACTIVE),
    ("2026-0006", "Sara", "Iqbal", "2013-04-22", Gender.FEMALE, 0, StudentStatus.SUSPENDED),
    ("2026-0007", "Usman", "Tariq", "2011-01-30", Gender.MALE, 1, StudentStatus.WITHDRAWN),
    ("2026-0008", "Mariam", "Farooq", "2012-08-17", Gender.FEMALE, 2, StudentStatus.ACTIVE),
)


class Command(BaseCommand):
    help = "Seed a sample tenant, the school_owner role, and a demo login for local dev."

    @transaction.atomic
    def handle(self, *args, **options):
        tenant = ensure_tenant(DEMO_TENANT_SLUG, "Demo School")

        with tenant_context(tenant.id):
            TenantSettings.all_tenants.get_or_create(tenant=tenant)
            self._enable_every_module(tenant)
            self._seed_school_organization_and_students(tenant)

        role = ensure_school_owner_role()
        ensure_seed_user(
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

    def _enable_every_module(self, tenant) -> None:
        """Every ``module.*`` flag defaults off (``features.py`` per module) — every

        gated endpoint 403s with ``module_disabled`` until a tenant is explicitly
        onboarded onto it. The demo tenant exists to show off the whole product, not one
        scenario, so it gets every currently-registered flag — unlike
        ``seed_e2e_data.py``, which deliberately enables only what each e2e journey
        needs. ``update_or_create``, not ``get_or_create``: a prior run could have left a
        row ``enabled=False``, and ``get_or_create`` only applies ``defaults`` on
        creation, which would leave an existing disabled row disabled forever.
        """
        for flag in FeatureFlag.objects.all():
            TenantFeatureOverride.objects.update_or_create(
                tenant=tenant,
                feature_flag=flag,
                defaults={"enabled": True, "reason": "local dev seed"},
            )

    def _seed_school_organization_and_students(self, tenant) -> None:
        """A campus, a handful of houses, and a small, deliberately mixed-status

        student roster — active, suspended and withdrawn — so the directory's status
        filter, the withdraw action's visibility rule, and an empty vs. populated list
        are all demonstrable without the owner having to create data by hand first.
        """
        campus, _ = Campus.objects.get_or_create(
            tenant=tenant,
            code=DEMO_CAMPUS_CODE,
            defaults={"name": "Main Campus", "is_primary": True, "is_active": True},
        )
        houses = []
        for name in DEMO_HOUSE_NAMES:
            house, _ = House.objects.get_or_create(
                tenant=tenant,
                name=name,
                defaults={"code": name[:3].upper(), "is_active": True},
            )
            houses.append(house)

        for admission_number, first, last, dob, gender, house_index, status in DEMO_STUDENTS:
            Student.objects.get_or_create(
                tenant=tenant,
                admission_number=admission_number,
                defaults={
                    "first_name": first,
                    "last_name": last,
                    "date_of_birth": dob,
                    "gender": gender,
                    "campus": campus,
                    "house": houses[house_index] if house_index is not None else None,
                    "admission_date": "2026-01-10",
                    "status": status,
                },
            )
