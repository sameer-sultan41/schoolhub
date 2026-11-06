"""A school with three enrolled students, a guardian of the first two, and every portal module on.

The guardian holds exactly the keys a seeded guardian role reads the dashboard
under, at scope `own`, on a restricted-principal role, so a card that appears is
one the real role would see. Every module the summary reads is switched on, so a
null card in a test can only come from what that test changed.

`today` is pinned (`TODAY`) by patching `Tenant.local_date`: the attendance card
reads the current month, and a fixture relative to the real date would change
which days fall inside it on the first of a month.
"""

from __future__ import annotations

import datetime
from unittest import mock

from rest_framework.test import APITestCase

from apps.examinations.tests.factories import ExamFactory, complete_scale
from apps.school_organization.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    SectionFactory,
    TenantFactory,
    TermFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.student_management.models import Guardian
from apps.student_management.tests.factories import (
    GuardianFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
    enable_feature,
)
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant

URL = "/api/v1/parent-portal/dashboard"
TODAY = datetime.date(2026, 10, 15)

PORTAL_FEATURES = (
    "module.parent_portal",
    "module.attendance",
    "module.fees_finance",
    "module.examinations",
    "module.communication",
    "module.timetable",
)

# The dashboard key, the children's key, and each card's own module key.
GUARDIAN_KEYS = (
    "parent-portal.dashboard.view",
    "students.student.view",
    "attendance.student-attendance.view",
    "fees.invoice.view",
    "exams.result.view",
    "communication.thread.view",
    "timetable.timetable.view",
)


class ParentPortalTestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        patcher = mock.patch.object(Tenant, "local_date", return_value=TODAY)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.tenant = TenantFactory()
        for key in PORTAL_FEATURES:
            enable_feature(self.tenant, key)

        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant, is_current=True)
            self.term = TermFactory(tenant=self.tenant, academic_session=self.session, sequence=1)
            self.school_class = ClassFactory(tenant=self.tenant, name="Grade 8", level=8)
            self.section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus, name="A"
            )
            # Named so the first-name order is the creation order.
            self.students = [
                StudentFactory(tenant=self.tenant, campus=self.campus, first_name=name)
                for name in ("Ayesha", "Bilal", "Carol")
            ]
            for student in self.students:
                StudentEnrollmentFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=self.session,
                    school_class=self.school_class,
                    section=self.section,
                )
            self.scale = complete_scale(self.tenant, is_default=True)

        self.guardian_user = self.make_guardian(self.students[0], self.students[1])
        authenticate(self.client, self.guardian_user)

    # ---------------------------------------------------------------- helpers

    def make_guardian(self, *students, keys=GUARDIAN_KEYS, has_portal_access=True):
        """A guardian user linked to ``students``, holding ``keys`` at scope `own`."""
        user = UserFactory(tenant=self.tenant)
        grant(user, *keys, scope=RecordScope.OWN, is_restricted_principal=True)
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant, user_id=user.pk)
            for student in students:
                StudentGuardianFactory(
                    tenant=self.tenant,
                    student=student,
                    guardian=guardian,
                    has_portal_access=has_portal_access,
                )
        return user

    def link(self, user, student, *, has_portal_access=True):
        """Link one more child to ``user``'s guardian row (one per user per school)."""
        with tenant_context(self.tenant.id):
            guardian = Guardian.objects.alive().filter(user_id=user.pk).first()
            if guardian is None:
                guardian = GuardianFactory(tenant=self.tenant, user_id=user.pk)
            return StudentGuardianFactory(
                tenant=self.tenant,
                student=student,
                guardian=guardian,
                has_portal_access=has_portal_access,
            )

    def exam(self, **fields):
        with tenant_context(self.tenant.id):
            return ExamFactory(
                tenant=self.tenant,
                academic_session=self.session,
                term=self.term,
                grading_scale=self.scale,
                **fields,
            )

    def dashboard(self, user=None) -> dict:
        if user is not None:
            authenticate(self.client, user)
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200, response.json())
        return response.json()["data"]

    def child_ids(self, data) -> list[str]:
        return [child["student"]["id"] for child in data["children"]]
