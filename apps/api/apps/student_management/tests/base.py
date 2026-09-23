"""Shared test fixtures for the student-management module's resource packages.

``StudentManagementAPITestCase`` deliberately does not pre-create a ``Student`` —
``guardians/``'s own tests exercise the guardian person record in isolation. Packages
reachable only nested under a student (``emergency_contacts/``, ``student_guardians/``,
``transfers/``) add their own thin local subclass on top of this one.
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
from apps.student_management.tests.factories import enable_feature
from core.tenancy.context import tenant_context


class StudentManagementAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, "module.students")
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)

    def allow(self, *keys: str) -> None:
        grant(self.user, *keys)
