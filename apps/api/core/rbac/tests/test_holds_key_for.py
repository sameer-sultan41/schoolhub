"""`holds_key_for`: a privilege key must reach the row, not merely be held somewhere.

A presence check ("is the key held at all") read a key held on campus A as held
for a campus-B row. These pin the one-row check against the key's own scope.
"""

from __future__ import annotations

from django.test import SimpleTestCase, TestCase

from apps.school_organization.tests.factories import (
    CampusFactory,
    ClassFactory,
    SectionFactory,
    TenantFactory,
    UserFactory,
    grant,
)
from core.api.viewsets import TenantScopedViewSetMixin
from core.rbac.models import RecordScope
from core.rbac.permissions import holds_key_for
from core.tenancy.context import tenant_context

KEY = "students.student.update"
# A key the check does not ask about: the unrelated `all` role a mixed user holds.
UNRELATED = "students.enrollment.enroll"


class HoldsKeyForTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.campus_a = CampusFactory(tenant=self.tenant)
            self.campus_b = CampusFactory(tenant=self.tenant)
            school_class = ClassFactory(tenant=self.tenant)
            self.row_a = SectionFactory(
                tenant=self.tenant, school_class=school_class, campus=self.campus_a
            )
            self.row_b = SectionFactory(
                tenant=self.tenant, school_class=school_class, campus=self.campus_b
            )

    def holds(self, row) -> bool:
        with tenant_context(self.tenant.id):
            return holds_key_for(self.user, KEY, row)

    def test_a_key_held_at_all_reaches_every_row(self) -> None:
        grant(self.user, KEY, scope=RecordScope.ALL)

        self.assertTrue(self.holds(self.row_a))
        self.assertTrue(self.holds(self.row_b))

    def test_a_campus_scope_reaches_a_row_on_that_campus(self) -> None:
        grant(self.user, KEY, scope=RecordScope.CAMPUS, scope_ref=self.campus_a.pk)

        self.assertTrue(self.holds(self.row_a))

    def test_a_campus_scope_does_not_reach_another_campus(self) -> None:
        grant(self.user, KEY, scope=RecordScope.CAMPUS, scope_ref=self.campus_a.pk)

        self.assertFalse(self.holds(self.row_b))

    def test_a_key_not_held_gives_false(self) -> None:
        grant(self.user, UNRELATED, scope=RecordScope.ALL)

        self.assertFalse(self.holds(self.row_a))

    def test_an_unrelated_all_role_does_not_widen_a_campus_grant(self) -> None:
        """The mixed user: the key on campus A, another key at `all`."""
        grant(self.user, KEY, scope=RecordScope.CAMPUS, scope_ref=self.campus_a.pk)
        grant(self.user, UNRELATED, scope=RecordScope.ALL)

        self.assertTrue(self.holds(self.row_a))
        self.assertFalse(self.holds(self.row_b))

    def test_a_row_of_another_tenant_gives_false(self) -> None:
        """Even an `all` grant: the tenant-scoped manager never finds the other tenant's row."""
        grant(self.user, KEY, scope=RecordScope.ALL)
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            other_campus = CampusFactory(tenant=other_tenant)
            foreign_row = SectionFactory(
                tenant=other_tenant,
                school_class=ClassFactory(tenant=other_tenant),
                campus=other_campus,
            )

        self.assertFalse(self.holds(foreign_row))

    def test_no_tenant_bound_gives_false(self) -> None:
        grant(self.user, KEY, scope=RecordScope.ALL)
        # Warm the grants cache inside the tenant, so the False below comes from the
        # row lookup finding nothing, not from an empty grant set.
        self.assertTrue(self.holds(self.row_a))

        self.assertFalse(holds_key_for(self.user, KEY, self.row_a))


class ScopeKwargsTests(SimpleTestCase):
    def test_scope_kwargs_reads_the_subclass_settings(self) -> None:
        class Viewset(TenantScopedViewSetMixin):
            scope_own_field = "user_id"
            scope_campus_field = None
            scope_campus_allows_null = True

        self.assertEqual(
            Viewset.scope_kwargs(),
            {"own_field": "user_id", "campus_field": None, "campus_allows_null": True},
        )

    def test_scope_kwargs_defaults_are_the_mixins(self) -> None:
        self.assertEqual(
            TenantScopedViewSetMixin.scope_kwargs(),
            {"own_field": None, "campus_field": "campus_id", "campus_allows_null": False},
        )
