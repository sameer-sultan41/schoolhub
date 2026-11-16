"""`holders_of_permission`: who in *this* school holds a key.

`users`, `roles` and `user_roles` have no RLS, and default roles are shared by
every tenant, so the helper's own tenant filter is the only thing keeping an
approver notice inside one school.
"""

from __future__ import annotations

import uuid

from django.test import TestCase
from django.utils import timezone

from apps.school_organization.tests.factories import TenantFactory, UserFactory, grant
from core.rbac.cache import evict_rbac_caches
from core.rbac.models import Permission, Role, RolePermission, UserRole
from core.rbac.permissions import holders_of_permission

KEY = "attendance.leave-request.approve"
OTHER_KEY = "attendance.leave-request.view"


def shared_default_role(key: str) -> Role:
    """A platform `tenant=None` role holding ``key``, as seeded defaults are."""
    role = Role.objects.create(
        tenant=None, slug=f"shared-{uuid.uuid4().hex[:8]}", name="Shared", is_default=True
    )
    module, resource, action = key.split(".")
    permission, _ = Permission.objects.get_or_create(
        key=key, defaults={"module": module, "resource": resource, "action": action}
    )
    RolePermission.objects.create(role=role, permission=permission)
    return role


class HoldersOfPermissionTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.other = TenantFactory()

    def holders(self, tenant=None) -> set:
        tenant = tenant or self.tenant
        return set(holders_of_permission(KEY, tenant_id=tenant.id).values_list("pk", flat=True))

    def test_a_holder_in_another_school_is_not_returned(self) -> None:
        mine = UserFactory(tenant=self.tenant)
        theirs = UserFactory(tenant=self.other)
        grant(mine, KEY)
        grant(theirs, KEY)

        self.assertEqual(self.holders(), {mine.pk})
        self.assertEqual(self.holders(self.other), {theirs.pk})

    def test_a_shared_default_role_answers_per_school(self) -> None:
        role = shared_default_role(KEY)
        mine = UserFactory(tenant=self.tenant)
        theirs = UserFactory(tenant=self.other)
        for user in (mine, theirs):
            UserRole.objects.create(user=user, role=role, tenant=user.tenant)
        evict_rbac_caches([mine.pk, theirs.pk])

        self.assertEqual(self.holders(), {mine.pk})
        self.assertEqual(self.holders(self.other), {theirs.pk})

    def test_no_tenant_returns_nobody_not_platform_users(self) -> None:
        platform_user = UserFactory(tenant=None, is_platform=True)
        grant(platform_user, KEY)

        self.assertFalse(holders_of_permission(KEY, tenant_id=None).exists())

    def test_a_holder_of_another_key_is_not_returned(self) -> None:
        grant(UserFactory(tenant=self.tenant), OTHER_KEY)

        self.assertEqual(self.holders(), set())

    def test_inactive_and_deleted_users_are_not_returned(self) -> None:
        inactive = UserFactory(tenant=self.tenant, is_active=False)
        deleted = UserFactory(tenant=self.tenant, deleted_at=timezone.now())
        grant(inactive, KEY)
        grant(deleted, KEY)

        self.assertEqual(self.holders(), set())

    def test_a_removed_assignment_or_deleted_role_grants_nothing(self) -> None:
        removed = UserFactory(tenant=self.tenant)
        orphaned = UserFactory(tenant=self.tenant)
        grant(removed, KEY)
        role = grant(orphaned, KEY)
        UserRole.objects.filter(user=removed).update(deleted_at=timezone.now())
        Role.objects.filter(pk=role.pk).update(deleted_at=timezone.now())

        self.assertEqual(self.holders(), set())

    def test_a_user_holding_the_key_through_two_roles_is_returned_once(self) -> None:
        user = UserFactory(tenant=self.tenant)
        grant(user, KEY)
        grant(user, KEY)

        holders = holders_of_permission(KEY, tenant_id=self.tenant.id)

        self.assertEqual(list(holders.values_list("pk", flat=True)), [user.pk])
