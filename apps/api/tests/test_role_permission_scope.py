"""No role holds a permission of the other scope (ADR-0036).

The console keys share the `platform` module name with tenant-side infrastructure keys
(`platform.file.view`, `platform.job.view`, `platform.notification.view`), so a grant path that
reads keys by name alone could hand a school a console key. Every grant path filters on
`Permission.scope`; this scans every row those paths write, whichever path wrote it.
"""

from __future__ import annotations

from django.test import TestCase

from core.rbac.models import PermissionScope, RolePermission
from core.rbac.registry import registry
from core.rbac.roles import PLATFORM_ROLES
from core.rbac.seeding import ensure_school_owner_role
from core.rbac.sync import sync_default_roles


class RolePermissionScopeContractTests(TestCase):
    def test_no_role_permission_crosses_scope(self) -> None:
        ensure_school_owner_role()
        sync_default_roles()

        rows = RolePermission.objects.select_related("role", "permission")
        self.assertTrue(rows.filter(role__is_platform=True).exists())
        crossing = sorted(
            f"{row.role.slug} -> {row.permission.key}"
            for row in rows
            if row.permission.scope
            != (PermissionScope.PLATFORM if row.role.is_platform else PermissionScope.TENANT)
        )
        self.assertEqual(crossing, [])

    def test_every_default_role_names_a_role_of_its_key_s_scope(self) -> None:
        for spec in registry.all():
            for role in spec.default_roles:
                expected = (
                    PermissionScope.PLATFORM if role in PLATFORM_ROLES else PermissionScope.TENANT
                )
                with self.subTest(key=spec.key, role=role):
                    self.assertEqual(spec.scope, expected)
