"""Tests for the `seed_e2e_data` management command.

Real Postgres via `TestCase` (RLS applies) — the command itself writes through
`tenant_context`, same as `seed_dev_data`, so a fake/sqlite backend cannot
exercise it honestly.
"""

from __future__ import annotations

from django.core.management import call_command
from django.test import TestCase

from apps.attendance.models import AttendanceStatus, StudentAttendance
from apps.communication.models import Notice, NoticeStatus
from apps.communication.threads.routing import route_guardian_thread
from apps.examinations.models import (
    Exam,
    ExamStatus,
    GradeBand,
    GradingScale,
    Result,
    ResultStatus,
)
from apps.examinations.services import assert_scale_usable
from apps.fees_finance.models import FeeInvoice, InvoiceStatus, LedgerAccount
from apps.parent_portal.management.commands.seed_e2e_portal import (
    E2E_EXAM_NAME,
    E2E_EXAM_THEORY_MARKS,
    E2E_FEE_MONTHLY_AMOUNT,
    E2E_NOTICE_TITLE,
)
from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    Section,
    SessionStatus,
    Term,
)
from apps.staff_management.models import EmploymentStatus, Staff, StaffType
from apps.student_management.models import Guardian, Student, StudentGuardian
from core.notifications.models import Notification
from core.notifications.permissions import NOTIFICATION_VIEW
from core.rbac.management.commands.seed_e2e_data import (
    E2E_ADMIN_EMAIL,
    E2E_ADMIN_PASSWORD,
    E2E_CLASS_TEACHER_PERMISSIONS,
    E2E_COMMS_CLASS_TEACHER_EMAIL,
    E2E_COMMS_CLASS_TEACHER_EMPLOYEE_NUMBER,
    E2E_COMMS_GUARDIAN_EMAIL,
    E2E_COMMS_STUDENT_ADMISSION_NUMBER,
    E2E_EXAM_STAFF_EMAIL,
    E2E_GUARDIAN_EMAIL,
    E2E_GUARDIAN_NAME,
    E2E_GUARDIAN_PHONE,
    E2E_OTHER_ADMIN_EMAIL,
    E2E_OTHER_TENANT_SLUG,
    E2E_PRINCIPAL_PERMISSIONS,
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

    def test_the_principal_can_oversee_threads_and_poll_its_broadcast(self) -> None:
        """§4 gives oversight and broadcast to the principal; the broadcast is a polled job."""
        for key in (
            "communication.thread.oversee",
            "communication.broadcast.send",
            "platform.job.view",
        ):
            self.assertIn(key, E2E_PRINCIPAL_PERMISSIONS)

    def test_communication_is_enabled_on_both_tenants(self) -> None:
        """The other tenant too: a disabled module answers 403 before the 404 under test."""
        call_command("seed_e2e_data")

        for slug in (E2E_TENANT_SLUG, E2E_OTHER_TENANT_SLUG):
            tenant = Tenant.objects.get(slug=slug)
            # RLS hides the row outside the tenant's own context.
            with tenant_context(tenant.id):
                override = TenantFeatureOverride.objects.get(
                    tenant=tenant, feature_flag__key="module.communication"
                )
            self.assertTrue(override.enabled, slug)

    def test_fees_and_online_payments_are_enabled_with_ledger_accounts(self) -> None:
        """`online-payments.spec.ts` needs both flags and a fee income account to post to."""
        call_command("seed_e2e_data")
        call_command("seed_e2e_data")

        tenant = Tenant.objects.get(slug=E2E_TENANT_SLUG)
        with tenant_context(tenant.id):
            enabled = set(
                TenantFeatureOverride.objects.filter(tenant=tenant, enabled=True).values_list(
                    "feature_flag__key", flat=True
                )
            )
            income = LedgerAccount.objects.filter(code="4000", is_system=True).count()
        self.assertTrue({"module.fees_finance", "fees.online-payments"} <= enabled)
        self.assertEqual(income, 1)

    def test_a_comms_guardian_thread_routes_to_the_assigned_class_teacher(self) -> None:
        """The routing chain is seeded whole: the class teacher gets it, not the fallback role."""
        call_command("seed_e2e_data")
        call_command("seed_e2e_data")
        tenant = Tenant.objects.get(slug=E2E_TENANT_SLUG)
        teacher = User.objects.get(tenant=tenant, email=E2E_COMMS_CLASS_TEACHER_EMAIL)
        guardian = User.objects.get(tenant=tenant, email=E2E_COMMS_GUARDIAN_EMAIL)

        # `assigned`, the production default, and nothing wider.
        self.assertEqual(
            set(UserRole.objects.filter(user=teacher).values_list("scope", flat=True)),
            {RecordScope.ASSIGNED},
        )
        with tenant_context(tenant.id):
            student = Student.objects.get(admission_number=E2E_COMMS_STUDENT_ADMISSION_NUMBER)
            staff = Staff.objects.get(employee_number=E2E_COMMS_CLASS_TEACHER_EMPLOYEE_NUMBER)
            self.assertEqual(staff.user_id, teacher.id)

            link = StudentGuardian.objects.get(student=student, guardian__user_id=guardian.id)
            self.assertTrue(link.has_portal_access)
            self.assertTrue(link.receives_communications)
            self.assertEqual(
                list(Student.filter_owned_by_user(Student.objects.alive(), guardian)), [student]
            )

            staff_ids, assigned_to = route_guardian_thread(student=student, tenant_id=tenant.id)

        self.assertEqual(staff_ids, [teacher.id])
        self.assertEqual(assigned_to, teacher.id)

    def test_the_school_admin_does_not_hold_leave_request_create(self) -> None:
        """§4 grants it to `student` and `guardian` only, so the seed must not widen it."""
        self.assertNotIn("attendance.leave-request.create", E2E_SCHOOL_ADMIN_PERMISSIONS)

    def test_seeds_a_restricted_guardian_holding_a_real_guardians_keys(self) -> None:
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
        # Exactly what the registry gives a real `guardian`, so the portal keys arrive with it.
        self.assertEqual(keys, set(registry.keys_for_role("guardian")))
        for key in (
            "parent-portal.dashboard.view",
            NOTIFICATION_VIEW,
            "communication.notice.view",
            "communication.notice.acknowledge",
            "attendance.student-attendance.view",
            "fees.invoice.view",
            "exams.result.view",
            "timetable.timetable.view",
            "attendance.leave-request.create",
            "communication.thread.create",
        ):
            self.assertIn(key, keys)
        self.assertNotIn("attendance.leave-request.approve", keys)

    def test_staff_identities_can_read_their_own_inbox(self) -> None:
        """Every tenant role holds the inbox key; a staff role without it 403s on the bell."""
        for keys in (
            E2E_SCHOOL_ADMIN_PERMISSIONS,
            E2E_PRINCIPAL_PERMISSIONS,
            E2E_CLASS_TEACHER_PERMISSIONS,
        ):
            self.assertIn(NOTIFICATION_VIEW, keys)

    def test_portal_modules_are_enabled_on_both_tenants(self) -> None:
        call_command("seed_e2e_data")

        for slug in (E2E_TENANT_SLUG, E2E_OTHER_TENANT_SLUG):
            tenant = Tenant.objects.get(slug=slug)
            with tenant_context(tenant.id):
                enabled = set(
                    TenantFeatureOverride.objects.filter(
                        tenant=tenant,
                        enabled=True,
                        feature_flag__key__in=[
                            "module.parent_portal",
                            "module.fees_finance",
                            "module.examinations",
                        ],
                    ).values_list("feature_flag__key", flat=True)
                )
            self.assertEqual(
                enabled,
                {"module.parent_portal", "module.fees_finance", "module.examinations"},
                slug,
            )

    def test_the_comms_child_has_a_record_behind_every_portal_card(self) -> None:
        """Seeded twice: every fixture converges rather than piling up."""
        call_command("seed_e2e_data")
        call_command("seed_e2e_data")
        tenant = Tenant.objects.get(slug=E2E_TENANT_SLUG)
        guardian = User.objects.get(tenant=tenant, email=E2E_COMMS_GUARDIAN_EMAIL)

        with tenant_context(tenant.id):
            student = Student.objects.get(admission_number=E2E_COMMS_STUDENT_ADMISSION_NUMBER)

            today = tenant.local_date()
            marked_today = StudentAttendance.objects.alive().get(
                student=student, attendance_date=today, period__isnull=True
            )
            self.assertEqual(marked_today.status, AttendanceStatus.PRESENT)

            (invoice,) = FeeInvoice.objects.alive().filter(student=student)
            self.assertEqual(invoice.status, InvoiceStatus.ISSUED)
            self.assertEqual(invoice.balance_due, E2E_FEE_MONTHLY_AMOUNT)

            exam = Exam.objects.alive().get(name=E2E_EXAM_NAME)
            self.assertEqual(exam.status, ExamStatus.PUBLISHED)
            result = Result.objects.alive().get(exam=exam, student=student)
            self.assertEqual(result.status, ResultStatus.PUBLISHED)
            self.assertIsNotNone(result.published_at)
            self.assertEqual(result.percentage, E2E_EXAM_THEORY_MARKS)
            self.assertEqual(result.grade_band.label, "B")
            # Approved by someone other than the processor (§4).
            self.assertNotEqual(result.approved_by, result.created_by)

            (notice,) = Notice.objects.alive().filter(title=E2E_NOTICE_TITLE)
            self.assertEqual(notice.status, NoticeStatus.PUBLISHED)
            self.assertTrue(notice.requires_acknowledgment)
            recipients = list(
                Notification.objects.filter(source_type="notice", source_id=notice.pk).values_list(
                    "user_id", flat=True
                )
            )
        self.assertEqual(recipients, [guardian.id])

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
