"""§5.4's entry grid, scoped per section by `services.may_enter_marks`.

An assigned teacher writes the sections they are allocated (or homeroom) in the
exam's session, never every section of the class. Progress, the reminder and the
view key are in `test_marks_progress.py`; the import and the predicate's
agreement with `Marks`' scope in `test_marks_import_scope.py`.
"""

from __future__ import annotations

import datetime

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations import services
from apps.examinations.models import ExamStatus, Marks
from apps.examinations.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    ClassSubjectFactory,
    ExamSubjectFactory,
    MarksFactory,
    SectionFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    SubjectFactory,
    UserFactory,
    authenticate,
    grant,
    open_marks_entry,
)
from apps.examinations.tests.test_marks import BULK_ENTRY, MARKS, MarksTestCase
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

GRID = f"{MARKS}/grid"


class GridTestCase(MarksTestCase):
    def grid(self, client=None, *, exam_subject=None, section=None):
        return (client or self.client).get(
            GRID,
            {
                "exam_subject_id": str((exam_subject or self.exam_subject).pk),
                "section_id": str((section or self.section).pk),
            },
        )

    def client_for(self, user, *keys: str, scope: str = RecordScope.ASSIGNED, scope_ref=None):
        grant(user, *keys, scope=scope, scope_ref=scope_ref)
        client = APIClient()
        authenticate(client, user)
        return client

    def enrol(self, section, *, session=None, **enrollment):
        """A new student on `section`'s roll in `session` (this session by default)."""
        with tenant_context(self.tenant.id):
            student = StudentFactory(tenant=self.tenant, campus=section.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=student,
                academic_session=session or self.session,
                school_class=section.school_class,
                section=section,
                **enrollment,
            )
        return student

    def second_subject(self):
        with tenant_context(self.tenant.id):
            subject = SubjectFactory(tenant=self.tenant)
            ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=subject,
            )
            exam_subject = ExamSubjectFactory(
                tenant=self.tenant, exam=self.exam, school_class=self.school_class, subject=subject
            )
        open_marks_entry(exam_subject)
        return exam_subject


class SectionWriteScopeTests(GridTestCase):
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

    def test_assigned_teacher_gets_a_404_on_an_unallocated_section_s_grid(self) -> None:
        client = self.client_for(self.subject_teacher_user, "exams.marks.view")

        self.assertEqual(self.grid(client).status_code, status.HTTP_200_OK)
        response = self.grid(client, section=self.other_section)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_allocation_in_another_session_opens_no_section(self) -> None:
        """Same section and subject, last session's allocation: not this exam's (L28)."""
        with tenant_context(self.tenant.id):
            last_year = AcademicSessionFactory(tenant=self.tenant, is_current=False)
            self.allocation.academic_session = last_year
            self.allocation.save(update_fields=["academic_session"])
        client = self.client_for(self.subject_teacher_user, "exams.marks.view")

        self.assertEqual(self.grid(client).status_code, status.HTTP_404_NOT_FOUND)

    def test_a_homeroom_teacher_reads_and_enters_every_subject_of_their_homeroom(self) -> None:
        other = self.second_subject()
        client = self.client_for(self.teacher_user, "exams.marks.view", "exams.marks.create")

        for exam_subject in (self.exam_subject, other):
            with self.subTest(subject=str(exam_subject.subject_id)):
                read = self.grid(client, exam_subject=exam_subject)
                self.assertEqual(read.status_code, status.HTTP_200_OK, read.json())
                self.assertTrue(read.json()["meta"]["writable"])
                written = client.post(
                    BULK_ENTRY,
                    {
                        "exam_subject_id": str(exam_subject.pk),
                        "section_id": str(self.section.pk),
                        "entries": self.entries(),
                    },
                    format="json",
                )
                self.assertEqual(written.status_code, status.HTTP_200_OK, written.json())
        self.assertEqual(
            self.grid(client, section=self.other_section).status_code, status.HTTP_404_NOT_FOUND
        )

    def test_a_campus_scoped_principal_gets_a_404_on_another_campus_s_grid(self) -> None:
        with tenant_context(self.tenant.id):
            far_campus = CampusFactory(tenant=self.tenant)
            far_section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=far_campus
            )
            principal = UserFactory(tenant=self.tenant)
        client = self.client_for(
            principal, "exams.marks.view", scope=RecordScope.CAMPUS, scope_ref=self.campus.pk
        )

        self.assertEqual(self.grid(client).status_code, status.HTTP_200_OK)
        self.assertEqual(
            self.grid(client, section=far_section).status_code, status.HTTP_404_NOT_FOUND
        )

    def test_a_student_not_on_the_section_s_roll_is_a_row_issue(self) -> None:
        outsider = self.enrol(self.other_section)
        entries = [*self.entries(), {"student_id": str(outsider.pk), "theory_marks": "50.00"}]

        response = self.submit(entries)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        rows = response.json()["error"]["meta"]["rows"]
        self.assertEqual(
            [(row["index"], row["student_id"], row["field"]) for row in rows],
            [(3, str(outsider.pk), "student_id")],
        )
        with tenant_context(self.tenant.id):
            self.assertFalse(Marks.objects.alive().filter(exam_subject=self.exam_subject).exists())

    def test_a_section_of_another_class_is_a_422_on_section_id(self) -> None:
        with tenant_context(self.tenant.id):
            elsewhere = SectionFactory(
                tenant=self.tenant,
                school_class=ClassFactory(tenant=self.tenant, level=9),
                campus=self.campus,
            )

        response = self.submit(section=elsewhere)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        fields = [detail["field"] for detail in response.json()["error"]["details"]]
        self.assertEqual(fields, ["section_id"])

    def test_the_200_carries_the_service_s_counts(self) -> None:
        response = self.submit()

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"], {"entered": 3, "updated": 0, "rows": 3})


class GridReadTests(GridTestCase):
    def test_the_grid_is_the_active_roll_in_roll_order_with_marks_merged(self) -> None:
        from apps.student_management.models import EnrollmentStatus, StudentEnrollment

        with tenant_context(self.tenant.id):
            # Text roll numbers sort shortest first: "1", "2", "10".
            for student, roll in zip(self.students, ("10", "2", "1"), strict=True):
                StudentEnrollment.objects.filter(student=student).update(roll_number=roll)
            mark = MarksFactory(
                tenant=self.tenant,
                exam_subject=self.exam_subject,
                student=self.students[1],
                entered_by=self.user.pk,
                theory_marks="61.00",
            )
        withdrawn = self.enrol(self.section, status=EnrollmentStatus.WITHDRAWN)

        response = self.grid()

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        data = response.json()["data"]
        self.assertEqual(
            [row["student_id"] for row in data],
            [str(self.students[i].pk) for i in (2, 1, 0)],
        )
        self.assertNotIn(str(withdrawn.pk), {row["student_id"] for row in data})
        self.assertEqual([row["roll_number"] for row in data], ["1", "2", "10"])
        self.assertEqual(data[1]["marks"]["id"], str(mark.pk))
        self.assertEqual(data[1]["admission_number"], self.students[1].admission_number)
        self.assertEqual(data[1]["student_name"], self.students[1].full_name)
        self.assertIsNone(data[0]["marks"])

    def test_meta_carries_the_marks_structure_and_writability(self) -> None:
        meta = self.grid().json()["meta"]

        self.assertEqual(
            meta["exam_subject"],
            {
                "max_marks": "100.00",
                "pass_marks": "40.00",
                "has_practical": False,
                "practical_max_marks": None,
            },
        )
        self.assertTrue(meta["writable"])
        self.assertIsNone(meta["unwritable_reason"])
        self.assertIsNone(meta["unwritable_message"])

    def test_a_missing_parameter_is_a_400(self) -> None:
        response = self.client.get(GRID, {"exam_subject_id": str(self.exam_subject.pk)})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reading_the_grid_needs_the_view_key(self) -> None:
        with tenant_context(self.tenant.id):
            entrant = UserFactory(tenant=self.tenant)
        client = self.client_for(entrant, "exams.marks.create", scope=RecordScope.ALL)

        self.assertEqual(self.grid(client).status_code, status.HTTP_403_FORBIDDEN)

    def test_the_grid_is_a_flat_number_of_queries(self) -> None:
        def count() -> int:
            with CaptureQueriesContext(connection) as captured:
                self.assertEqual(self.grid().status_code, status.HTTP_200_OK)
            return len(captured.captured_queries)

        count()  # Warm the permission and scope caches.
        small = count()
        for _ in range(3):
            student = self.enrol(self.section)
            with tenant_context(self.tenant.id):
                MarksFactory(
                    tenant=self.tenant,
                    exam_subject=self.exam_subject,
                    student=student,
                    entered_by=self.user.pk,
                )

        self.assertEqual(count(), small)


class GridWritabilityTests(GridTestCase):
    def reason(self, client=None) -> tuple[bool, str | None, str | None]:
        meta = self.grid(client).json()["meta"]
        return meta["writable"], meta["unwritable_reason"], meta["unwritable_message"]

    def test_an_approved_exam_is_exam_status(self) -> None:
        with tenant_context(self.tenant.id):
            self.exam.status = ExamStatus.APPROVED
            self.exam.save(update_fields=["status"])

        writable, reason, message = self.reason()

        self.assertEqual((writable, reason), (False, "exam_status"))
        self.assertIn("send the results back", message.lower())

    def test_a_locked_subject_is_locked(self) -> None:
        with tenant_context(self.tenant.id):
            services.lock_marks(exam_subject=self.exam_subject, actor_id=self.user.pk)

        writable, reason, message = self.reason()

        self.assertEqual((writable, reason), (False, "locked"))
        self.assertIn("unlock", message.lower())

    def test_a_window_that_has_not_opened_is_window_not_open(self) -> None:
        now = timezone.now()
        open_marks_entry(
            self.exam_subject,
            opens_at=now + datetime.timedelta(days=1),
            closes_at=now + datetime.timedelta(days=2),
        )

        writable, reason, message = self.reason()

        self.assertEqual((writable, reason), (False, "window_not_open"))
        self.assertIn("opens", message)

    def test_a_closed_window_is_window_closed(self) -> None:
        now = timezone.now()
        open_marks_entry(
            self.exam_subject,
            opens_at=now - datetime.timedelta(days=3),
            closes_at=now - datetime.timedelta(days=1),
        )

        writable, reason, message = self.reason()

        self.assertEqual((writable, reason), (False, "window_closed"))
        self.assertIn("reopened", message)

    def test_a_principal_reads_but_is_no_permission(self) -> None:
        with tenant_context(self.tenant.id):
            principal = UserFactory(tenant=self.tenant)
        client = self.client_for(principal, "exams.marks.view", scope=RecordScope.ALL)

        writable, reason, message = self.reason(client)

        self.assertEqual((writable, reason), (False, "no_permission"))
        self.assertEqual(message, services.NO_PERMISSION_MESSAGE)
