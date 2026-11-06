"""Cross-tenant isolation for `GET /parent-portal/dashboard`.

The dashboard takes no id, so a leak would not be a 403 or a 404 but a child from
another school appearing in the list. The second tenant's guardian holds every
portal key with every module on, so an empty answer can only come from tenant
scoping, and a guardian link planted in *this* school naming their user proves
the link table is read through the tenant, not just by `user_id`.
"""

from __future__ import annotations

from apps.fees_finance.tests.factories import FeeInvoiceFactory
from apps.parent_portal.tests.base import GUARDIAN_KEYS, PORTAL_FEATURES, ParentPortalTestCase
from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    grant,
)
from apps.student_management.tests.factories import (
    GuardianFactory,
    StudentFactory,
    StudentGuardianFactory,
    enable_feature,
)
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context


class DashboardCrossTenantTests(ParentPortalTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.other = TenantFactory()
        for key in PORTAL_FEATURES:
            enable_feature(self.other, key)
        self.other_user = UserFactory(tenant=self.other)
        grant(self.other_user, *GUARDIAN_KEYS, scope=RecordScope.OWN, is_restricted_principal=True)
        with tenant_context(self.other.id):
            other_campus = CampusFactory(tenant=self.other)
            self.other_child = StudentFactory(tenant=self.other, campus=other_campus)
            other_guardian = GuardianFactory(tenant=self.other, user_id=self.other_user.pk)
            StudentGuardianFactory(
                tenant=self.other,
                student=self.other_child,
                guardian=other_guardian,
                has_portal_access=True,
            )

        # This school's records, including a guardian row naming the other school's user.
        with tenant_context(self.tenant.id):
            planted = GuardianFactory(tenant=self.tenant, user_id=self.other_user.pk)
            StudentGuardianFactory(
                tenant=self.tenant,
                student=self.students[2],
                guardian=planted,
                has_portal_access=True,
            )
            FeeInvoiceFactory(
                tenant=self.tenant, student=self.students[0], academic_session=self.session
            )

    def test_another_tenants_guardian_sees_none_of_this_tenants_children(self) -> None:
        data = self.dashboard(self.other_user)

        self.assertEqual(self.child_ids(data), [str(self.other_child.pk)])
        own_ids = {str(student.pk) for student in self.students}
        self.assertFalse(own_ids & set(self.child_ids(data)))
        self.assertEqual(data["children"][0]["fees"]["outstanding_count"], 0)

    def test_this_tenants_guardian_sees_none_of_the_other_tenants_children(self) -> None:
        data = self.dashboard(self.guardian_user)

        self.assertNotIn(str(self.other_child.pk), self.child_ids(data))
        self.assertEqual(self.child_ids(data), [str(self.students[0].pk), str(self.students[1].pk)])
