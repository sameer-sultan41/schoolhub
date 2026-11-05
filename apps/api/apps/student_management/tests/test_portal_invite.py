"""`POST /guardians/{id}:invite` and `POST /students/{id}:invite` (ADR-0033)."""

from __future__ import annotations

import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import timedelta

from django.core import mail
from django.db import connection, connections
from django.test import TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status

from apps.school_organization.tests.factories import (
    TenantFactory,
    UserFactory,
    grant,
    grant_default_role,
)
from apps.student_management.models import Guardian
from apps.student_management.portal_accounts.services import invite_to_portal
from apps.student_management.tests.base import StudentManagementAPITestCase
from apps.student_management.tests.factories import (
    CampusFactory,
    GuardianFactory,
    StudentFactory,
    enable_feature,
)
from apps.student_management.tests.portal_helpers import (
    INVITE_KEY,
    PORTAL_FEATURE,
    enrolled_student,
    linked_guardian,
    portal_account,
)
from core.rbac.invitations.exceptions import EmailInUse
from core.rbac.invitations.services import create_invited_user
from core.rbac.models import Invitation, User, UserRole
from core.rbac.tests.link_helpers import LINK_SETTINGS
from core.tenancy.context import tenant_atomic, tenant_context

STUDENT_VIEW = "students.student.view"
GUARDIAN_VIEW = "students.guardian.view"


def pending(user: User):
    return Invitation.objects.filter(user=user, accepted_at__isnull=True, revoked_at__isnull=True)


@override_settings(**LINK_SETTINGS)
class PortalInviteTests(StudentManagementAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        enable_feature(self.tenant, PORTAL_FEATURE)
        with tenant_context(self.tenant.id):
            self.student = enrolled_student(self.tenant, self.campus)
            self.guardian = linked_guardian(self.tenant, self.student)

    def invite_guardian(self, guardian: Guardian | None = None):
        return self.client.post(f"/api/v1/guardians/{(guardian or self.guardian).pk}:invite")

    def invite_student(self, email: str | None = "pupil@example.test", student=None):
        body = {} if email is None else {"email": email}
        return self.client.post(
            f"/api/v1/students/{(student or self.student).pk}:invite", body, format="json"
        )

    def assert_conflict(self, response, code: str) -> None:
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT, response.json())
        self.assertEqual(response.json()["error"]["code"], code)

    def test_invite_guardian_creates_pending_user_with_guardian_role(self) -> None:
        self.allow(INVITE_KEY)

        with self.captureOnCommitCallbacks(execute=True):
            response = self.invite_guardian()

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"], {"portal_status": "invited"})
        with tenant_context(self.tenant.id):
            self.guardian.refresh_from_db()
            user = User.objects.get(pk=self.guardian.user_id)
            invitation = pending(user).get()
        self.assertEqual(user.email, "parent@example.test")
        self.assertFalse(user.is_active)
        self.assertFalse(user.has_usable_password())
        self.assertEqual(invitation.kind, "guardian")
        role = UserRole.objects.get(user=user).role
        self.assertEqual(role.slug, "guardian")
        self.assertTrue(role.is_restricted_principal)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["parent@example.test"])

    def test_invite_student_stores_the_body_email_on_the_account_only(self) -> None:
        self.allow(INVITE_KEY, STUDENT_VIEW)

        response = self.invite_student(email="pupil@example.test")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            self.student.refresh_from_db()
            user = User.objects.get(pk=self.student.user_id)
        self.assertEqual(user.email, "pupil@example.test")
        self.assertEqual(UserRole.objects.get(user=user).role.slug, "student")

    def test_student_invite_without_email_is_400_on_email(self) -> None:
        self.allow(INVITE_KEY, STUDENT_VIEW)

        response = self.invite_student(email=None)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()["error"]["details"][0]["field"], "email")

    def test_guardian_with_no_email_on_file_is_400_on_email(self) -> None:
        self.allow(INVITE_KEY)
        with tenant_context(self.tenant.id):
            guardian = linked_guardian(self.tenant, self.student, email=None)

        response = self.invite_guardian(guardian)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()["error"]["details"][0]["field"], "email")
        with tenant_context(self.tenant.id):
            guardian.refresh_from_db()
        self.assertIsNone(guardian.user_id)

    def test_student_invite_with_guardians_email_is_409_and_links_nothing(self) -> None:
        self.allow(INVITE_KEY, STUDENT_VIEW)
        self.assertEqual(self.invite_guardian().status_code, status.HTTP_200_OK)
        users_before = User.objects.filter(tenant=self.tenant).count()

        # Same address, different case: still the guardian's.
        response = self.invite_student(email="Parent@Example.test")

        self.assert_conflict(response, "email_in_use")
        self.assertEqual(
            response.json()["error"]["message"],
            "This email belongs to another account. Use a different address.",
        )
        with tenant_context(self.tenant.id):
            self.student.refresh_from_db()
        self.assertIsNone(self.student.user_id)
        self.assertEqual(User.objects.filter(tenant=self.tenant).count(), users_before)

    def test_guardian_invite_with_staff_email_is_409_and_adds_no_role(self) -> None:
        self.allow(INVITE_KEY)
        staff_user = UserFactory(tenant=self.tenant, email="parent@example.test")
        roles_before = set(UserRole.objects.filter(user=staff_user).values_list("role", flat=True))

        response = self.invite_guardian()

        self.assert_conflict(response, "email_in_use")
        with tenant_context(self.tenant.id):
            self.guardian.refresh_from_db()
        self.assertIsNone(self.guardian.user_id)
        self.assertEqual(
            set(UserRole.objects.filter(user=staff_user).values_list("role", flat=True)),
            roles_before,
        )
        self.assertFalse(Invitation.objects.filter(user=staff_user).exists())

    def test_invite_active_is_409(self) -> None:
        self.allow(INVITE_KEY)
        with tenant_context(self.tenant.id):
            portal_account(self.guardian, active=True)

        self.assert_conflict(self.invite_guardian(), "already_active")

    def test_reinvite_pending_resends(self) -> None:
        self.allow(INVITE_KEY)
        self.assertEqual(self.invite_guardian().status_code, status.HTTP_200_OK)
        with tenant_context(self.tenant.id):
            self.guardian.refresh_from_db()
            user = User.objects.get(pk=self.guardian.user_id)
            first = pending(user).get()

        response = self.invite_guardian()

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            first.refresh_from_db()
            second = pending(user).get()
        self.assertIsNotNone(first.revoked_at)
        self.assertNotEqual(first.pk, second.pk)
        self.assertEqual(User.objects.filter(tenant=self.tenant, email=user.email).count(), 1)
        self.assertEqual(UserRole.objects.filter(user=user).count(), 1)

    def test_guardian_resend_after_fixing_a_typo_goes_to_the_corrected_address(self) -> None:
        self.allow(INVITE_KEY)
        with tenant_context(self.tenant.id):
            Guardian.objects.filter(pk=self.guardian.pk).update(email="prent@example.test")
        self.assertEqual(self.invite_guardian().status_code, status.HTTP_200_OK)
        with tenant_context(self.tenant.id):
            self.guardian.refresh_from_db()
            user = User.objects.get(pk=self.guardian.user_id)
            first = pending(user).get()
            Guardian.objects.filter(pk=self.guardian.pk).update(email="parent@example.test")

        with self.captureOnCommitCallbacks(execute=True):
            response = self.invite_guardian()

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        user.refresh_from_db()
        self.assertEqual(user.email, "parent@example.test")
        with tenant_context(self.tenant.id):
            first.refresh_from_db()
            self.assertEqual(pending(user).count(), 1)
        self.assertIsNotNone(first.revoked_at)
        self.assertEqual(mail.outbox[-1].to, ["parent@example.test"])

    def test_student_resend_goes_to_the_address_entered(self) -> None:
        self.allow(INVITE_KEY, STUDENT_VIEW)
        self.assertEqual(self.invite_student(email="pupl@example.test").status_code, 200)

        response = self.invite_student(email="pupil@example.test")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            self.student.refresh_from_db()
            user = User.objects.get(pk=self.student.user_id)
            self.assertEqual(pending(user).count(), 1)
        self.assertEqual(user.email, "pupil@example.test")

    def test_resend_to_another_accounts_address_is_409_and_keeps_the_old_one(self) -> None:
        self.allow(INVITE_KEY, STUDENT_VIEW)
        self.assertEqual(self.invite_student(email="pupl@example.test").status_code, 200)
        UserFactory(tenant=self.tenant, email="sibling@example.test")

        response = self.invite_student(email="Sibling@example.test")

        self.assert_conflict(response, "email_in_use")
        with tenant_context(self.tenant.id):
            self.student.refresh_from_db()
            user = User.objects.get(pk=self.student.user_id)
            self.assertEqual(pending(user).count(), 1)
        self.assertEqual(user.email, "pupl@example.test")

    def test_an_account_once_active_keeps_its_address_on_reinvite(self) -> None:
        """Re-addressing is for accounts nobody has signed in to; this one has."""
        self.allow(INVITE_KEY)
        with tenant_context(self.tenant.id):
            user = portal_account(self.guardian, active=True)
            Invitation.objects.create(
                tenant=self.tenant,
                user=user,
                kind="guardian",
                expires_at=timezone.now(),
                accepted_at=timezone.now(),
            )
        user.is_active = False
        user.save(update_fields=["is_active"])
        original = user.email

        response = self.invite_guardian()

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        user.refresh_from_db()
        self.assertEqual(user.email, original)
        self.assertNotEqual(original, self.guardian.email)

    def test_guardian_without_a_portal_enabled_link_is_409_not_eligible(self) -> None:
        self.allow(INVITE_KEY)
        with tenant_context(self.tenant.id):
            guardian = linked_guardian(
                self.tenant, self.student, email="noaccess@example.test", has_portal_access=False
            )

        self.assert_conflict(self.invite_guardian(guardian), "not_eligible")

    def test_student_with_no_active_enrollment_is_409_not_eligible(self) -> None:
        self.allow(INVITE_KEY, STUDENT_VIEW)
        with tenant_context(self.tenant.id):
            unenrolled = StudentFactory(tenant=self.tenant, campus=self.campus)

        response = self.invite_student(student=unenrolled)

        self.assert_conflict(response, "not_eligible")
        with tenant_context(self.tenant.id):
            unenrolled.refresh_from_db()
        self.assertIsNone(unenrolled.user_id)

    def test_teacher_cannot_invite(self) -> None:
        grant_default_role(self.user, "teacher")

        self.assertEqual(self.invite_guardian().status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.invite_student().status_code, status.HTTP_403_FORBIDDEN)

    def test_principal_can_invite_a_guardian_without_the_guardian_view_key(self) -> None:
        """§4 grants the invite key to `principal`, who does not hold `students.guardian.view`."""
        grant_default_role(self.user, "principal")

        response = self.invite_guardian()

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_foreign_guardian_invite_is_404(self) -> None:
        self.allow(INVITE_KEY)
        other = TenantFactory()
        enable_feature(other, "module.students")
        enable_feature(other, PORTAL_FEATURE)
        with tenant_context(other.id):
            other_campus = CampusFactory(tenant=other)
            foreign = linked_guardian(other, enrolled_student(other, other_campus))

        response = self.invite_guardian(foreign)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(other.id):
            foreign.refresh_from_db()
        self.assertIsNone(foreign.user_id)

    def test_patch_ignores_user_id(self) -> None:
        """Only `:invite` links an account; a PATCH could point a person at someone's login."""
        self.allow(
            "students.guardian.update", GUARDIAN_VIEW, "students.student.update", STUDENT_VIEW
        )
        owner = UserFactory(tenant=self.tenant)

        for url in (
            f"/api/v1/guardians/{self.guardian.pk}",
            f"/api/v1/students/{self.student.pk}",
        ):
            with self.subTest(url=url):
                response = self.client.patch(
                    url, {"user_id": str(owner.pk), "first_name": "Renamed"}, format="json"
                )
                self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
                self.assertIsNone(response.json()["data"]["user_id"])
        with tenant_context(self.tenant.id):
            self.guardian.refresh_from_db()
            self.student.refresh_from_db()
        self.assertIsNone(self.guardian.user_id)
        self.assertIsNone(self.student.user_id)

    def test_student_invite_on_a_guardian_linked_user_is_409_and_adds_no_role(self) -> None:
        """A link made before `user_id` was read-only gets no portal role from `:invite`."""
        self.allow(INVITE_KEY, STUDENT_VIEW)
        with tenant_context(self.tenant.id):
            guardian_user = portal_account(self.guardian, active=False)
            self.student.user_id = guardian_user.pk
            self.student.save(update_fields=["user_id"])
        roles_before = list(UserRole.objects.filter(user=guardian_user).values_list("pk"))

        response = self.invite_student()

        self.assert_conflict(response, "email_in_use")
        self.assertEqual(
            list(UserRole.objects.filter(user=guardian_user).values_list("pk")), roles_before
        )
        with tenant_context(self.tenant.id):
            self.assertFalse(Invitation.objects.filter(user=guardian_user).exists())

    def test_invite_on_a_staff_role_holder_is_409(self) -> None:
        self.allow(INVITE_KEY)
        with tenant_context(self.tenant.id):
            staff_user = portal_account(self.guardian, active=False)
        grant(staff_user, "students.student.view")

        self.assert_conflict(self.invite_guardian(), "email_in_use")

    def test_a_lost_email_race_is_409_not_500(self) -> None:
        """Two invites for different people with one address both pass the free-email check."""
        UserFactory(tenant=self.tenant, email="taken@example.test")

        with self.assertRaises(EmailInUse):
            create_invited_user(
                tenant_id=self.tenant.id, email="taken@example.test", first_name="A", last_name="B"
            )

    def test_invite_replays_with_the_same_idempotency_key(self) -> None:
        self.allow(INVITE_KEY)
        headers = {"HTTP_IDEMPOTENCY_KEY": "invite-guardian-once"}

        first = self.client.post(f"/api/v1/guardians/{self.guardian.pk}:invite", **headers)
        second = self.client.post(f"/api/v1/guardians/{self.guardian.pk}:invite", **headers)

        self.assertEqual(first.status_code, status.HTTP_200_OK, first.json())
        # A replay is a new request, so its envelope carries a fresh request_id; the
        # payload and message are what it repeats (as the other replay tests compare).
        self.assertEqual(second.status_code, status.HTTP_200_OK, second.json())
        self.assertEqual(second.json()["data"], first.json()["data"])
        self.assertEqual(second.json()["meta"]["message"], first.json()["meta"]["message"])
        with tenant_context(self.tenant.id):
            self.guardian.refresh_from_db()
            self.assertEqual(Invitation.objects.filter(user_id=self.guardian.user_id).count(), 1)

    def test_portal_status_reports_each_account_state(self) -> None:
        self.allow(GUARDIAN_VIEW)
        now = timezone.now()
        with tenant_context(self.tenant.id):
            none = GuardianFactory(tenant=self.tenant)
            active = GuardianFactory(tenant=self.tenant)
            portal_account(active, active=True)
            inactive = GuardianFactory(tenant=self.tenant)
            portal_account(inactive, active=False)
            states = {"none": none, "active": active, "inactive": inactive}
            for name, invitation in {
                "invited": {"expires_at": now + timedelta(hours=1)},
                "expired": {"expires_at": now - timedelta(hours=1)},
                "send_failed": {"expires_at": now + timedelta(hours=1), "send_failed_at": now},
                "revoked": {"expires_at": now + timedelta(hours=1), "revoked_at": now},
            }.items():
                guardian = GuardianFactory(tenant=self.tenant)
                user = portal_account(guardian, active=False)
                Invitation.objects.create(
                    tenant=self.tenant, user=user, kind="guardian", **invitation
                )
                states[name] = guardian

        rows = {
            row["id"]: row["portal_status"]
            for row in self.client.get("/api/v1/guardians?page_size=50").json()["data"]
        }

        expected = {**{name: name for name in states}, "revoked": "inactive"}
        for name, guardian in states.items():
            with self.subTest(state=name):
                self.assertEqual(rows[str(guardian.pk)], expected[name])
                detail = self.client.get(f"/api/v1/guardians/{guardian.pk}").json()["data"]
                self.assertEqual(detail["portal_status"], expected[name])

    def test_portal_status_list_query_count_constant(self) -> None:
        self.allow(GUARDIAN_VIEW, STUDENT_VIEW)

        def add_rows() -> None:
            with tenant_context(self.tenant.id):
                student = enrolled_student(self.tenant, self.campus)
                portal_account(student, active=True)
                guardian = linked_guardian(self.tenant, student, email=None)
                user = portal_account(guardian, active=False)
                Invitation.objects.create(
                    tenant=self.tenant,
                    user=user,
                    kind="guardian",
                    expires_at=timezone.now() + timedelta(hours=1),
                )

        def queries(url: str) -> int:
            with CaptureQueriesContext(connection) as captured:
                response = self.client.get(url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            return len(captured)

        urls = ("/api/v1/guardians", "/api/v1/students")
        add_rows()
        # Warm the RBAC and feature-flag caches first: the first request of a test pays
        # for those lookups, which would make the baseline larger than any later count.
        for url in urls:
            queries(url)
        baseline = {url: queries(url) for url in urls}
        for _ in range(3):
            add_rows()

        for url, count in baseline.items():
            with self.subTest(url=url):
                self.assertEqual(queries(url), count)


@override_settings(**LINK_SETTINGS)
class PortalDisabledTests(StudentManagementAPITestCase):
    """`module.parent_portal` defaults off (#156), so this tenant never enables it."""

    def test_invite_when_portal_disabled_is_409(self) -> None:
        self.allow(INVITE_KEY, STUDENT_VIEW)
        with tenant_context(self.tenant.id):
            student = enrolled_student(self.tenant, self.campus)
            guardian = linked_guardian(self.tenant, student)

        responses = [
            self.client.post(f"/api/v1/guardians/{guardian.pk}:invite"),
            self.client.post(
                f"/api/v1/students/{student.pk}:invite", {"email": "a@example.test"}, format="json"
            ),
        ]

        for response in responses:
            with self.subTest(url=response.request["PATH_INFO"]):
                self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
                self.assertEqual(response.json()["error"]["code"], "portal_disabled")
        with tenant_context(self.tenant.id):
            guardian.refresh_from_db()
            student.refresh_from_db()
        self.assertIsNone(guardian.user_id)
        self.assertIsNone(student.user_id)


LOCK_WAIT_SECONDS = 10
LOCK_POLL_SECONDS = 0.05


@override_settings(**LINK_SETTINGS)
class ConcurrentPortalInviteTests(TransactionTestCase):
    """Two invites for one guardian at once (L30), as `core/rbac/tests/test_concurrency.py`.

    The first holds its transaction open after creating the account; the second must wait
    on the guardian row lock and then resend. Without the lock the second reads no account,
    inserts a second user with the same email, waits on the unique index instead, and is
    refused (`email_in_use`, from the unique index) once the first commits.
    """

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_atomic(self.tenant.id):
            enable_feature(self.tenant, "module.students")
            enable_feature(self.tenant, PORTAL_FEATURE)
            self.actor = UserFactory(tenant=self.tenant)
            campus = CampusFactory(tenant=self.tenant)
            self.guardian = linked_guardian(self.tenant, enrolled_student(self.tenant, campus))

    def wait_until_blocked(self, contending: Future) -> None:
        deadline = time.monotonic() + LOCK_WAIT_SECONDS
        while time.monotonic() < deadline:
            with connection.cursor() as cursor:
                cursor.execute("SELECT count(*) FROM pg_locks WHERE NOT granted")
                (waiting,) = cursor.fetchone()
            if waiting:
                return
            self.assertFalse(contending.done(), "the contending invite returned without waiting")
            time.sleep(LOCK_POLL_SECONDS)
        self.fail("the contending invite never waited on a lock")

    def test_concurrent_invites_create_one_user(self) -> None:
        def contender() -> User:
            try:
                with tenant_atomic(self.tenant.id):
                    stale = Guardian.objects.get(pk=self.guardian.pk)
                    return invite_to_portal(person=stale, actor_id=self.actor.pk)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with tenant_atomic(self.tenant.id):
                first = invite_to_portal(person=self.guardian, actor_id=self.actor.pk)
                contending = pool.submit(contender)
                self.wait_until_blocked(contending)
            second = contending.result(timeout=LOCK_WAIT_SECONDS)

        self.assertEqual(second.pk, first.pk)
        with tenant_atomic(self.tenant.id):
            self.guardian.refresh_from_db()
            self.assertEqual(self.guardian.user_id, first.pk)
            self.assertEqual(pending(first).count(), 1)
        self.assertEqual(
            User.objects.filter(tenant=self.tenant, email="parent@example.test").count(), 1
        )
