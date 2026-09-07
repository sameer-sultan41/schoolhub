"""Shared setup for the examinations tests.

Builds the minimum structure an exam is meaningful inside: a **current** session
with a term, a class with a subject in its curriculum, a section whose class
teacher is a real active teaching `Staff` row linked to a real user, three
students enrolled in that section, a second teacher *allocated* to the
class-subject, and a complete grading scale.

Two parts of that are load-bearing rather than scenery:

- **The teacher allocation.** §4 gives `exams.marks.create` the record scope
  `assigned`, and `academics.TeacherSubjectAllocation` is the table that answers
  it — its own model docstring says it exists for "timetable (scheduling input)
  and examinations (marks-entry rights)". A fixture without one would make every
  marks-scope test pass for a reason unrelated to the rule it names.
- **The complete grading scale.** §11 requires bands to cover 0-100% with no
  gap, and an exam may not reference a scale that does not. A fixture with an
  ad-hoc scale would fail on the scale rather than on what a test asserts, so
  `complete_scale` builds one and everything starts from it.

The session is `is_current=True` for the reason timetable's and attendance's
fixtures give: services fall back to the current session when a caller names
none, and there would otherwise be nothing to fall back to.
"""

from __future__ import annotations

from rest_framework.test import APITestCase

from apps.examinations.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    ClassSubjectFactory,
    SectionFactory,
    StaffFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    SubjectFactory,
    TeacherAllocationFactory,
    TenantFactory,
    TermFactory,
    UserFactory,
    authenticate,
    complete_scale,
    enable_feature,
    grant,
)
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

FEATURE = "module.examinations"

# Every key this module registers, so a denial in a test can only have come from
# the thing that test is about. A cross-tenant test that passed because a
# permission was missing would prove nothing about tenant scoping — the failure
# mode timetable/tests/test_cross_tenant.py's own header names.
ALL_KEYS = (
    "exams.exam.view",
    "exams.exam.create",
    "exams.exam.update",
    "exams.exam.delete",
    "exams.grading-scale.view",
    "exams.grading-scale.create",
    "exams.grading-scale.update",
)


class ExaminationsAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, FEATURE)

        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant, is_current=True)
            self.term = TermFactory(tenant=self.tenant, academic_session=self.session, sequence=1)
            self.school_class = ClassFactory(tenant=self.tenant, level=8)
            self.subject = SubjectFactory(tenant=self.tenant)
            # The curriculum row. `exam_subjects` refuses a subject that is not
            # in the class's curriculum for the session, mirroring
            # `academics.services.assert_subject_in_class_curriculum` — so
            # without this the setup tests would bounce off that rule instead of
            # exercising the exam configuration they are about.
            ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=self.subject,
            )

            # The class teacher, and the user they sign in as. A separate user
            # from `self.user`: that one is the all-scoped caller most tests act
            # as, and a scope test reusing it could not tell `assigned` from
            # `all`.
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

            # The *subject* teacher, who is not the class teacher: §4's two
            # notions of "assigned" are genuinely different, and one Staff row
            # serving both would hide which of them a scope test resolved
            # through.
            self.subject_teacher_user = UserFactory(tenant=self.tenant)
            self.subject_teacher = StaffFactory(
                tenant=self.tenant, campus=self.campus, user_id=self.subject_teacher_user.pk
            )
            self.allocation = TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.section,
                subject=self.subject,
                staff=self.subject_teacher,
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

            self.scale = complete_scale(self.tenant, is_default=True)

    def allow_everything(self, user=None) -> None:
        """Grant the acting user every key this module declares, `all`-scoped."""
        grant(user or self.user, *ALL_KEYS, scope=RecordScope.ALL)
