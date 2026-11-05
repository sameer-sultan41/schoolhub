"""Portal accounts end when access does (ADR-0033): `sync_portal_account` call sites.

Each test starts from an active account holding a refresh token and checks the account is
deactivated, the token blacklisted and pending invitations revoked, or that it is left
alone when the person is still eligible.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.school_organization.tests.factories import UserFactory, grant
from apps.student_management.models import StudentGuardian, TransferType
from apps.student_management.services import (
    approve_transfer,
    complete_transfer,
    request_transfer,
)
from apps.student_management.tests.base import StudentManagementAPITestCase
from apps.student_management.tests.factories import enable_feature
from apps.student_management.tests.portal_helpers import (
    INVITE_KEY,
    PORTAL_FEATURE,
    enrolled_student,
    linked_guardian,
    portal_account,
)
from core.audit.models import AuditLog
from core.rbac.models import Invitation, User
from core.rbac.tests.link_helpers import LINK_SETTINGS, emailed_link
from core.tenancy.context import tenant_context

GUARDIAN_UPDATE = ("students.guardian.update", "students.guardian.view")
WITHDRAW = ("students.student.withdraw", "students.student.view")
ACCEPT_URL = "/api/v1/auth/invitations:accept"


@override_settings(**LINK_SETTINGS)
class PortalRevocationTests(StudentManagementAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        cache.clear()  # the accept endpoint's throttle buckets
        enable_feature(self.tenant, PORTAL_FEATURE)
        with tenant_context(self.tenant.id):
            self.student = enrolled_student(self.tenant, self.campus)
            self.guardian = linked_guardian(self.tenant, self.student)
            self.link = StudentGuardian.objects.get(guardian=self.guardian)
            self.guardian_user = portal_account(self.guardian)
            self.student_user = portal_account(self.student)
        self.refresh = {
            user.pk: RefreshToken.for_user(user) for user in (self.guardian_user, self.student_user)
        }

    def assert_deactivated(self, user: User) -> None:
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        self.assertTrue(
            BlacklistedToken.objects.filter(token__jti=self.refresh[user.pk]["jti"]).exists(),
            "the refresh token must be blacklisted",
        )
        self.assertTrue(
            AuditLog.objects.filter(
                action="auth.account.deactivated", tenant=self.tenant, resource_id=user.pk
            ).exists()
        )

    def assert_still_active(self, user: User) -> None:
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertFalse(
            BlacklistedToken.objects.filter(token__jti=self.refresh[user.pk]["jti"]).exists()
        )

    def revoke_link(self, link: StudentGuardian):
        return self.client.patch(
            f"/api/v1/student-guardians/{link.pk}", {"has_portal_access": False}, format="json"
        )

    def withdraw(self, student):
        return self.client.post(
            f"/api/v1/students/{student.pk}:withdraw",
            {"reason": "Moved away.", "effective_date": "2026-06-01"},
            format="json",
        )

    def test_revoking_last_portal_link_deactivates_and_revokes_invites(self) -> None:
        self.allow(*GUARDIAN_UPDATE)
        with tenant_context(self.tenant.id):
            stale = Invitation.objects.create(
                tenant=self.tenant,
                user=self.guardian_user,
                kind="guardian",
                expires_at=timezone.now() + timedelta(hours=1),
            )

        response = self.revoke_link(self.link)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertFalse(response.json()["data"]["has_portal_access"])
        self.assert_deactivated(self.guardian_user)
        with tenant_context(self.tenant.id):
            stale.refresh_from_db()
        self.assertIsNotNone(stale.revoked_at)
        # The student's own account does not depend on the guardian's link.
        self.assert_still_active(self.student_user)

    def test_second_link_keeps_account_active(self) -> None:
        self.allow(*GUARDIAN_UPDATE)
        with tenant_context(self.tenant.id):
            sibling = enrolled_student(self.tenant, self.campus)
            StudentGuardian.objects.create(
                tenant=self.tenant, student=sibling, guardian=self.guardian, relationship="father"
            )

        response = self.revoke_link(self.link)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assert_still_active(self.guardian_user)

    def test_primary_flag_change_still_goes_through_the_service(self) -> None:
        """The PATCH used to be a plain save unless `is_primary` was set; both now share a path."""
        self.allow(*GUARDIAN_UPDATE)

        response = self.client.patch(
            f"/api/v1/student-guardians/{self.link.pk}",
            {"is_primary": True, "has_portal_access": False},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertTrue(response.json()["data"]["is_primary"])
        self.assert_deactivated(self.guardian_user)

    def test_student_withdrawal_deactivates(self) -> None:
        self.allow(*WITHDRAW)

        response = self.withdraw(self.student)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["portal_status"], "inactive")
        self.assert_deactivated(self.student_user)
        self.assert_deactivated(self.guardian_user)

    def test_guardian_keeps_account_when_one_of_two_children_withdraws(self) -> None:
        self.allow(*WITHDRAW)
        with tenant_context(self.tenant.id):
            sibling = enrolled_student(self.tenant, self.campus)
            StudentGuardian.objects.create(
                tenant=self.tenant, student=sibling, guardian=self.guardian, relationship="father"
            )

        response = self.withdraw(self.student)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assert_deactivated(self.student_user)
        self.assert_still_active(self.guardian_user)

    def test_student_transfer_out_deactivates(self) -> None:
        approver = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            transfer = request_transfer(
                student=self.student,
                transfer_type=TransferType.OUTGOING,
                reason="Family relocation.",
                effective_date=date(2026, 6, 1),
                from_campus=self.campus,
                external_school_name="Another School",
                actor_id=self.user.pk,
                tenant_id=self.tenant.id,
            )
            approve_transfer(transfer=transfer, actor_id=approver.pk)
            complete_transfer(transfer=transfer, actor_id=approver.pk)

        self.assert_deactivated(self.student_user)
        self.assert_deactivated(self.guardian_user)

    def test_deleting_a_student_deactivates(self) -> None:
        self.allow("students.student.delete", "students.student.view")

        response = self.client.delete(f"/api/v1/students/{self.student.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assert_deactivated(self.student_user)
        self.assert_deactivated(self.guardian_user)

    def test_sync_leaves_a_staff_user_linked_to_a_guardian_active(self) -> None:
        """A link made before `user_id` became read-only must never deactivate staff."""
        self.allow(*GUARDIAN_UPDATE)
        staff_user = UserFactory(tenant=self.tenant)
        grant(staff_user, "students.student.view")
        with tenant_context(self.tenant.id):
            self.guardian.user_id = staff_user.pk
            self.guardian.save(update_fields=["user_id"])
        jti = RefreshToken.for_user(staff_user)["jti"]

        response = self.revoke_link(self.link)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        staff_user.refresh_from_db()
        self.assertTrue(staff_user.is_active)
        self.assertFalse(BlacklistedToken.objects.filter(token__jti=jti).exists())

    def test_reinvite_after_deactivation_reenables_on_accept(self) -> None:
        self.allow(*GUARDIAN_UPDATE, INVITE_KEY)
        self.assertEqual(self.revoke_link(self.link).status_code, status.HTTP_200_OK)
        self.assert_deactivated(self.guardian_user)

        # Restoring access never reactivates by itself: only a new invitation does.
        restored = self.client.patch(
            f"/api/v1/student-guardians/{self.link.pk}", {"has_portal_access": True}, format="json"
        )
        self.assertEqual(restored.status_code, status.HTTP_200_OK)
        self.guardian_user.refresh_from_db()
        self.assertFalse(self.guardian_user.is_active)

        with self.captureOnCommitCallbacks(execute=True):
            invited = self.client.post(f"/api/v1/guardians/{self.guardian.pk}:invite")
        self.assertEqual(invited.status_code, status.HTTP_200_OK, invited.json())
        self.assertEqual(invited.json()["data"]["portal_status"], "invited")
        _, fragment = emailed_link(mail.outbox[-1])

        accepted = self.client.post(
            ACCEPT_URL,
            {
                "school": fragment["school"],
                "token": fragment["token"],
                "password": "test-password-reenabled-2468",
            },
            format="json",
        )

        self.assertEqual(accepted.status_code, status.HTTP_204_NO_CONTENT, accepted.content)
        self.guardian_user.refresh_from_db()
        self.assertTrue(self.guardian_user.is_active)
        self.assertTrue(self.guardian_user.check_password("test-password-reenabled-2468"))

    def test_pending_invitation_cannot_be_accepted_after_access_is_revoked(self) -> None:
        """Review focus 1: a revoked guardian never regains access through an old link."""
        self.allow(*GUARDIAN_UPDATE, INVITE_KEY)
        with tenant_context(self.tenant.id):
            guardian = linked_guardian(self.tenant, self.student, email="late@example.test")
        with self.captureOnCommitCallbacks(execute=True):
            invited = self.client.post(f"/api/v1/guardians/{guardian.pk}:invite")
        self.assertEqual(invited.status_code, status.HTTP_200_OK, invited.json())
        _, fragment = emailed_link(mail.outbox[-1])
        with tenant_context(self.tenant.id):
            link = StudentGuardian.objects.get(guardian=guardian)
        self.assertEqual(self.revoke_link(link).status_code, status.HTTP_200_OK)

        accepted = self.client.post(
            ACCEPT_URL,
            {
                "school": fragment["school"],
                "token": fragment["token"],
                "password": "test-password-too-late-1357",
            },
            format="json",
        )

        self.assertEqual(accepted.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(accepted.json()["error"]["code"], "invalid_link")
        with tenant_context(self.tenant.id):
            guardian.refresh_from_db()
        self.assertFalse(User.objects.get(pk=guardian.user_id).is_active)
