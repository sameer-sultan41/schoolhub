"""Tests for the `seed_e2e_data` management command.

Real Postgres via `TestCase` (RLS applies) — the command itself writes through
`tenant_context`, same as `seed_dev_data`, so a fake/sqlite backend cannot
exercise it honestly.
"""

from __future__ import annotations

from django.core.management import call_command
from django.test import TestCase

from apps.examinations.models import GradeBand, GradingScale
from apps.examinations.services import assert_scale_usable
from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    Section,
    SessionStatus,
    Term,
)
from apps.staff_management.models import EmploymentStatus, Staff, StaffType
from apps.student_management.models import Guardian
from core.rbac.management.commands.seed_e2e_data import (
    E2E_ADMIN_EMAIL,
    E2E_ADMIN_PASSWORD,
    E2E_EXAM_STAFF_EMAIL,
    E2E_GUARDIAN_EMAIL,
    E2E_GUARDIAN_NAME,
    E2E_GUARDIAN_PERMISSIONS,
    E2E_GUARDIAN_PHONE,
    E2E_OTHER_ADMIN_EMAIL,
    E2E_OTHER_TENANT_SLUG,
    E2E_SCHOOL_ADMIN_PERMISSIONS,
    E2E_TEACHER_EMAIL,
    E2E_TENANT_SLUG,
    e2e_exam_staff_permissions,
    e2e_teacher_permissions,
)
from core.rbac.models import RecordScope, Role, RolePermission, User, UserRole
from core.rbac.registry import registry
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant, TenantFeatureOverride, TenantSettings, TenantStatus


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


class SeedE2EExaminationsTests(TestCase):
    """The examinations lane: the flag, two identities, a teacher's Staff row, a scale."""

    def setUp(self) -> None:
        super().setUp()
        call_command("seed_e2e_data")
        self.tenant = Tenant.objects.get(slug=E2E_TENANT_SLUG)

    def role_keys(self, slug: str) -> set[str]:
        role = Role.objects.get(tenant=self.tenant, slug=slug)
        return set(
            RolePermission.objects.filter(role=role).values_list("permission__key", flat=True)
        )

    def assert_no_wider_than(self, role: str, keys: set[str]) -> None:
        """Every seeded key is one the real role holds by default (registry)."""
        specs = {spec.key: spec for spec in registry.all()}
        wider = sorted(key for key in keys if role not in specs[key].default_roles)
        self.assertEqual(wider, [], f"{role} seed holds keys the real role does not")

    def test_examinations_is_enabled_on_both_tenants(self) -> None:
        for slug in (E2E_TENANT_SLUG, E2E_OTHER_TENANT_SLUG):
            tenant = Tenant.objects.get(slug=slug)
            with self.subTest(tenant=slug), tenant_context(tenant.id):
                override = TenantFeatureOverride.objects.get(
                    tenant=tenant, feature_flag__key="module.examinations"
                )
                self.assertTrue(override.enabled)

    def test_exam_staff_holds_its_role_s_exams_keys_and_its_picker_reads(self) -> None:
        user = User.objects.get(tenant=self.tenant, email=E2E_EXAM_STAFF_EMAIL)
        role = Role.objects.get(tenant=self.tenant, slug="exam_staff")
        keys = self.role_keys("exam_staff")

        self.assertTrue(user.check_password(E2E_ADMIN_PASSWORD))
        self.assertEqual(keys, set(e2e_exam_staff_permissions()))
        self.assertIn("exams.exam.create", keys)
        self.assertIn("timetable.timetable.view", keys)
        self.assertIn("platform.file.view", keys)
        self.assert_no_wider_than("exam_staff", keys)
        self.assertEqual(
            list(UserRole.objects.filter(user=user, role=role).values_list("scope", flat=True)),
            [RecordScope.ALL],
        )

    def test_the_teacher_holds_exactly_its_role_s_exams_keys_assigned_scoped(self) -> None:
        user = User.objects.get(tenant=self.tenant, email=E2E_TEACHER_EMAIL)
        role = Role.objects.get(tenant=self.tenant, slug="teacher")
        keys = self.role_keys("teacher")

        expected = {
            spec.key for spec in registry.for_module("exams") if "teacher" in spec.default_roles
        }
        self.assertEqual(keys, expected)
        self.assertEqual(set(e2e_teacher_permissions()), expected)
        self.assertIn("exams.exam.view", keys)
        self.assertEqual(
            list(UserRole.objects.filter(user=user, role=role).values_list("scope", flat=True)),
            [RecordScope.ASSIGNED],
        )

    def test_the_principal_holds_the_results_approver_s_exams_keys(self) -> None:
        """The approver half of the results journey: approve, publish and principal
        remarks, never processing or generation, and nothing the real role lacks."""
        keys = {key for key in self.role_keys("principal") if key.startswith("exams.")}

        self.assertEqual(
            keys,
            {
                "exams.exam.view",
                "exams.schedule.view",
                "exams.marks.view",
                "exams.result.view",
                "exams.result.approve",
                "exams.result.publish",
                "exams.report-card.view",
                "exams.report-card.publish",
            },
        )
        self.assert_no_wider_than("principal", keys)

    def test_the_teacher_login_has_an_active_teaching_staff_row(self) -> None:
        user = User.objects.get(tenant=self.tenant, email=E2E_TEACHER_EMAIL)

        with tenant_context(self.tenant.id):
            staff = Staff.objects.alive().get(user_id=user.id)
            self.assertEqual(staff.staff_type, StaffType.TEACHING)
            self.assertEqual(staff.employment_status, EmploymentStatus.ACTIVE)

    def test_seeds_one_complete_default_scale(self) -> None:
        with tenant_context(self.tenant.id):
            scale = GradingScale.objects.alive().get(is_default=True)
            self.assertEqual(scale.name, "E2E Percentage")
            assert_scale_usable(scale)

    def test_the_examinations_lane_is_idempotent(self) -> None:
        call_command("seed_e2e_data")

        teacher = User.objects.get(tenant=self.tenant, email=E2E_TEACHER_EMAIL)
        exam_staff = User.objects.get(tenant=self.tenant, email=E2E_EXAM_STAFF_EMAIL)
        self.assertEqual(UserRole.objects.filter(user=teacher).count(), 1)
        self.assertEqual(UserRole.objects.filter(user=exam_staff).count(), 1)
        self.assertEqual(self.role_keys("teacher"), set(e2e_teacher_permissions()))
        self.assertEqual(self.role_keys("exam_staff"), set(e2e_exam_staff_permissions()))
        with tenant_context(self.tenant.id):
            self.assertEqual(Staff.objects.alive().filter(user_id=teacher.id).count(), 1)
            scales = GradingScale.objects.alive().filter(name="E2E Percentage")
            self.assertEqual(scales.count(), 1)
            bands = GradeBand.objects.alive().filter(grading_scale=scales.get())
            self.assertEqual(bands.count(), 5)
