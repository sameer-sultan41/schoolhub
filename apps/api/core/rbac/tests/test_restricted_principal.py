"""`is_restricted_principal` and `live_restricted_role_assignments` count live roles only.

A removed assignment (`user_roles.deleted_at` set) grants no keys and no scopes,
so it must not keep making its holder a student or guardian either.
"""

from __future__ import annotations

from django.test import TestCase
from django.utils import timezone

from apps.school_organization.tests.factories import TenantFactory, UserFactory, grant
from core.rbac.models import UserRole
from core.rbac.permissions import is_restricted_principal, live_restricted_role_assignments

GUARDIAN_KEY = "communication.thread.view"


class RestrictedPrincipalTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)

    def remove(self, role) -> None:
        assignment = UserRole.objects.get(user=self.user, role=role)
        assignment.deleted_at = timezone.now()
        assignment.save(update_fields=["deleted_at", "updated_at"])

    def holders(self) -> set:
        return set(live_restricted_role_assignments().values_list("user_id", flat=True))

    def test_a_live_guardian_role_is_restricted(self) -> None:
        grant(self.user, GUARDIAN_KEY, is_restricted_principal=True)

        self.assertTrue(is_restricted_principal(self.user))
        self.assertIn(self.user.pk, self.holders())

    def test_a_removed_guardian_role_is_not_restricted(self) -> None:
        guardian = grant(self.user, GUARDIAN_KEY, is_restricted_principal=True)
        grant(self.user, "communication.thread.close")
        self.remove(guardian)

        self.assertFalse(is_restricted_principal(self.user))
        self.assertNotIn(self.user.pk, self.holders())

    def test_one_live_guardian_role_is_enough_whatever_else_was_removed(self) -> None:
        removed = grant(self.user, GUARDIAN_KEY, is_restricted_principal=True)
        grant(self.user, GUARDIAN_KEY, is_restricted_principal=True)
        self.remove(removed)

        self.assertTrue(is_restricted_principal(self.user))
        self.assertIn(self.user.pk, self.holders())

    def test_a_staff_role_is_not_restricted(self) -> None:
        grant(self.user, "communication.thread.close")

        self.assertFalse(is_restricted_principal(self.user))
        self.assertNotIn(self.user.pk, self.holders())
