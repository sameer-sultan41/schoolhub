"""Shared setup for the academics API tests.

Builds the minimum structure every academics endpoint needs — a session, a
class, a section, a subject and a curriculum row linking them — because almost
nothing in this module is meaningful without that chain: an allocation requires
the subject to be in the class's curriculum, and a promotion requires an
enrollment in the class.
"""

from __future__ import annotations

from rest_framework.test import APITestCase

from apps.academics.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    ClassSubjectFactory,
    SectionFactory,
    StaffFactory,
    SubjectFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    enable_feature,
    grant,
)
from core.tenancy.context import tenant_context


class AcademicsAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, "module.academics")
        enable_feature(self.tenant, "module.school")

        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant)
            self.next_session = AcademicSessionFactory(tenant=self.tenant)
            self.school_class = ClassFactory(tenant=self.tenant, level=6)
            self.next_class = ClassFactory(tenant=self.tenant, level=7)
            self.section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )
            self.next_section = SectionFactory(
                tenant=self.tenant, school_class=self.next_class, campus=self.campus
            )
            self.subject = SubjectFactory(tenant=self.tenant)
            self.curriculum = ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=self.subject,
            )
            self.teacher = StaffFactory(tenant=self.tenant, campus=self.campus)

    def allow(self, *keys: str) -> None:
        grant(self.user, *keys)
