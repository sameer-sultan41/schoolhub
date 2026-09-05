"""Proof that PostgreSQL Row-Level Security actually blocks a query.

`test_rls_coverage.py` already asserts that every tenant-owned table *has* a
policy, is RLS-enabled and is FORCEd. That is a catalogue check: it inspects
`pg_class` and `pg_policies`. It says nothing about whether the policy binds to
the role the tests connect as — and for a long time it did not, because CI
connected as the postgres image's `POSTGRES_USER`, which is a superuser.
Superusers bypass RLS even with FORCE, so every cross-tenant assertion in the
suite was passing on `TenantScopedManager` — the Python layer — alone, while
`07-quality/testing-strategy.md` §1.4 claimed the opposite:

    the backend test database has RLS enabled with the non-bypass app role,
    so isolation tests exercise the real mechanism, not a mock

This file is what makes that sentence true. It deliberately reaches past the
Python layer — `all_tenants` is the manager that does *no* tenant filtering — so
the only thing that can return zero rows is the database.

`infra/postgres/init/02-app-role.sql` states the three conditions RLS needs: the
role must not be a superuser, must not hold BYPASSRLS, and must not own the
table. CI satisfies the first two; it cannot satisfy the third, because Django's
test runner creates and migrates the test database over the connection it then
tests on. FORCE ROW LEVEL SECURITY is precisely the mitigation for that, and
`test_the_connecting_role_cannot_bypass_rls` below is what stops the first two
silently regressing.
"""

from __future__ import annotations

from django.db import connection
from django.test import TestCase

from apps.school_organization.models import Campus
from apps.school_organization.tests.factories import CampusFactory, TenantFactory
from core.tenancy.context import set_database_tenant, tenant_context


class ConnectingRoleTests(TestCase):
    """The preconditions. These fail loudly rather than letting the suite lie."""

    def test_the_connecting_role_cannot_bypass_rls(self) -> None:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
            )
            is_superuser, can_bypass = cursor.fetchone()

        self.assertFalse(
            is_superuser,
            "The test role is a SUPERUSER, so RLS is bypassed and every "
            "cross-tenant assertion in this suite is vacuous. See "
            ".github/workflows/api.yml's 'Create the non-superuser application role'.",
        )
        self.assertFalse(
            can_bypass,
            "The test role holds BYPASSRLS, so RLS is bypassed. See "
            "infra/postgres/init/02-app-role.sql.",
        )

    def test_tenant_owned_tables_force_rls_for_their_owner(self) -> None:
        """FORCE is what covers the one condition CI cannot satisfy.

        The test role owns the tables it migrated, so without FORCE the policy
        would not apply to it and the assertions below would pass for no reason.
        """
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT relrowsecurity, relforcerowsecurity "
                "FROM pg_class WHERE relname = 'campuses'"
            )
            enabled, forced = cursor.fetchone()

        self.assertTrue(enabled, "RLS is not enabled on campuses")
        self.assertTrue(forced, "RLS is not FORCEd on campuses, so the owner bypasses it")


class RowLevelSecurityTests(TestCase):
    """The guarantee itself, asserted through the *unfiltered* manager.

    `all_tenants` applies no tenant predicate of its own, so anything it fails to
    return was filtered by PostgreSQL and nothing else.
    """

    def setUp(self) -> None:
        super().setUp()
        self.first = TenantFactory()
        self.second = TenantFactory()
        with tenant_context(self.first.id):
            self.first_campus = CampusFactory(tenant=self.first)
        with tenant_context(self.second.id):
            self.second_campus = CampusFactory(tenant=self.second)

    def test_an_unbound_query_sees_no_rows_at_all(self) -> None:
        """The failure mode a maintenance job must never have.

        An unbound cross-tenant delete does not raise — it reports affecting zero
        rows and looks like it worked. `core/tenancy/maintenance.py` sweeps
        tenant by tenant precisely because of this.
        """
        set_database_tenant(None)

        self.assertEqual(Campus.all_tenants.count(), 0)

    def test_a_bound_query_sees_only_that_tenants_rows(self) -> None:
        with tenant_context(self.first.id):
            visible = set(Campus.all_tenants.values_list("pk", flat=True))

        self.assertEqual(visible, {self.first_campus.pk})
        self.assertNotIn(self.second_campus.pk, visible)

    def test_another_tenants_row_is_invisible_even_when_named_directly(self) -> None:
        """A known primary key is not a way around the policy."""
        with tenant_context(self.first.id):
            found = Campus.all_tenants.filter(pk=self.second_campus.pk).exists()

        self.assertFalse(found)

    def test_a_write_into_another_tenant_is_rejected(self) -> None:
        """The policy's WITH CHECK half.

        Reading is only one direction: without WITH CHECK a bound session could
        still *insert* rows carrying someone else's tenant_id.
        """
        from django.db import InternalError, ProgrammingError, transaction

        with (
            tenant_context(self.first.id),
            self.assertRaises((InternalError, ProgrammingError)),
            transaction.atomic(),
        ):
            Campus.all_tenants.create(
                tenant=self.second,
                name="Smuggled",
                code="SMUG",
            )
