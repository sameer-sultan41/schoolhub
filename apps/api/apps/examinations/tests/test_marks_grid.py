"""§5.4's entry grid, scoped per section by `services.may_enter_marks`.

An assigned teacher writes the sections they are allocated (or homeroom) in the
exam's session, never every section of the class.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations.models import Marks
from apps.examinations.tests.factories import (
    StudentEnrollmentFactory,
    StudentFactory,
    authenticate,
    grant,
)
from apps.examinations.tests.test_marks import BULK_ENTRY, MarksTestCase
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context


class SectionWriteScopeTests(MarksTestCase):
    def test_assigned_teacher_cannot_write_an_unallocated_section_of_their_class(self) -> None:
        # `subject_teacher` is allocated to `self.section` only; this student is in the other one.
        with tenant_context(self.tenant.id):
            outsider = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=outsider,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.other_section,
            )
        grant(self.subject_teacher_user, "exams.marks.create", scope=RecordScope.ASSIGNED)
        client = APIClient()
        authenticate(client, self.subject_teacher_user)

        response = client.post(
            BULK_ENTRY,
            {
                "exam_subject_id": str(self.exam_subject.pk),
                "section_id": str(self.other_section.pk),
                "entries": [{"student_id": str(outsider.pk), "theory_marks": "55.00"}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        fields = [detail["field"] for detail in response.json()["error"]["details"]]
        self.assertEqual(fields, ["section_id"])
        with tenant_context(self.tenant.id):
            self.assertFalse(Marks.objects.alive().filter(student=outsider).exists())
