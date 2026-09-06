"""Shared setup for the attendance tests.

Builds the minimum structure an attendance row is meaningful inside: a *current*
session, a class, a section whose class teacher is a real active teaching `Staff`
row linked to a real user, three students enrolled in that section, and four
periods.

**The class teacher is not scenery.** `StudentAttendance.filter_assigned_to_user`
resolves `section.class_teacher_staff_id -> staff.user_id`, and §11 requires the
marker to hold `assigned` scope for the section unless they are `all`-scoped. A
fixture without that link would make every scope test pass or fail for a reason
unrelated to the rule it names.

The session is `is_current=True` because marking falls back to the current
session when the caller names none, and there would otherwise be nothing to fall
back to — the same reason timetable/tests/base.py gives.
"""

from __future__ import annotations

from rest_framework.test import APITestCase

from apps.attendance.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    PeriodFactory,
    SectionFactory,
    StaffFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    enable_feature,
)
from core.tenancy.context import tenant_context


class AttendanceAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, "module.attendance")

        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant, is_current=True)
            self.school_class = ClassFactory(tenant=self.tenant, level=6)

            # The class teacher, and the user they sign in as. Two users, not
            # one: `self.user` is the all-scoped caller most tests act as, and a
            # scope test that reused it could not tell "assigned" from "all".
            self.teacher_user = UserFactory(tenant=self.tenant)
            self.teacher = StaffFactory(
                tenant=self.tenant, campus=self.campus, user_id=self.teacher_user.pk
            )

            self.section = SectionFactory(
                tenant=self.tenant,
                school_class=self.school_class,
                campus=self.campus,
                class_teacher_staff_id=self.teacher.pk,
            )
            self.other_section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )

            self.students = [
                StudentFactory(tenant=self.tenant, campus=self.campus) for _ in range(3)
            ]
            for student in self.students:
                StudentEnrollmentFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=self.session,
                    school_class=self.school_class,
                    section=self.section,
                )

            self.periods = [
                PeriodFactory(tenant=self.tenant, sequence=sequence) for sequence in range(1, 5)
            ]
            self.period = self.periods[0]
