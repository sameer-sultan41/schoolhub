"""Shared test fixtures for the staff-management module's resource packages.

``StaffManagementAPITestCase`` deliberately does not pre-create a ``Staff``
row — ``staff/tests/``'s own list/ordering tests need the roster to start
empty. Packages nested under a staff member (``staff_qualifications/``,
``staff_documents/``) add their own thin local subclass on top of this one.
"""

from __future__ import annotations

from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.staff_management.tests.factories import enable_feature
from core.tenancy.context import tenant_context


class StaffManagementAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, "module.staff")
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)

    def allow(self, *keys: str) -> None:
        grant(self.user, *keys)


class TenantFixtureMixin:
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
