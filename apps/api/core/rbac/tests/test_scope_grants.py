"""`scope_grants` and `scopes_for`: a record scope reaches only the keys its own role grants.

auth-and-rbac.md §2.3 attaches a record scope to a `user_role`, so a role that does
not grant the key, a removed assignment or a soft-deleted role must not add its scope.
The resolver is cached, so every change to the role graph must evict a warm entry,
both at once and when the transaction commits.
"""

from __future__ import annotations

import uuid

from django.contrib.auth.models import AnonymousUser
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from apps.school_organization.tests.factories import TenantFactory, UserFactory, grant
from core.rbac.models import Permission, RecordScope, Role, RolePermission, UserRole
from core.rbac.permissions import (
    AnyOf,
    effective_permission_keys,
    is_restricted_principal,
    scope_grants,
    scopes_for,
)
from core.rbac.seeding import ensure_role_with_permissions

SEND = "communication.broadcast.send"
OTHER = "exams.exam.view"
THIRD = "students.student.view"


def permission(key: str) -> Permission:
    module, resource, action = key.split(".")
    row, _ = Permission.objects.get_or_create(
        key=key, defaults={"module": module, "resource": resource, "action": action}
    )
    return row


class ScopeGrantsTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        self.campus_a = uuid.uuid4()
        self.campus_b = uuid.uuid4()

    def remove_assignment(self, role: Role) -> None:
        assignment = UserRole.objects.get(user=self.user, role=role)
        assignment.deleted_at = timezone.now()
        assignment.save(update_fields=["deleted_at", "updated_at"])

    def soft_delete(self, role: Role) -> None:
        role.deleted_at = timezone.now()
        role.save(update_fields=["deleted_at", "updated_at"])

    def test_only_roles_that_grant_the_key_count(self) -> None:
        grant(self.user, SEND, scope=RecordScope.CAMPUS, scope_ref=self.campus_a)
        grant(self.user, OTHER, scope=RecordScope.ALL)

        self.assertEqual(scopes_for(self.user, SEND), {RecordScope.CAMPUS: [self.campus_a]})
        self.assertEqual(scopes_for(self.user, OTHER), {RecordScope.ALL: [None]})

    def test_two_roles_with_the_key_both_count(self) -> None:
        grant(self.user, SEND, scope=RecordScope.CAMPUS, scope_ref=self.campus_a)
        grant(self.user, SEND, OTHER, scope=RecordScope.CAMPUS, scope_ref=self.campus_b)

        scopes = scopes_for(self.user, SEND)

        self.assertEqual(list(scopes), [RecordScope.CAMPUS])
        self.assertCountEqual(scopes[RecordScope.CAMPUS], [self.campus_a, self.campus_b])

    def test_any_of_unions_the_roles_of_each_key(self) -> None:
        grant(self.user, SEND, scope=RecordScope.CAMPUS, scope_ref=self.campus_a)
        grant(self.user, OTHER, scope=RecordScope.CAMPUS, scope_ref=self.campus_b)
        grant(self.user, THIRD, scope=RecordScope.ALL)

        for declared in (AnyOf(SEND, OTHER), AnyOf(OTHER, SEND)):
            with self.subTest(keys=declared.keys):
                scopes = scopes_for(self.user, declared)
                # THIRD's `all` role grants neither key, so it must not widen the union.
                self.assertEqual(list(scopes), [RecordScope.CAMPUS])
                self.assertCountEqual(scopes[RecordScope.CAMPUS], [self.campus_a, self.campus_b])

    def test_no_role_with_the_key_is_no_scope(self) -> None:
        grant(self.user, OTHER, scope=RecordScope.ALL)

        self.assertEqual(scopes_for(self.user, SEND), {})
        self.assertEqual(scopes_for(self.user, AnyOf(SEND, THIRD)), {})

    def test_removed_assignment_does_not_count(self) -> None:
        grant(self.user, SEND, scope=RecordScope.CAMPUS, scope_ref=self.campus_a)
        wide = grant(self.user, SEND, OTHER, scope=RecordScope.ALL)
        self.assertIn(RecordScope.ALL, scopes_for(self.user, SEND))  # warm the cache

        self.remove_assignment(wide)

        self.assertEqual(scopes_for(self.user, SEND), {RecordScope.CAMPUS: [self.campus_a]})
        self.assertEqual(scopes_for(self.user, OTHER), {})
        self.assertEqual(effective_permission_keys(self.user), frozenset({SEND}))

    def test_role_soft_delete_evicts_warm_cache(self) -> None:
        grant(self.user, SEND, scope=RecordScope.CAMPUS, scope_ref=self.campus_a)
        guardian = grant(self.user, OTHER, scope=RecordScope.ALL, is_restricted_principal=True)
        # Warm every reader first, so the drop below can only come from eviction.
        self.assertIn(OTHER, effective_permission_keys(self.user))
        self.assertEqual(scopes_for(self.user, OTHER), {RecordScope.ALL: [None]})
        self.assertTrue(is_restricted_principal(self.user))

        self.soft_delete(guardian)

        self.assertEqual(effective_permission_keys(self.user), frozenset({SEND}))
        self.assertEqual(scopes_for(self.user, OTHER), {})
        self.assertFalse(is_restricted_principal(self.user))
        self.assertEqual(scopes_for(self.user, SEND), {RecordScope.CAMPUS: [self.campus_a]})

    def test_role_permission_change_evicts_scope_grants(self) -> None:
        role = grant(self.user, SEND, scope=RecordScope.CAMPUS, scope_ref=self.campus_a)
        # Warm the cache.
        self.assertEqual(scope_grants(self.user), {SEND: {RecordScope.CAMPUS: (self.campus_a,)}})

        role.permissions.add(permission(OTHER))  # m2m_changed
        self.assertEqual(
            scope_grants(self.user),
            {
                SEND: {RecordScope.CAMPUS: (self.campus_a,)},
                OTHER: {RecordScope.CAMPUS: (self.campus_a,)},
            },
        )

        RolePermission.objects.get(role=role, permission__key=SEND).delete()  # post_delete
        self.assertEqual(scope_grants(self.user), {OTHER: {RecordScope.CAMPUS: (self.campus_a,)}})

    def test_seeding_a_role_evicts_its_holders(self) -> None:
        # `bulk_create` sends no post_save, so the seed helper must evict by itself.
        permission(SEND)
        permission(OTHER)
        role = ensure_role_with_permissions(self.tenant, "seeded", "Seeded", [SEND])
        UserRole.objects.create(user=self.user, role=role, tenant=self.tenant)
        self.assertEqual(effective_permission_keys(self.user), frozenset({SEND}))  # warm

        ensure_role_with_permissions(self.tenant, "seeded", "Seeded", [SEND, OTHER])

        self.assertEqual(effective_permission_keys(self.user), frozenset({SEND, OTHER}))

    def test_eviction_also_runs_on_commit(self) -> None:
        role = grant(self.user, SEND, scope=RecordScope.ALL)
        stale = scope_grants(self.user)
        cache_key = f"scope-grants:{self.user.pk}"

        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            self.soft_delete(role)
            # A concurrent request read the rows before this commit and cached them again.
            cache.set(cache_key, stale)
            self.assertEqual(scope_grants(self.user), stale)

        self.assertTrue(callbacks)
        self.assertIsNone(cache.get(cache_key))
        self.assertEqual(scope_grants(self.user), {})

    def test_scope_grants_is_one_query_then_cached(self) -> None:
        grant(self.user, SEND, OTHER, scope=RecordScope.CAMPUS, scope_ref=self.campus_a)
        grant(self.user, THIRD, scope=RecordScope.ALL)

        with self.assertNumQueries(1):
            grants = scope_grants(self.user)
        with self.assertNumQueries(0):
            self.assertEqual(scope_grants(self.user), grants)
            self.assertEqual(effective_permission_keys(self.user), frozenset({SEND, OTHER, THIRD}))
            scopes_for(self.user, AnyOf(SEND, THIRD))

    def test_effective_permission_keys_is_the_grants_key_set(self) -> None:
        grant(self.user, SEND, scope=RecordScope.CAMPUS, scope_ref=self.campus_a)
        grant(self.user)  # a role with no permissions joins to a NULL key
        removed = grant(self.user, THIRD)
        self.remove_assignment(removed)

        keys = effective_permission_keys(self.user)

        self.assertEqual(keys, frozenset({SEND}))
        # One cache entry: the keys were read from it, so the grants cost no query.
        with self.assertNumQueries(0):
            self.assertEqual(keys, frozenset(scope_grants(self.user)))

    def test_an_anonymous_user_has_no_grants(self) -> None:
        anonymous = AnonymousUser()

        self.assertEqual(scope_grants(anonymous), {})
        self.assertEqual(effective_permission_keys(anonymous), frozenset())
        self.assertEqual(scopes_for(anonymous, SEND), {})
