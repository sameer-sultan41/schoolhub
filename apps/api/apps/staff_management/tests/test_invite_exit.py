"""Tests for the :invite and :exit colon-actions, plus ``DenyRestrictedPrincipals``

— this module's first real consumer (views.py's module docstring: previously
zero call sites anywhere in the codebase).
"""

from __future__ import annotations

import datetime

from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import (
    CampusFactory,
    ClassFactory,
    SectionFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.staff_management.tests.factories import DEFAULT_JOINING_DATE, StaffFactory, enable_feature
from core.rbac.models import Permission, Role, RolePermission, User, UserRole
from core.rbac.registry import registry
from core.tenancy.context import tenant_context


class StaffManagementAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, "module.staff")
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)

    def allow(self, *keys: str) -> None:
        grant(self.user, *keys)


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
        `services.invite_staff` and `notifications.py`.
        """
        from core.notifications.models import (
            DeliveryLog,
            DeliveryStatus,
            Notification,
            NotificationChannel,
        )

        self.allow("staff.staff.update")
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

        self.allow("staff.staff.update")
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
        self.allow("staff.staff.update")
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

    def test_inviting_a_staff_member_with_no_email_is_rejected(self) -> None:
        self.allow("staff.staff.update")
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
        self.allow("staff.staff.delete")
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
        self.allow("staff.staff.delete")
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)
        exit_url = f"/api/v1/staff/{staff.pk}:exit"
        payload = {"exit_date": "2026-06-01", "exit_reason": "Resigned."}
        self.client.post(exit_url, payload, format="json")

        second = self.client.post(exit_url, payload, format="json")

        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)

    def test_exit_is_blocked_while_the_sole_class_teacher_of_a_section(self) -> None:
        self.allow("staff.staff.delete")
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
        self.allow("staff.staff.delete")
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
        cache.delete(f"perm-keys:{self.user.pk}")

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
