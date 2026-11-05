"""Tests for the :invite and :exit colon-actions, plus ``DenyRestrictedPrincipals``

— this module's first real consumer (views.py's module docstring: previously
zero call sites anywhere in the codebase).
"""

from __future__ import annotations

import datetime

from rest_framework import status
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.school_organization.tests.factories import (
    ClassFactory,
    SectionFactory,
    UserFactory,
    grant,
    grant_default_role,
)
from apps.staff_management.models import EmploymentStatus, Staff
from apps.staff_management.tests.base import StaffManagementAPITestCase
from apps.staff_management.tests.factories import DEFAULT_JOINING_DATE, StaffFactory
from apps.student_management.tests.factories import GuardianFactory
from core.audit.models import AuditLog
from core.rbac.cache import evict_rbac_caches
from core.rbac.invitations.eligibility import is_eligible
from core.rbac.models import (
    Invitation,
    Permission,
    RecordScope,
    Role,
    RolePermission,
    User,
    UserRole,
)
from core.rbac.registry import registry
from core.rbac.seeding import ensure_role_with_permissions
from core.rbac.tests.link_helpers import invited_user
from core.tenancy.context import tenant_context


class InviteTests(StaffManagementAPITestCase):
    def test_invite_creates_a_linked_inactive_account_and_assigns_roles(self) -> None:
        self.allow("staff.staff.update", "staff.staff.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(
                tenant=self.tenant, campus=self.campus, email="new.hire@example.test"
            )
            role = Role.objects.create(tenant=self.tenant, slug="test-hr-role", name="HR role")

        response = self.client.post(
            f"/api/v1/staff/{staff.pk}:invite", {"role_ids": [str(role.pk)]}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
            created_user = User.objects.get(pk=staff.user_id)
        self.assertFalse(created_user.is_active)
        self.assertFalse(created_user.has_usable_password())
        self.assertEqual(created_user.email, "new.hire@example.test")
        self.assertTrue(UserRole.objects.filter(user=created_user, role=role).exists())

    def test_invite_puts_a_welcome_notification_in_the_new_accounts_inbox(self) -> None:
        """The half of the `:invite` gap that core.notifications closes.

        In-app only, deliberately: the account is still inactive with an unusable
        password, so an email claiming it is ready would be untrue — see
        `staff/services/invite.py`'s `invite_staff` and `notifications.py`.
        """
        from core.notifications.models import (
            DeliveryLog,
            DeliveryStatus,
            Notification,
            NotificationChannel,
        )

        self.allow("staff.staff.update", "staff.staff.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(
                tenant=self.tenant, campus=self.campus, email="welcome@example.test"
            )

        response = self.client.post(f"/api/v1/staff/{staff.pk}:invite", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
            notification = Notification.objects.get(user_id=staff.user_id)
            channels = set(
                DeliveryLog.objects.filter(notification=notification).values_list(
                    "channel", flat=True
                )
            )
            in_app = DeliveryLog.objects.get(
                notification=notification, channel=NotificationChannel.IN_APP
            )

        self.assertEqual(notification.event_key, "staff.invited")
        self.assertEqual(notification.source_type, "staff")
        self.assertEqual(notification.source_id, staff.pk)
        self.assertIn(staff.first_name, notification.body)
        # No email row at all: the trigger does not declare that channel yet.
        self.assertEqual(channels, {NotificationChannel.IN_APP})
        self.assertEqual(in_app.status, DeliveryStatus.QUEUED)

    def test_a_notification_failure_never_undoes_the_invite(self) -> None:
        """The account and its roles are the actual outcome of `:invite`."""
        from unittest.mock import patch

        self.allow("staff.staff.update", "staff.staff.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, email="ok@example.test")

        with patch(
            "core.notifications.services.notify", side_effect=RuntimeError("template blew up")
        ):
            response = self.client.post(f"/api/v1/staff/{staff.pk}:invite", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
            self.assertIsNotNone(staff.user_id)
            self.assertTrue(User.objects.filter(pk=staff.user_id).exists())

    def test_inviting_an_already_linked_staff_member_is_a_conflict(self) -> None:
        self.allow("staff.staff.update", "staff.staff.view")
        with tenant_context(self.tenant.id):
            linked_user = UserFactory(tenant=self.tenant)
            staff = StaffFactory(
                tenant=self.tenant,
                campus=self.campus,
                email="already@example.test",
                user_id=linked_user.pk,
            )

        response = self.client.post(f"/api/v1/staff/{staff.pk}:invite", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "already_active")

    def test_invite_creates_a_pending_staff_invitation(self) -> None:
        self.allow("staff.staff.update", "staff.staff.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, email="mail@example.test")

        response = self.client.post(f"/api/v1/staff/{staff.pk}:invite", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
            invitation = Invitation.objects.get(user_id=staff.user_id)
        self.assertEqual(invitation.kind, "staff")
        self.assertIsNone(invitation.revoked_at)

    def test_invite_existing_pending_staff_resends_ignoring_role_ids(self) -> None:
        """Covers staff invited before invitations existed: inactive, unusable, no invitation."""
        self.allow("staff.staff.update", "staff.staff.view")
        with tenant_context(self.tenant.id):
            user = invited_user(self.tenant, email="pending@example.test")
            staff = StaffFactory(
                tenant=self.tenant,
                campus=self.campus,
                email="pending@example.test",
                user_id=user.pk,
            )
            role = Role.objects.create(tenant=self.tenant, slug="test-ignored", name="Ignored")

        response = self.client.post(
            f"/api/v1/staff/{staff.pk}:invite", {"role_ids": [str(role.pk)]}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            self.assertEqual(
                Invitation.objects.filter(user=user, revoked_at__isnull=True).count(), 1
            )
        self.assertFalse(UserRole.objects.filter(user=user).exists())
        self.assertEqual(User.objects.filter(tenant=self.tenant, email=user.email).count(), 1)

    def test_staff_invite_on_guardian_email_is_409(self) -> None:
        self.allow("staff.staff.update", "staff.staff.view")
        guardian_account = invited_user(self.tenant, email="family@example.test")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(
                tenant=self.tenant, campus=self.campus, email="Family@example.test"
            )

        response = self.client.post(f"/api/v1/staff/{staff.pk}:invite", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "email_in_use")
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
        self.assertIsNone(staff.user_id)
        self.assertFalse(UserRole.objects.filter(user=guardian_account).exists())
        self.assertEqual(
            User.objects.filter(tenant=self.tenant, email__iexact=staff.email).count(), 1
        )

    def test_rehired_staff_reinvite_assigns_roles(self) -> None:
        """No re-hire endpoint exists yet, so the status is set back directly."""
        self.allow("staff.staff.update", "staff.staff.view", "staff.staff.delete")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, email="back@example.test")
            role = Role.objects.create(tenant=self.tenant, slug="test-rehire", name="Rehire")
        invite_url = f"/api/v1/staff/{staff.pk}:invite"
        self.assertEqual(self.client.post(invite_url, {}, format="json").status_code, 200)
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
            user = User.objects.get(pk=staff.user_id)
        user.set_password("test-password-old-life-123")
        user.is_active = True
        user.save()
        exited = self.client.post(
            f"/api/v1/staff/{staff.pk}:exit",
            {"exit_date": "2026-06-01", "exit_reason": "Resigned."},
            format="json",
        )
        self.assertEqual(exited.status_code, status.HTTP_200_OK, exited.json())
        with tenant_context(self.tenant.id):
            Staff.objects.filter(pk=staff.pk).update(
                employment_status=EmploymentStatus.ACTIVE, exit_date=None, exit_reason=None
            )

        response = self.client.post(invite_url, {"role_ids": [str(role.pk)]}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        self.assertEqual(
            list(UserRole.objects.filter(user=user).values_list("role_id", flat=True)), [role.pk]
        )
        with tenant_context(self.tenant.id):
            self.assertEqual(
                Invitation.objects.filter(
                    user=user, accepted_at__isnull=True, revoked_at__isnull=True
                ).count(),
                1,
            )

    def test_inviting_a_staff_member_with_no_email_is_rejected(self) -> None:
        self.allow("staff.staff.update", "staff.staff.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, email=None)

        response = self.client.post(f"/api/v1/staff/{staff.pk}:invite", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(response.json()["error"]["code"], "domain_rule_violation")

    def test_invite_without_the_permission_is_403(self) -> None:
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, email="x@example.test")

        response = self.client.post(f"/api/v1/staff/{staff.pk}:invite", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class ExitTests(StaffManagementAPITestCase):
    def test_exit_sets_status_date_and_reason(self) -> None:
        self.allow("staff.staff.delete", "staff.staff.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)

        response = self.client.post(
            f"/api/v1/staff/{staff.pk}:exit",
            {"exit_date": "2026-06-01", "exit_reason": "Resigned to relocate."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        data = response.json()["data"]
        self.assertEqual(data["employment_status"], "resigned")
        self.assertEqual(data["exit_date"], "2026-06-01")
        self.assertEqual(data["exit_reason"], "Resigned to relocate.")

    def test_exit_date_before_joining_date_is_rejected(self) -> None:
        self.allow("staff.staff.delete", "staff.staff.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(
                tenant=self.tenant, campus=self.campus, joining_date=DEFAULT_JOINING_DATE
            )

        response = self.client.post(
            f"/api/v1/staff/{staff.pk}:exit",
            {
                "exit_date": str(DEFAULT_JOINING_DATE - datetime.timedelta(days=1)),
                "exit_reason": "Backdated.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(response.json()["error"]["code"], "domain_rule_violation")

    def test_exiting_an_already_exited_staff_member_is_a_conflict(self) -> None:
        self.allow("staff.staff.delete", "staff.staff.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)
        exit_url = f"/api/v1/staff/{staff.pk}:exit"
        payload = {"exit_date": "2026-06-01", "exit_reason": "Resigned."}
        self.client.post(exit_url, payload, format="json")

        second = self.client.post(exit_url, payload, format="json")

        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)

    def test_exit_is_blocked_while_the_sole_class_teacher_of_a_section(self) -> None:
        self.allow("staff.staff.delete", "staff.staff.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)
            school_class = ClassFactory(tenant=self.tenant)
            SectionFactory(
                tenant=self.tenant,
                school_class=school_class,
                campus=self.campus,
                class_teacher_staff_id=staff.pk,
            )

        response = self.client.post(
            f"/api/v1/staff/{staff.pk}:exit",
            {"exit_date": "2026-06-01", "exit_reason": "Resigned."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("Reassign", response.json()["error"]["message"])

    def test_exit_succeeds_when_not_the_class_teacher_of_any_section(self) -> None:
        """Positive control: the block above is about class-teacher assignment, not exit itself."""
        self.allow("staff.staff.delete", "staff.staff.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)
            school_class = ClassFactory(tenant=self.tenant)
            SectionFactory(
                tenant=self.tenant,
                school_class=school_class,
                campus=self.campus,
                class_teacher_staff_id=None,
            )

        response = self.client.post(
            f"/api/v1/staff/{staff.pk}:exit",
            {"exit_date": "2026-06-01", "exit_reason": "Resigned."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_exit_without_the_permission_is_403(self) -> None:
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)

        response = self.client.post(
            f"/api/v1/staff/{staff.pk}:exit",
            {"exit_date": "2026-06-01", "exit_reason": "Resigned."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class ExitRevocationTests(StaffManagementAPITestCase):
    def test_exit_revokes_pending_invitation_and_tokens(self) -> None:
        self.allow("staff.staff.update", "staff.staff.delete", "staff.staff.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(
                tenant=self.tenant, campus=self.campus, email="leaving@example.test"
            )
        self.client.post(f"/api/v1/staff/{staff.pk}:invite", {}, format="json")
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
            user = User.objects.get(pk=staff.user_id)
        # A refresh token from an earlier session, which must not outlive the exit.
        user.is_active = True
        user.save(update_fields=["is_active"])
        jti = RefreshToken.for_user(user)["jti"]

        response = self.client.post(
            f"/api/v1/staff/{staff.pk}:exit",
            {"exit_date": "2026-06-01", "exit_reason": "Resigned."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        with tenant_context(self.tenant.id):
            self.assertFalse(
                Invitation.objects.filter(
                    user=user, accepted_at__isnull=True, revoked_at__isnull=True
                ).exists()
            )
            event = AuditLog.objects.get(action="auth.account.deactivated", resource_id=user.pk)
        self.assertTrue(BlacklistedToken.objects.filter(token__jti=jti).exists())
        self.assertEqual(event.actor_id, self.user.pk)
        self.assertEqual(event.after["kind"], "staff")
        self.assertEqual(event.after["reason"], "exit")

    def test_an_exited_staff_member_is_no_longer_eligible_to_accept(self) -> None:
        with tenant_context(self.tenant.id):
            user = invited_user(self.tenant, email="eligible@example.test")
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, user_id=user.pk)
            self.assertTrue(is_eligible(user, "staff"))
            Staff.objects.filter(pk=staff.pk).update(employment_status=EmploymentStatus.RESIGNED)
            self.assertFalse(is_eligible(user, "staff"))


class StaffLoginLinkTests(StaffManagementAPITestCase):
    def test_staff_patch_ignores_user_id(self) -> None:
        """Only `:invite` links a login; a PATCH could point staff at someone else's."""
        self.allow("staff.staff.update", "staff.staff.view")
        owner = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)

        response = self.client.patch(
            f"/api/v1/staff/{staff.pk}",
            {"user_id": str(owner.pk), "first_name": "Renamed"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertIsNone(response.json()["data"]["user_id"])
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
        self.assertIsNone(staff.user_id)
        self.assertEqual(staff.first_name, "Renamed")

    def test_exit_does_not_deactivate_a_user_linked_to_a_guardian(self) -> None:
        """A link made before `user_id` was read-only must not let `:exit` end a parent's login."""
        self.allow("staff.staff.delete", "staff.staff.view")
        parent = UserFactory(tenant=self.tenant)
        role = grant(parent, "students.student.view", is_restricted_principal=True)
        staff_role = grant(parent, "staff.staff.view")
        with tenant_context(self.tenant.id):
            GuardianFactory(tenant=self.tenant, user_id=parent.pk)
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, user_id=parent.pk)
        jti = RefreshToken.for_user(parent)["jti"]

        response = self.client.post(
            f"/api/v1/staff/{staff.pk}:exit",
            {"exit_date": "2026-06-01", "exit_reason": "Resigned."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        parent.refresh_from_db()
        self.assertTrue(parent.is_active)
        self.assertTrue(UserRole.objects.filter(user=parent, role=role).exists())
        self.assertFalse(
            UserRole.objects.filter(user=parent, role=staff_role).exists(),
            "the staff role must go with the exit",
        )
        self.assertFalse(BlacklistedToken.objects.filter(token__jti=jti).exists())
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
        self.assertIsNone(staff.user_id, "the exited staff row no longer names the login")


class StaffInviteOnPortalLoginTests(StaffManagementAPITestCase):
    def test_staff_invite_on_a_portal_linked_login_is_409(self) -> None:
        """A staff row linked by hand to a guardian's login must not hand it staff roles."""
        self.allow("staff.staff.update", "staff.staff.view")
        parent = invited_user(self.tenant, email="parent-staff@example.test")
        with tenant_context(self.tenant.id):
            GuardianFactory(tenant=self.tenant, user_id=parent.pk)
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, user_id=parent.pk)
            role = Role.objects.create(tenant=self.tenant, slug="test-not-given", name="No")

        response = self.client.post(
            f"/api/v1/staff/{staff.pk}:invite", {"role_ids": [str(role.pk)]}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "email_in_use")
        self.assertFalse(UserRole.objects.filter(user=parent).exists())
        with tenant_context(self.tenant.id):
            self.assertFalse(Invitation.objects.filter(user=parent).exists())


class DenyRestrictedPrincipalsTests(StaffManagementAPITestCase):
    def _grant_every_staff_key_to_a_restricted_role(self) -> None:
        role = Role.objects.create(
            tenant=self.tenant,
            slug="test-restricted",
            name="Restricted",
            is_restricted_principal=True,
        )
        for spec in registry.for_module("staff"):
            permission, _ = Permission.objects.get_or_create(
                key=spec.key,
                defaults={"module": spec.module, "resource": spec.resource, "action": spec.action},
            )
            RolePermission.objects.create(role=role, permission=permission)
        UserRole.objects.create(user=self.user, role=role, tenant=self.tenant)
        evict_rbac_caches([self.user.pk])

    def test_a_restricted_principal_is_denied_every_staff_endpoint_even_with_a_staff_key(
        self,
    ) -> None:
        self._grant_every_staff_key_to_a_restricted_role()
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)

        endpoints = [
            ("get", "/api/v1/staff"),
            ("get", "/api/v1/designations"),
            ("get", f"/api/v1/staff/{staff.pk}/qualifications"),
            ("get", f"/api/v1/staff/{staff.pk}/documents"),
            ("post", "/api/v1/staff-exports"),
        ]
        for method, url in endpoints:
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url)
                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_the_same_permissions_succeed_for_a_non_restricted_role(self) -> None:
        """Positive control: the 403 above is DenyRestrictedPrincipals, not a missing key."""
        self.allow("staff.staff.view")

        response = self.client.get("/api/v1/staff")

        self.assertEqual(response.status_code, status.HTTP_200_OK)


class InviteRoleGrantTests(StaffManagementAPITestCase):
    """`:invite` assigns only roles the inviter could hold: no escalation through role_ids."""

    def invite(self, staff: Staff, role: Role):
        return self.client.post(
            f"/api/v1/staff/{staff.pk}:invite", {"role_ids": [str(role.pk)]}, format="json"
        )

    def assert_nothing_given(self, staff: Staff, role: Role) -> None:
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
            self.assertIsNone(staff.user_id)
            self.assertFalse(Invitation.objects.exists())
        self.assertFalse(UserRole.objects.filter(role=role).exists())
        self.assertFalse(User.objects.filter(tenant=self.tenant, email=staff.email).exists())

    def test_hr_staff_cannot_invite_someone_as_school_admin(self) -> None:
        grant_default_role(self.user, "hr_staff")
        keys = [spec.key for spec in registry.all() if "school_admin" in spec.default_roles]
        school_admin = ensure_role_with_permissions(self.tenant, "school_admin", "Admin", keys)
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, email="hr@example.test")

        response = self.invite(staff, school_admin)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN, response.json())
        self.assertEqual(
            response.json()["error"]["message"],
            "You can't give a role with permissions you don't hold yourself.",
        )
        self.assert_nothing_given(staff, school_admin)

    def test_a_restricted_role_cannot_be_given_through_a_staff_invite(self) -> None:
        self.allow("staff.staff.update", "staff.staff.view")
        restricted = Role.objects.create(
            tenant=self.tenant, slug="test-guardian", name="Guardian", is_restricted_principal=True
        )
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, email="g@example.test")

        response = self.invite(staff, restricted)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN, response.json())
        self.assert_nothing_given(staff, restricted)

    def test_a_role_within_the_inviters_own_keys_is_assigned(self) -> None:
        """Positive control: the 403s above are the escalation check, not the invite itself."""
        self.allow("staff.staff.update", "staff.staff.view")
        narrower = grant(UserFactory(tenant=self.tenant), "staff.staff.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, email="ok@example.test")

        response = self.invite(staff, narrower)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
        self.assertTrue(UserRole.objects.filter(user_id=staff.user_id, role=narrower).exists())

    def test_a_key_held_only_at_campus_scope_cannot_be_granted_school_wide(self) -> None:
        """The new assignment is scope `all`, so the inviter must hold each key at `all`."""
        self.allow("staff.staff.update", "staff.staff.view")
        grant(
            self.user,
            "students.student.view",
            scope=RecordScope.CAMPUS,
            scope_ref=self.campus.pk,
        )
        reader = grant(UserFactory(tenant=self.tenant), "students.student.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, email="c@example.test")

        response = self.invite(staff, reader)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN, response.json())
        self.assertEqual(
            response.json()["error"]["message"],
            "You can't give a role with permissions you don't hold yourself.",
        )
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
        self.assertIsNone(staff.user_id)
        self.assertFalse(User.objects.filter(tenant=self.tenant, email=staff.email).exists())

    def test_the_same_key_held_school_wide_can_be_granted(self) -> None:
        """Positive control for the campus case: only the scope differs."""
        self.allow("staff.staff.update", "staff.staff.view")
        grant(self.user, "students.student.view", scope=RecordScope.ALL)
        reader = grant(UserFactory(tenant=self.tenant), "students.student.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, email="a@example.test")

        response = self.invite(staff, reader)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
        self.assertTrue(UserRole.objects.filter(user_id=staff.user_id, role=reader).exists())

    def test_a_rehire_reinvite_refuses_a_role_beyond_the_inviter(self) -> None:
        """The re-hire branch assigns roles too, so it runs the same check."""
        self.allow("staff.staff.update", "staff.staff.view", "staff.staff.delete")
        wider = grant(UserFactory(tenant=self.tenant), "exams.exam.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, email="re@example.test")
        invite_url = f"/api/v1/staff/{staff.pk}:invite"
        self.assertEqual(self.client.post(invite_url, {}, format="json").status_code, 200)
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
            user = User.objects.get(pk=staff.user_id)
        user.set_password("test-password-old-life-456")
        user.is_active = True
        user.save()
        exited = self.client.post(
            f"/api/v1/staff/{staff.pk}:exit",
            {"exit_date": "2026-06-01", "exit_reason": "Resigned."},
            format="json",
        )
        self.assertEqual(exited.status_code, status.HTTP_200_OK, exited.json())
        with tenant_context(self.tenant.id):
            Staff.objects.filter(pk=staff.pk).update(
                employment_status=EmploymentStatus.ACTIVE, exit_date=None, exit_reason=None
            )

        response = self.invite(staff, wider)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN, response.json())
        self.assertFalse(UserRole.objects.filter(user=user, role=wider).exists())
        with tenant_context(self.tenant.id):
            self.assertFalse(
                Invitation.objects.filter(
                    user=user, accepted_at__isnull=True, revoked_at__isnull=True
                ).exists()
            )


class InviteReaddressTests(StaffManagementAPITestCase):
    """A resend to an account nobody has activated goes to the corrected `Staff.email`."""

    def setUp(self) -> None:
        super().setUp()
        self.allow("staff.staff.update", "staff.staff.view")
        with tenant_context(self.tenant.id):
            self.staff = StaffFactory(
                tenant=self.tenant, campus=self.campus, email="tpyo@example.test"
            )
        first = self.client.post(f"/api/v1/staff/{self.staff.pk}:invite", {}, format="json")
        self.assertEqual(first.status_code, status.HTTP_200_OK, first.json())
        with tenant_context(self.tenant.id):
            self.staff.refresh_from_db()
            self.user = User.objects.get(pk=self.staff.user_id)
            self.first_invitation = Invitation.objects.get(user=self.user)

    def correct_email(self, email: str):
        with tenant_context(self.tenant.id):
            Staff.objects.filter(pk=self.staff.pk).update(email=email)
        return self.client.post(f"/api/v1/staff/{self.staff.pk}:invite", {}, format="json")

    def test_resend_after_correcting_the_email_goes_to_the_new_address(self) -> None:
        response = self.correct_email("typo.fixed@example.test")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "typo.fixed@example.test")
        with tenant_context(self.tenant.id):
            self.first_invitation.refresh_from_db()
            pending = Invitation.objects.get(
                user=self.user, accepted_at__isnull=True, revoked_at__isnull=True
            )
        self.assertIsNotNone(self.first_invitation.revoked_at)
        self.assertNotEqual(pending.pk, self.first_invitation.pk)

    def test_resend_to_an_address_another_account_holds_is_409(self) -> None:
        UserFactory(tenant=self.tenant, email="taken@example.test")

        response = self.correct_email("Taken@example.test")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "email_in_use")
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "tpyo@example.test")
        with tenant_context(self.tenant.id):
            self.first_invitation.refresh_from_db()
        self.assertIsNone(self.first_invitation.revoked_at, "a refused resend changes nothing")


class StaffDeleteEndsAccessTests(StaffManagementAPITestCase):
    """`DELETE /staff/{id}` ends the login exactly as `:exit` does."""

    def test_delete_deactivates_the_login_and_revokes_invitations_and_tokens(self) -> None:
        self.allow("staff.staff.update", "staff.staff.delete", "staff.staff.view")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, email="gone@example.test")
        self.client.post(f"/api/v1/staff/{staff.pk}:invite", {}, format="json")
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
            user = User.objects.get(pk=staff.user_id)
        staff_role = grant(user, "staff.staff.view")
        user.is_active = True
        user.save(update_fields=["is_active"])
        jti = RefreshToken.for_user(user)["jti"]

        response = self.client.delete(f"/api/v1/staff/{staff.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        self.assertFalse(UserRole.objects.filter(user=user, role=staff_role).exists())
        self.assertTrue(BlacklistedToken.objects.filter(token__jti=jti).exists())
        with tenant_context(self.tenant.id):
            self.assertFalse(
                Invitation.objects.filter(
                    user=user, accepted_at__isnull=True, revoked_at__isnull=True
                ).exists()
            )
            self.assertTrue(
                AuditLog.objects.filter(
                    action="auth.account.deactivated", resource_id=user.pk
                ).exists()
            )
            self.assertFalse(is_eligible(user, "staff"))

    def test_delete_keeps_a_shared_guardian_login_active(self) -> None:
        self.allow("staff.staff.delete", "staff.staff.view")
        parent = UserFactory(tenant=self.tenant)
        portal_role = grant(parent, "students.student.view", is_restricted_principal=True)
        staff_role = grant(parent, "staff.staff.view")
        with tenant_context(self.tenant.id):
            GuardianFactory(tenant=self.tenant, user_id=parent.pk)
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, user_id=parent.pk)
        jti = RefreshToken.for_user(parent)["jti"]

        response = self.client.delete(f"/api/v1/staff/{staff.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        parent.refresh_from_db()
        self.assertTrue(parent.is_active)
        self.assertTrue(UserRole.objects.filter(user=parent, role=portal_role).exists())
        self.assertFalse(UserRole.objects.filter(user=parent, role=staff_role).exists())
        self.assertFalse(BlacklistedToken.objects.filter(token__jti=jti).exists())
        with tenant_context(self.tenant.id):
            staff.refresh_from_db()
        self.assertIsNone(staff.user_id)
        self.assertIsNotNone(staff.deleted_at)
