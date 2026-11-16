"""`sync_default_roles`: every default role exists in production, holding its registry keys.

Before it, only `school_owner` ever had a `tenant=None` row outside the dev and e2e seeds, so
a real school's staff could not be given `teacher` or `principal` at all.
"""

from __future__ import annotations

from django.test import TestCase

from core.rbac.models import Permission, PermissionScope, Role, RolePermission
from core.rbac.registry import registry
from core.rbac.roles import ALL_TENANT_ROLES, PLATFORM_ROLES, PORTAL_ROLES
from core.rbac.sync import sync_default_roles


def default_role(slug: str) -> Role:
    return Role.objects.get(tenant=None, slug=slug, deleted_at__isnull=True)


def held(role: Role) -> set[str]:
    return set(role.permissions.values_list("key", flat=True))


class DefaultRoleSyncTests(TestCase):
    def test_post_migrate_created_every_default_role(self) -> None:
        for slug in (*ALL_TENANT_ROLES, *PLATFORM_ROLES):
            with self.subTest(role=slug):
                role = default_role(slug)
                self.assertTrue(role.is_default)
                self.assertEqual(role.is_platform, slug in PLATFORM_ROLES)
                self.assertEqual(role.is_restricted_principal, slug in PORTAL_ROLES)

    def test_sync_default_roles_creates_teacher_with_registry_keys(self) -> None:
        Role.objects.filter(tenant=None, slug="teacher").delete()

        sync_default_roles()

        teacher = default_role("teacher")
        self.assertTrue(teacher.is_default)
        self.assertFalse(teacher.is_platform)
        self.assertTrue(registry.keys_for_role("teacher"))
        self.assertEqual(held(teacher), set(registry.keys_for_role("teacher")))

    def test_school_owner_holds_every_tenant_scope_key(self) -> None:
        Role.objects.filter(tenant=None, slug="school_owner").delete()

        sync_default_roles()

        tenant_keys = Permission.objects.filter(scope=PermissionScope.TENANT)
        self.assertEqual(
            held(default_role("school_owner")), set(tenant_keys.values_list("key", flat=True))
        )

    def test_sync_default_roles_is_additive(self) -> None:
        teacher = default_role("teacher")
        registry_keys = set(registry.keys_for_role("teacher"))
        removed = sorted(registry_keys)[0]
        extra = Permission.objects.filter(scope=PermissionScope.TENANT).exclude(
            key__in=registry_keys
        )[0]
        RolePermission.objects.filter(role=teacher, permission__key=removed).delete()
        RolePermission.objects.create(role=teacher, permission=extra)

        sync_default_roles()
        sync_default_roles()

        self.assertEqual(Role.objects.filter(tenant=None, slug="teacher").count(), 1)
        # A grant an operator added by hand survives; the registry's grant comes back.
        self.assertEqual(held(teacher), registry_keys | {extra.key})
