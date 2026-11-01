"""`user_scopes_for_key` — the scopes of only the live roles that grant one key.

auth-and-rbac.md §2.3 attaches a record scope to a `user_role`, so a role that
does not grant the key, or a role that was removed, must not add its scope.
"""

from __future__ import annotations

import uuid

from django.test import TestCase
from django.utils import timezone

from apps.school_organization.tests.factories import TenantFactory, UserFactory, grant
from core.rbac.models import RecordScope, UserRole
from core.rbac.permissions import user_scopes_for_key

SEND = "communication.broadcast.send"
OTHER = "examinations.exam.view"


class UserScopesForKeyTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        self.campus_a = uuid.uuid4()
        self.campus_b = uuid.uuid4()

    def test_only_roles_that_grant_the_key_count(self) -> None:
        grant(self.user, SEND, scope=RecordScope.CAMPUS, scope_ref=self.campus_a)
        grant(self.user, OTHER, scope=RecordScope.ALL)

        self.assertEqual(
            user_scopes_for_key(self.user, SEND), {RecordScope.CAMPUS: [self.campus_a]}
        )
        self.assertEqual(user_scopes_for_key(self.user, OTHER), {RecordScope.ALL: [None]})

    def test_two_roles_with_the_key_both_count(self) -> None:
        grant(self.user, SEND, scope=RecordScope.CAMPUS, scope_ref=self.campus_a)
        grant(self.user, SEND, OTHER, scope=RecordScope.CAMPUS, scope_ref=self.campus_b)

        scopes = user_scopes_for_key(self.user, SEND)

        self.assertEqual(list(scopes), [RecordScope.CAMPUS])
        self.assertCountEqual(scopes[RecordScope.CAMPUS], [self.campus_a, self.campus_b])

    def test_a_removed_role_does_not_count(self) -> None:
        grant(self.user, SEND, scope=RecordScope.CAMPUS, scope_ref=self.campus_a)
        removed = grant(self.user, SEND, scope=RecordScope.ALL)
        UserRole.objects.filter(user=self.user, role=removed).update(deleted_at=timezone.now())

        self.assertEqual(
            user_scopes_for_key(self.user, SEND), {RecordScope.CAMPUS: [self.campus_a]}
        )

    def test_no_role_with_the_key_is_no_scope(self) -> None:
        grant(self.user, OTHER, scope=RecordScope.ALL)

        self.assertEqual(user_scopes_for_key(self.user, SEND), {})
