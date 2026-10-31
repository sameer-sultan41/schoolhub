"""Tests for the `seed_e2e_data` management command.

Real Postgres via `TestCase` (RLS applies) — the command itself writes through
`tenant_context`, same as `seed_dev_data`, so a fake/sqlite backend cannot
exercise it honestly.
"""

from __future__ import annotations

from django.core.management import call_command
from django.test import TestCase

from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    Section,
    SessionStatus,
    Term,
)
from apps.student_management.models import Guardian
from core.rbac.management.commands.seed_e2e_data import (
    E2E_ADMIN_EMAIL,
    E2E_ADMIN_PASSWORD,
    E2E_GUARDIAN_EMAIL,
    E2E_GUARDIAN_NAME,
    E2E_GUARDIAN_PERMISSIONS,
    E2E_GUARDIAN_PHONE,
    E2E_OTHER_ADMIN_EMAIL,
    E2E_OTHER_TENANT_SLUG,
    E2E_SCHOOL_ADMIN_PERMISSIONS,
    E2E_TENANT_SLUG,
)
from core.rbac.models import RecordScope, Role, RolePermission, User, UserRole
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant, TenantSettings, TenantStatus


class SeedE2EDataTests(TestCase):
    def test_seeds_both_tenants_and_an_admin_on_each(self) -> None:
        call_command("seed_e2e_data")

        tenant = Tenant.objects.get(slug=E2E_TENANT_SLUG)
        other_tenant = Tenant.objects.get(slug=E2E_OTHER_TENANT_SLUG)
        self.assertEqual(tenant.status, TenantStatus.ACTIVE)
        self.assertEqual(other_tenant.status, TenantStatus.ACTIVE)

        role = Role.objects.get(tenant=None, slug="school_owner")
        # Distinct emails, not the same one disambiguated by `school` on login — two
        # accounts sharing an email across tenants would make every browser-driven
        # live-lane login ambiguous, since the dashboard's login form never sends `school`.
        for row, email in ((tenant, E2E_ADMIN_EMAIL), (other_tenant, E2E_OTHER_ADMIN_EMAIL)):
            user = User.objects.get(tenant=row, email=email)
            self.assertTrue(user.check_password(E2E_ADMIN_PASSWORD))
            self.assertTrue(UserRole.objects.filter(user=user, role=role).exists())

    def test_the_school_admin_can_poll_the_jobs_it_starts(self) -> None:
        """It starts promotion execute; a 403 on `GET /jobs/{id}` reads as a failed job."""
        self.assertIn("academics.promotion.execute", E2E_SCHOOL_ADMIN_PERMISSIONS)
        self.assertIn("platform.job.view", E2E_SCHOOL_ADMIN_PERMISSIONS)

    def test_the_school_admin_does_not_hold_leave_request_create(self) -> None:
        """§4 grants it to `student` and `guardian` only, so the seed must not widen it."""
        self.assertNotIn("attendance.leave-request.create", E2E_SCHOOL_ADMIN_PERMISSIONS)

    def test_seeds_a_restricted_guardian_holding_exactly_the_leave_keys(self) -> None:
        call_command("seed_e2e_data")
        tenant = Tenant.objects.get(slug=E2E_TENANT_SLUG)

        user = User.objects.get(tenant=tenant, email=E2E_GUARDIAN_EMAIL)
        self.assertTrue(user.check_password(E2E_ADMIN_PASSWORD))
        role = Role.objects.get(tenant=tenant, slug="guardian")
        self.assertTrue(role.is_restricted_principal)
        self.assertTrue(
            UserRole.objects.filter(user=user, role=role, scope=RecordScope.OWN).exists()
        )
        keys = set(
            RolePermission.objects.filter(role=role).values_list("permission__key", flat=True)
        )
        self.assertEqual(keys, set(E2E_GUARDIAN_PERMISSIONS))

    def test_the_guardian_person_row_is_linked_to_the_login_and_not_duplicated(self) -> None:
        call_command("seed_e2e_data")
        call_command("seed_e2e_data")
        tenant = Tenant.objects.get(slug=E2E_TENANT_SLUG)
        user = User.objects.get(tenant=tenant, email=E2E_GUARDIAN_EMAIL)

        with tenant_context(tenant.id):
            rows = Guardian.objects.filter(user_id=user.id)
            self.assertEqual(rows.count(), 1)
            guardian = rows.get()
            self.assertEqual((guardian.first_name, guardian.last_name), E2E_GUARDIAN_NAME)
            self.assertEqual(guardian.phone, E2E_GUARDIAN_PHONE)

    def test_the_e2e_tenant_works_every_day_so_today_can_always_be_marked(self) -> None:
        call_command("seed_e2e_data")
        tenant = Tenant.objects.get(slug=E2E_TENANT_SLUG)

        with tenant_context(tenant.id):
            academic = TenantSettings.objects.get(tenant=tenant).academic

        self.assertEqual(academic["working_days"], [0, 1, 2, 3, 4, 5, 6])

    def test_seeds_baseline_school_organization_data_on_the_primary_tenant(self) -> None:
        call_command("seed_e2e_data")
        tenant = Tenant.objects.get(slug=E2E_TENANT_SLUG)

        with tenant_context(tenant.id):
            campus = Campus.objects.get(code="MAIN")
            self.assertTrue(campus.is_primary)
            self.assertTrue(campus.is_active)

            school_class = Class.objects.get(name="Grade 1")
            section = Section.objects.get(school_class=school_class, campus=campus)
            self.assertTrue(section.is_active)

            session = AcademicSession.objects.get(name="E2E Baseline")
            self.assertEqual(session.status, SessionStatus.ACTIVE)
            self.assertTrue(session.is_current)

            term = Term.objects.get(academic_session=session)
            self.assertEqual(term.start_date, session.start_date)
            self.assertEqual(term.end_date, session.end_date)

    def test_is_idempotent(self) -> None:
        call_command("seed_e2e_data")
        tenant = Tenant.objects.get(slug=E2E_TENANT_SLUG)
        user_before = User.objects.get(tenant=tenant, email=E2E_ADMIN_EMAIL)
        password_hash_before = user_before.password

        call_command("seed_e2e_data")

        self.assertEqual(Tenant.objects.filter(slug=E2E_TENANT_SLUG).count(), 1)
        user_after = User.objects.get(tenant=tenant, email=E2E_ADMIN_EMAIL)
        self.assertEqual(user_after.pk, user_before.pk)
        # A rerun must never reset an already-seeded admin's password — a locally
        # changed password would otherwise silently stop matching E2E_LIVE_ADMIN_PASSWORD.
        self.assertEqual(user_after.password, password_hash_before)

        with tenant_context(tenant.id):
            self.assertEqual(Campus.objects.filter(code="MAIN").count(), 1)
            self.assertEqual(AcademicSession.objects.filter(name="E2E Baseline").count(), 1)
