"""`GET/PATCH /onboarding` (platform-admin §16): the computed setup checklist (§5.6)."""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from rest_framework import status

from apps.fees_finance.models import FeeStructureStatus
from apps.fees_finance.tests.factories import (
    FeeStructureFactory,
    disable_feature,
    enable_feature,
)
from apps.school_organization.models import SessionStatus
from apps.school_organization.tests.base import SchoolOrganizationAPITestCase
from apps.school_organization.tests.factories import (
    SESSION_END,
    SESSION_START,
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    SectionFactory,
    SubjectFactory,
    TenantFactory,
    TermFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.student_management.tests.factories import StudentFactory
from core.rbac.models import Invitation, InvitationKind
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantSettings

URL = "/api/v1/onboarding"

STRUCTURE_STEPS = ["profile", "campuses", "academic_session", "classes", "subjects"]
MODULE_STEPS = {
    "module.fees_finance": "fee_structures",
    "module.staff": "staff_invites",
    "module.students": "students",
}
ALL_STEPS = [*STRUCTURE_STEPS, "fee_structures", "staff_invites", "students", "go_live"]


def set_modules(tenant, *, enabled: bool) -> None:
    for key in MODULE_STEPS:
        (enable_feature if enabled else disable_feature)(tenant, key)


def build_setup(tenant, *, session_status: str = SessionStatus.PLANNED):
    """A campus, a session whose one term covers it, a class with a section and a subject."""
    with tenant_context(tenant.id):
        campus = CampusFactory(tenant=tenant)
        session = AcademicSessionFactory(tenant=tenant, status=session_status)
        TermFactory(tenant=tenant, academic_session=session)
        school_class = ClassFactory(tenant=tenant)
        SectionFactory(tenant=tenant, school_class=school_class, campus=campus)
        SubjectFactory(tenant=tenant)
    return campus, session


def invite(tenant, *, kind: str = InvitationKind.STAFF, **stamps) -> Invitation:
    with tenant_context(tenant.id):
        return Invitation.objects.create(
            tenant=tenant,
            user=UserFactory(tenant=tenant),
            kind=kind,
            expires_at=timezone.now() + timedelta(days=7),
            **stamps,
        )


class OnboardingTestCase(SchoolOrganizationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("school.settings.view", "school.settings.update")

    def progress(self) -> dict:
        response = self.client.get(URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return response.json()["data"]

    def step(self, key: str) -> dict:
        return next(step for step in self.progress()["steps"] if step["key"] == key)

    def patch(self, body: dict):
        return self.client.patch(URL, body, format="json")


class OnboardingProgressTests(OnboardingTestCase):
    def test_fresh_tenant_no_steps_done(self) -> None:
        set_modules(self.tenant, enabled=True)

        data = self.progress()

        self.assertEqual([step["key"] for step in data["steps"]], ALL_STEPS)
        self.assertTrue(all(step["done"] is False for step in data["steps"]))
        self.assertTrue(all(step["skipped"] is False for step in data["steps"]))
        self.assertFalse(data["completed"])
        self.assertIsNone(data["completed_at"])
        counts = {step["key"]: step.get("count") for step in data["steps"]}
        # A step that counts rows reports 0; the profile and go-live steps carry no count.
        self.assertEqual(
            counts,
            {
                "profile": None,
                "campuses": 0,
                "academic_session": 0,
                "classes": 0,
                "subjects": 0,
                "fee_structures": 0,
                "staff_invites": 0,
                "students": 0,
                "go_live": None,
            },
        )
        self.assertNotIn("count", data["steps"][0])
        skippable = {step["key"] for step in data["steps"] if step["skippable"]}
        self.assertEqual(skippable, {"fee_structures", "staff_invites", "students"})

    def test_session_step_done_before_classes_exist(self) -> None:
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)
            TermFactory(tenant=self.tenant, academic_session=session)

        step = self.step("academic_session")

        self.assertTrue(step["done"])
        self.assertEqual(step["count"], 1)
        self.assertFalse(self.step("campuses")["done"])
        self.assertFalse(self.step("classes")["done"])

    def test_session_step_needs_term_coverage(self) -> None:
        with tenant_context(self.tenant.id):
            no_terms = AcademicSessionFactory(tenant=self.tenant)
            AcademicSessionFactory(
                tenant=self.tenant,
                start_date=SESSION_START.replace(year=SESSION_START.year + 2),
                end_date=SESSION_END.replace(year=SESSION_END.year + 2),
            )
            short = AcademicSessionFactory(
                tenant=self.tenant,
                start_date=SESSION_START.replace(year=SESSION_START.year + 4),
                end_date=SESSION_END.replace(year=SESSION_END.year + 4),
            )
            # A term that stops a month early leaves a gap at the end.
            TermFactory(
                tenant=self.tenant,
                academic_session=short,
                start_date=short.start_date,
                end_date=short.end_date - timedelta(days=30),
            )

        step = self.step("academic_session")
        self.assertFalse(step["done"])
        self.assertEqual(step["count"], 0)

        with tenant_context(self.tenant.id):
            TermFactory(tenant=self.tenant, academic_session=no_terms)
        self.assertEqual(self.step("academic_session")["count"], 1)

    def test_closed_session_does_not_complete_the_session_step(self) -> None:
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant, status=SessionStatus.CLOSED)
            TermFactory(tenant=self.tenant, academic_session=session)

        self.assertFalse(self.step("academic_session")["done"])

    def test_counts_follow_each_steps_rule(self) -> None:
        set_modules(self.tenant, enabled=True)
        _, session = build_setup(self.tenant)
        with tenant_context(self.tenant.id):
            CampusFactory(tenant=self.tenant, is_active=False)
            ClassFactory(tenant=self.tenant)  # no section: not counted
            SubjectFactory(tenant=self.tenant, is_active=False)
            FeeStructureFactory(
                tenant=self.tenant, academic_session=session, status=FeeStructureStatus.DRAFT
            )
            FeeStructureFactory(
                tenant=self.tenant, academic_session=session, status=FeeStructureStatus.ACTIVE
            )
            campus = CampusFactory(tenant=self.tenant)
            StudentFactory(tenant=self.tenant, campus=campus)
            StudentFactory(tenant=self.tenant, campus=campus, deleted_at=timezone.now())

        counts = {step["key"]: step.get("count") for step in self.progress()["steps"]}

        self.assertEqual(counts["campuses"], 2)
        self.assertEqual(counts["classes"], 1)
        self.assertEqual(counts["subjects"], 1)
        self.assertEqual(counts["fee_structures"], 1)
        self.assertEqual(counts["students"], 1)
        self.assertFalse(self.step("go_live")["done"])

    def test_owner_invitation_does_not_complete_staff_step(self) -> None:
        enable_feature(self.tenant, "module.staff")
        invite(self.tenant, kind=InvitationKind.OWNER, accepted_at=timezone.now())
        invite(self.tenant, kind=InvitationKind.OWNER, sent_at=timezone.now())

        step = self.step("staff_invites")

        self.assertFalse(step["done"])
        self.assertEqual(step["count"], 0)

    def test_failed_or_revoked_staff_invite_not_done(self) -> None:
        enable_feature(self.tenant, "module.staff")
        now = timezone.now()
        invite(self.tenant)  # never sent
        invite(self.tenant, sent_at=now, revoked_at=now)
        invite(self.tenant, sent_at=now, send_failed_at=now)

        self.assertFalse(self.step("staff_invites")["done"])

        invite(self.tenant, sent_at=now)
        invite(self.tenant, sent_at=now, revoked_at=now, accepted_at=now)
        step = self.step("staff_invites")
        self.assertTrue(step["done"])
        self.assertEqual(step["count"], 2)

    def test_steps_omitted_when_module_off(self) -> None:
        set_modules(self.tenant, enabled=False)

        keys = [step["key"] for step in self.progress()["steps"]]

        self.assertEqual(keys, [*STRUCTURE_STEPS, "go_live"])
        for module, step in MODULE_STEPS.items():
            enable_feature(self.tenant, module)
            self.assertIn(step, [s["key"] for s in self.progress()["steps"]])
            disable_feature(self.tenant, module)

    def test_completed_when_every_remaining_step_is_done_or_skipped(self) -> None:
        set_modules(self.tenant, enabled=True)
        build_setup(self.tenant, session_status=SessionStatus.ACTIVE)
        for body in ({"confirm": "profile"}, {"skip": "fee_structures"}, {"skip": "students"}):
            self.assertEqual(self.patch(body).status_code, status.HTTP_200_OK)
        self.assertFalse(self.progress()["completed"])

        self.assertEqual(self.patch({"skip": "staff_invites"}).status_code, status.HTTP_200_OK)
        first = self.progress()
        second = self.progress()

        self.assertTrue(first["completed"])
        self.assertIsNotNone(first["completed_at"])
        self.assertEqual(second["completed_at"], first["completed_at"])
        self.assertTrue(self.step("go_live")["done"])

    def test_other_tenants_rows_never_counted(self) -> None:
        set_modules(self.tenant, enabled=True)
        other = TenantFactory()
        set_modules(other, enabled=True)
        _, session = build_setup(other, session_status=SessionStatus.ACTIVE)
        with tenant_context(other.id):
            FeeStructureFactory(
                tenant=other, academic_session=session, status=FeeStructureStatus.ACTIVE
            )
            StudentFactory(tenant=other, campus=CampusFactory(tenant=other))
        invite(other, sent_at=timezone.now())

        data = self.progress()

        self.assertTrue(all(step["done"] is False for step in data["steps"]))
        self.assertTrue(all(step.get("count", 0) == 0 for step in data["steps"]))


class OnboardingUpdateTests(OnboardingTestCase):
    def test_skip_only_skippable(self) -> None:
        set_modules(self.tenant, enabled=True)

        refused = self.patch({"skip": "campuses"})
        self.assertEqual(refused.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(
            self.patch({"unskip": "go_live"}).status_code, status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        self.assertEqual(
            self.patch({"confirm": "campuses"}).status_code, status.HTTP_422_UNPROCESSABLE_ENTITY
        )

        skipped = self.patch({"skip": "fee_structures"})
        self.assertEqual(skipped.status_code, status.HTTP_200_OK, skipped.json())
        steps = {step["key"]: step for step in skipped.json()["data"]["steps"]}
        self.assertTrue(steps["fee_structures"]["skipped"])
        self.assertFalse(steps["fee_structures"]["done"])

        unskipped = self.patch({"unskip": "fee_structures"})
        self.assertEqual(unskipped.status_code, status.HTTP_200_OK)
        self.assertFalse(self.step("fee_structures")["skipped"])

    def test_patch_merges_keys_into_the_stored_document(self) -> None:
        set_modules(self.tenant, enabled=True)

        self.patch({"skip": "students"})
        self.patch({"skip": "staff_invites"})
        self.patch({"skip": "students"})  # idempotent: no duplicate entry
        confirmed = self.patch({"confirm": "profile"})

        self.assertEqual(confirmed.status_code, status.HTTP_200_OK)
        with tenant_context(self.tenant.id):
            stored = TenantSettings.objects.get(tenant=self.tenant).onboarding
        self.assertEqual(sorted(stored["skipped"]), ["staff_invites", "students"])
        self.assertIsNotNone(stored["profile_confirmed_at"])
        self.assertTrue(self.step("profile")["done"])

    def test_patch_takes_exactly_one_known_action(self) -> None:
        for body in ({}, {"skip": "students", "unskip": "students"}, {"skip": "nonsense"}):
            with self.subTest(body=body):
                response = self.patch(body)
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_patch_requires_settings_update(self) -> None:
        reader = UserFactory(tenant=self.tenant)
        grant(reader, "school.settings.view")
        authenticate(self.client, reader)

        self.assertEqual(self.client.get(URL).status_code, status.HTTP_200_OK)
        response = self.patch({"confirm": "profile"})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        authenticate(self.client, UserFactory(tenant=self.tenant))
        self.assertEqual(self.client.get(URL).status_code, status.HTTP_403_FORBIDDEN)
