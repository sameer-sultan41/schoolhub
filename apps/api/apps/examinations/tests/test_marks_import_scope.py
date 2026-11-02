"""Who may write which section: the import's per-row check, the gate's refusals,
and `services.may_enter_marks` agreeing with `Marks`' read scope across sessions.
"""

from __future__ import annotations

from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework import status

from apps.examinations import services
from apps.examinations.models import Marks
from apps.examinations.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ExamFactory,
    ExamSubjectFactory,
    MarksFactory,
    SectionFactory,
    StudentEnrollmentFactory,
    TeacherAllocationFactory,
    UserFactory,
    grant,
)
from apps.examinations.tests.test_marks_grid import GridTestCase
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

IMPORTS = "/api/v1/marks-imports"
CSV = "text/csv"


class PredicateAgreementTests(GridTestCase):
    def test_may_enter_marks_and_the_marks_scope_agree(self) -> None:
        """The rows a teacher reads are exactly the rows `may_enter_marks` lets them write.

        Two sessions: last session the subject teacher taught `other_section`, where
        `students[0]` sat (still `active`, the session not yet promoted); this session
        they teach `self.section`. Each session's marks follow that session's teaching.
        """
        from apps.student_management.models import EnrollmentStatus, StudentEnrollment

        other = self.second_subject()
        outsider = self.enrol(self.other_section)
        with tenant_context(self.tenant.id):
            last_year = AcademicSessionFactory(tenant=self.tenant, is_current=False)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.students[0],
                academic_session=last_year,
                school_class=self.school_class,
                section=self.other_section,
            )
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=last_year,
                section=self.other_section,
                subject=self.subject,
                staff=self.subject_teacher,
            )
            old_exam = ExamFactory(
                tenant=self.tenant, academic_session=last_year, grading_scale=self.scale
            )
            old_subject = ExamSubjectFactory(
                tenant=self.tenant,
                exam=old_exam,
                school_class=self.school_class,
                subject=self.subject,
            )
            for exam_subject in (self.exam_subject, other, old_subject):
                for student in [*self.students, outsider]:
                    MarksFactory(
                        tenant=self.tenant,
                        exam_subject=exam_subject,
                        student=student,
                        entered_by=self.user.pk,
                    )

        for user in (self.subject_teacher_user, self.teacher_user):
            grant(user, "exams.marks.view", scope=RecordScope.ASSIGNED)
            with self.subTest(user=user.email), tenant_context(self.tenant.id):
                scoped = set(
                    Marks.filter_assigned_to_user(Marks.objects.alive(), user).values_list(
                        "pk", flat=True
                    )
                )
                enterable = set()
                for mark in Marks.objects.alive().select_related("exam_subject__exam"):
                    enrollment = (
                        StudentEnrollment.objects.alive()
                        .filter(
                            student_id=mark.student_id,
                            academic_session_id=mark.exam_subject.exam.academic_session_id,
                            status=EnrollmentStatus.ACTIVE,
                        )
                        .select_related("section")
                        .first()
                    )
                    if enrollment and services.may_enter_marks(
                        user=user, exam_subject=mark.exam_subject, section=enrollment.section
                    ):
                        enterable.add(mark.pk)

                self.assertEqual(scoped, enterable)
                if user == self.subject_teacher_user:
                    # Last session's mark through last session's allocation, and only that one.
                    old_marks = Marks.objects.alive().filter(exam_subject=old_subject)
                    self.assertEqual(
                        scoped & set(old_marks.values_list("pk", flat=True)),
                        {old_marks.get(student=self.students[0]).pk},
                    )
                # Not vacuous: each teacher reaches some rows and not others.
                self.assertTrue(scoped)
                self.assertLess(len(scoped), Marks.objects.alive().count())


class SectionGateMessageTests(GridTestCase):
    def test_a_deleted_section_is_a_422_on_section_id(self) -> None:
        with tenant_context(self.tenant.id):
            self.other_section.deleted_at = timezone.now()
            self.other_section.save(update_fields=["deleted_at"])

        response = self.submit(section=self.other_section)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        details = response.json()["error"]["details"]
        self.assertEqual([detail["field"] for detail in details], ["section_id"])
        self.assertIn("deleted", details[0]["issue"])

    def test_a_campus_refusal_says_the_section_is_outside_the_campus(self) -> None:
        with tenant_context(self.tenant.id):
            far_campus = CampusFactory(tenant=self.tenant)
            far_section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=far_campus
            )
            entrant = UserFactory(tenant=self.tenant)
        outsider = self.enrol(far_section)
        client = self.client_for(
            entrant, "exams.marks.create", scope=RecordScope.CAMPUS, scope_ref=self.campus.pk
        )

        response = self.submit(
            [{"student_id": str(outsider.pk), "theory_marks": "50.00"}],
            client=client,
            section=far_section,
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        details = response.json()["error"]["details"]
        self.assertEqual(details[0]["issue"], "This section is outside your campus.")


class MarksImportScopeTests(GridTestCase):
    def sheet(self, *admission_numbers: str) -> bytes:
        header = ",".join(services.MARKS_IMPORT_COLUMNS)
        rows = [f"{number},60,,,," for number in admission_numbers]
        return ("\n".join([header, *rows]) + "\n").encode()

    def upload(self, content: bytes, *, client=None, name="marks.csv", content_type=CSV):
        return (client or self.client).post(
            IMPORTS,
            {
                "exam_subject_id": str(self.exam_subject.pk),
                "file": SimpleUploadedFile(name, content, content_type=content_type),
            },
            format="multipart",
        )

    def job_result(self, response) -> dict:
        from core.jobs.models import BackgroundJob

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=response.json()["data"]["job_id"])
        return job.result

    def test_the_job_result_shape(self) -> None:
        with self.captureOnCommitCallbacks(execute=True):
            response = self.upload(self.sheet(self.students[0].admission_number, "NOT-A-STUDENT"))

        result = self.job_result(response)

        self.assertEqual(set(result), {"total", "succeeded", "failed", "errors"})
        self.assertEqual((result["total"], result["succeeded"], result["failed"]), (2, 1, 1))
        self.assertEqual(set(result["errors"][0]), {"row", "field", "issue"})

    def test_a_row_for_an_unallocated_section_is_refused_per_row(self) -> None:
        outsider = self.enrol(self.other_section)
        client = self.client_for(self.subject_teacher_user, "exams.marks.import")

        with self.captureOnCommitCallbacks(execute=True):
            response = self.upload(
                self.sheet(self.students[0].admission_number, outsider.admission_number),
                client=client,
            )

        result = self.job_result(response)
        self.assertEqual((result["succeeded"], result["failed"]), (1, 1))
        self.assertEqual(result["errors"][0]["row"], "3")
        self.assertEqual(result["errors"][0]["field"], "admission_number")
        with tenant_context(self.tenant.id):
            self.assertFalse(Marks.objects.alive().filter(student=outsider).exists())
            self.assertTrue(Marks.objects.alive().filter(student=self.students[0]).exists())

    def test_an_importer_with_no_enterable_section_is_refused_before_a_job(self) -> None:
        with tenant_context(self.tenant.id):
            stranger = UserFactory(tenant=self.tenant)
        client = self.client_for(stranger, "exams.marks.import")

        response = self.upload(self.sheet(self.students[0].admission_number), client=client)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        fields = [detail["field"] for detail in response.json()["error"]["details"]]
        self.assertEqual(fields, ["exam_subject_id"])

    def test_a_disallowed_mime_type_is_refused(self) -> None:
        response = self.upload(
            self.sheet(self.students[0].admission_number), content_type="application/pdf"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        fields = [detail["field"] for detail in response.json()["error"]["details"]]
        self.assertEqual(fields, ["file"])

    def test_a_csv_sent_as_the_windows_excel_type_is_accepted(self) -> None:
        response = self.upload(
            self.sheet(self.students[0].admission_number), content_type="application/vnd.ms-excel"
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
