"""`scope_queryset`'s two campus mechanisms, and the one combination of them that
cannot mean anything.

A model may narrow by a single `campus_field`, or it may define `filter_by_campus`
when one column cannot express the relationship — `StudentTransfer` does, because a
transfer names a `from_campus` and a `to_campus` and is visible from both ends.
The hook therefore owns the whole campus predicate.

`campus_allows_null` widens the *field* path to include NULL, for the columns where
NULL means "every campus". It has nowhere to apply inside a hook, and the way that
combination used to fail is the failure this whole area exists to prevent: the flag
would be silently ignored and the caller would get the narrow result back, short by
exactly the rows they asked to keep. Lives here rather than under a module's own
tests because it is core.rbac behaviour demonstrated with a module's model.
"""

from __future__ import annotations

from django.core.exceptions import ImproperlyConfigured
from django.test import TestCase

from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    grant,
)
from apps.student_management.models import StudentTransfer
from core.rbac.models import RecordScope
from core.rbac.permissions import scope_queryset
from core.tenancy.context import tenant_context


class CampusScopeConfigurationTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
        self.user = UserFactory(tenant=self.tenant)
        grant(
            self.user,
            "students.transfer.create",
            scope=RecordScope.CAMPUS,
            scope_ref=self.campus.pk,
        )

    def test_the_per_model_hook_alone_still_scopes(self) -> None:
        """The control: nothing about the guard below changes the normal path."""
        with tenant_context(self.tenant.id):
            scoped = scope_queryset(StudentTransfer.all_tenants.all(), self.user)

        self.assertIn("from_campus_id", str(scoped.query))
        self.assertIn("to_campus_id", str(scoped.query))

    def test_asking_for_both_the_hook_and_null_widening_raises(self) -> None:
        """Loud, because the alternative is silent.

        `filter_by_campus` returns before the NULL widening is reached, so a model
        that set both would quietly lose the shared rows it just declared it wanted —
        no error, no 500, just a list that is short in production.
        """
        with (
            tenant_context(self.tenant.id),
            self.assertRaises(ImproperlyConfigured) as raised,
        ):
            scope_queryset(
                StudentTransfer.all_tenants.all(),
                self.user,
                campus_allows_null=True,
            )

        self.assertIn("filter_by_campus", str(raised.exception))
