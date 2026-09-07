"""Cross-tenant access on every examinations endpoint.

testing-strategy.md §3 and AGENTS.md invariant 2: for each endpoint, a tenant-A
caller reaching for a tenant-B resource must get **404, never 403** — a 403
confirms the row exists, which is the leak the rule exists to prevent.

The acting user holds every key this module declares, `all`-scoped, and the flag
is on for both tenants, so a denial here can only come from tenant scoping.
Without that these would pass for the wrong reason the moment someone forgot a
permission.

Two endpoints fail differently from a plain detail lookup, and both are asserted
separately:

- **`POST /exams`** names its session and scale in the *body*. A foreign id
  fails to resolve through the serializer's tenant-scoped `PrimaryKeyRelatedField`
  rather than through a detail lookup, which is a **400** — the field genuinely
  does not validate. That is the intended answer and it leaks nothing: the
  message says the id is invalid, not that it belongs to someone else.
- **the nested band collection** resolves its scale from the path, so a foreign
  scale is a 404 on the collection URL itself, before any band is considered.
"""

from __future__ import annotations

import datetime

from django.utils import timezone
from rest_framework import status

from apps.examinations.tests.base import ExaminationsAPITestCase
from apps.examinations.tests.factories import (
    AcademicSessionFactory,
    AdmitCardFactory,
    CampusFactory,
    ClassFactory,
    ClassSubjectFactory,
    ExamFactory,
    ExamScheduleFactory,
    ExamSubjectFactory,
    MarksFactory,
    ReportCardFactory,
    ResultFactory,
    RoomFactory,
    SectionFactory,
    StudentFactory,
    SubjectFactory,
    TenantFactory,
    complete_scale,
    enable_feature,
    exam_week,
)
from core.tenancy.context import tenant_context

SCALES = "/api/v1/grading-scales"
EXAMS = "/api/v1/exams"
EXAM_SUBJECTS = "/api/v1/exam-subjects"
EXAM_SCHEDULES = "/api/v1/exam-schedules"
ADMIT_CARDS = "/api/v1/admit-cards"
MARKS = "/api/v1/marks"
BULK_ENTRY = "/api/v1/marks:bulk-entry"
RESULTS = "/api/v1/results"
REPORT_CARDS = "/api/v1/report-cards"


class ExaminationsCrossTenantTests(ExaminationsAPITestCase):
    """Builds a complete, self-consistent second tenant alongside the first."""

    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()

        self.other_tenant = TenantFactory()
        enable_feature(self.other_tenant, "module.examinations")
        with tenant_context(self.other_tenant.id):
            session = AcademicSessionFactory(tenant=self.other_tenant, is_current=True)
            school_class = ClassFactory(tenant=self.other_tenant, level=8)
            subject = SubjectFactory(tenant=self.other_tenant)
            ClassSubjectFactory(
                tenant=self.other_tenant,
                academic_session=session,
                school_class=school_class,
                subject=subject,
            )
            self.foreign_scale = complete_scale(self.other_tenant, is_default=True)
            self.foreign_exam = ExamFactory(
                tenant=self.other_tenant,
                academic_session=session,
                grading_scale=self.foreign_scale,
            )
            self.foreign_exam_subject = ExamSubjectFactory(
                tenant=self.other_tenant,
                exam=self.foreign_exam,
                school_class=school_class,
                subject=subject,
            )
            self.foreign_band = self.foreign_scale.bands.first()
            self.foreign_session = session

            foreign_campus = CampusFactory(tenant=self.other_tenant)
            foreign_section = SectionFactory(
                tenant=self.other_tenant, school_class=school_class, campus=foreign_campus
            )
            foreign_room = RoomFactory(tenant=self.other_tenant, campus=foreign_campus)
            self.foreign_exam.starts_on = timezone.localdate()
            self.foreign_exam.ends_on = timezone.localdate() + datetime.timedelta(days=5)
            self.foreign_exam.save(update_fields=["starts_on", "ends_on"])
            self.foreign_schedule = ExamScheduleFactory(
                tenant=self.other_tenant,
                exam_subject=self.foreign_exam_subject,
                section=foreign_section,
                exam_date=timezone.localdate(),
                room=foreign_room,
            )
            foreign_student = StudentFactory(tenant=self.other_tenant, campus=foreign_campus)
            self.foreign_marks = MarksFactory(
                tenant=self.other_tenant,
                exam_subject=self.foreign_exam_subject,
                student=StudentFactory(tenant=self.other_tenant, campus=foreign_campus),
                entered_by=self.user.pk,
            )
            foreign_result_student = StudentFactory(tenant=self.other_tenant, campus=foreign_campus)
            self.foreign_result = ResultFactory(
                tenant=self.other_tenant,
                exam=self.foreign_exam,
                student=foreign_result_student,
                section=foreign_section,
            )
            self.foreign_report_card = ReportCardFactory(
                tenant=self.other_tenant,
                exam=self.foreign_exam,
                student=foreign_result_student,
                result=self.foreign_result,
            )
            self.foreign_card = AdmitCardFactory(
                tenant=self.other_tenant,
                exam=self.foreign_exam,
                student=foreign_student,
                admit_card_no="FOREIGN-1",
            )

    def assert404(self, response) -> None:
        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
            f"expected 404, got {response.status_code}: {response.content!r}",
        )

    # --- grading scales ---------------------------------------------------

    def test_retrieving_a_foreign_scale_is_a_404(self) -> None:
        self.assert404(self.client.get(f"{SCALES}/{self.foreign_scale.pk}"))

    def test_patching_a_foreign_scale_is_a_404(self) -> None:
        self.assert404(
            self.client.patch(
                f"{SCALES}/{self.foreign_scale.pk}", {"name": "Mine now"}, format="json"
            )
        )

    def test_deleting_a_foreign_scale_is_a_404(self) -> None:
        self.assert404(self.client.delete(f"{SCALES}/{self.foreign_scale.pk}"))

    def test_setting_a_foreign_scale_as_default_is_a_404(self) -> None:
        """The one that would matter most: succeeding here would repoint this
        tenant's grading at another school's bands."""
        self.assert404(self.client.post(f"{SCALES}/{self.foreign_scale.pk}:set-default"))

    def test_listing_scales_never_shows_another_tenant_s(self) -> None:
        response = self.client.get(SCALES)

        ids = {row["id"] for row in response.json()["data"]}
        self.assertNotIn(str(self.foreign_scale.pk), ids)

    # --- grade bands ------------------------------------------------------

    def test_listing_bands_under_a_foreign_scale_is_a_404(self) -> None:
        self.assert404(self.client.get(f"{SCALES}/{self.foreign_scale.pk}/grade-bands"))

    def test_creating_a_band_under_a_foreign_scale_is_a_404(self) -> None:
        self.assert404(
            self.client.post(
                f"{SCALES}/{self.foreign_scale.pk}/grade-bands",
                {"label": "Z", "min_percent": "0.00", "max_percent": "100.00"},
                format="json",
            )
        )

    def test_retrieving_a_foreign_band_through_our_own_scale_is_a_404(self) -> None:
        """A band id from another tenant, addressed under a scale this caller
        does own — the shape that would slip past a naive `pk` lookup."""
        self.assert404(
            self.client.get(f"{SCALES}/{self.scale.pk}/grade-bands/{self.foreign_band.pk}")
        )

    def test_patching_a_foreign_band_is_a_404(self) -> None:
        self.assert404(
            self.client.patch(
                f"{SCALES}/{self.scale.pk}/grade-bands/{self.foreign_band.pk}",
                {"label": "Z"},
                format="json",
            )
        )

    def test_deleting_a_foreign_band_is_a_404(self) -> None:
        self.assert404(
            self.client.delete(f"{SCALES}/{self.scale.pk}/grade-bands/{self.foreign_band.pk}")
        )

    # --- exams ------------------------------------------------------------

    def test_retrieving_a_foreign_exam_is_a_404(self) -> None:
        self.assert404(self.client.get(f"{EXAMS}/{self.foreign_exam.pk}"))

    def test_patching_a_foreign_exam_is_a_404(self) -> None:
        self.assert404(
            self.client.patch(f"{EXAMS}/{self.foreign_exam.pk}", {"name": "X"}, format="json")
        )

    def test_deleting_a_foreign_exam_is_a_404(self) -> None:
        self.assert404(self.client.delete(f"{EXAMS}/{self.foreign_exam.pk}"))

    def test_listing_exams_never_shows_another_tenant_s(self) -> None:
        response = self.client.get(EXAMS)

        ids = {row["id"] for row in response.json()["data"]}
        self.assertNotIn(str(self.foreign_exam.pk), ids)

    def test_creating_an_exam_in_a_foreign_session_does_not_validate(self) -> None:
        """A 400, not a 404: the session id arrives in the body and fails the
        serializer's tenant-scoped queryset. The message says the id is invalid,
        never that it belongs to another school."""
        response = self.client.post(
            EXAMS,
            {
                "academic_session_id": str(self.foreign_session.pk),
                "name": "Cross-tenant midterm",
                "exam_type": "midterm",
                "grading_scale_id": str(self.scale.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertNotIn(str(self.other_tenant.pk), str(response.json()))

    def test_creating_an_exam_against_a_foreign_scale_does_not_validate(self) -> None:
        response = self.client.post(
            EXAMS,
            {
                "academic_session_id": str(self.session.pk),
                "name": "Borrowed grading",
                "exam_type": "midterm",
                "grading_scale_id": str(self.foreign_scale.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # --- exam subjects ----------------------------------------------------

    def test_retrieving_a_foreign_exam_subject_is_a_404(self) -> None:
        self.assert404(self.client.get(f"{EXAM_SUBJECTS}/{self.foreign_exam_subject.pk}"))

    def test_patching_a_foreign_exam_subject_is_a_404(self) -> None:
        self.assert404(
            self.client.patch(
                f"{EXAM_SUBJECTS}/{self.foreign_exam_subject.pk}",
                {"max_marks": "1.00"},
                format="json",
            )
        )

    def test_deleting_a_foreign_exam_subject_is_a_404(self) -> None:
        self.assert404(self.client.delete(f"{EXAM_SUBJECTS}/{self.foreign_exam_subject.pk}"))

    def test_listing_exam_subjects_never_shows_another_tenant_s(self) -> None:
        response = self.client.get(EXAM_SUBJECTS)

        ids = {row["id"] for row in response.json()["data"]}
        self.assertNotIn(str(self.foreign_exam_subject.pk), ids)

    def test_configuring_a_subject_on_a_foreign_exam_does_not_validate(self) -> None:
        response = self.client.post(
            EXAM_SUBJECTS,
            {
                "exam_id": str(self.foreign_exam.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(self.subject.pk),
                "max_marks": "100.00",
                "pass_marks": "40.00",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_band_is_invisible_even_by_direct_query(self) -> None:
        """Proof the manager, not the URL, is doing the narrowing: reading the
        foreign scale's bands under this tenant's context returns nothing."""
        from apps.examinations.models import GradeBand

        with tenant_context(self.tenant.id):
            leaked = GradeBand.objects.alive().filter(grading_scale=self.foreign_scale).count()

        self.assertEqual(leaked, 0)

    # --- exam schedules ---------------------------------------------------

    def test_retrieving_a_foreign_sitting_is_a_404(self) -> None:
        self.assert404(self.client.get(f"{EXAM_SCHEDULES}/{self.foreign_schedule.pk}"))

    def test_patching_a_foreign_sitting_is_a_404(self) -> None:
        self.assert404(
            self.client.patch(
                f"{EXAM_SCHEDULES}/{self.foreign_schedule.pk}",
                {"start_time": "07:00"},
                format="json",
            )
        )

    def test_deleting_a_foreign_sitting_is_a_404(self) -> None:
        self.assert404(self.client.delete(f"{EXAM_SCHEDULES}/{self.foreign_schedule.pk}"))

    def test_listing_sittings_never_shows_another_tenant_s(self) -> None:
        response = self.client.get(EXAM_SCHEDULES)

        ids = {row["id"] for row in response.json()["data"]}
        self.assertNotIn(str(self.foreign_schedule.pk), ids)

    def test_publishing_a_foreign_exam_s_schedule_is_a_404(self) -> None:
        """Succeeding here would release another school's timetable to its
        students and fire its notifications."""
        self.assert404(self.client.post(f"{EXAMS}/{self.foreign_exam.pk}:publish-schedule"))

    # --- admit cards ------------------------------------------------------

    def test_retrieving_a_foreign_admit_card_is_a_404(self) -> None:
        self.assert404(self.client.get(f"{ADMIT_CARDS}/{self.foreign_card.pk}"))

    def test_listing_admit_cards_never_shows_another_tenant_s(self) -> None:
        response = self.client.get(ADMIT_CARDS)

        ids = {row["id"] for row in response.json()["data"]}
        self.assertNotIn(str(self.foreign_card.pk), ids)

    def test_issuing_cards_for_a_foreign_exam_is_a_404(self) -> None:
        self.assert404(self.client.post(f"{EXAMS}/{self.foreign_exam.pk}:issue-admit-cards"))

    def test_revoking_a_foreign_admit_card_is_a_404(self) -> None:
        self.assert404(
            self.client.post(
                f"{ADMIT_CARDS}/{self.foreign_card.pk}:revoke",
                {"reason": "not mine to revoke"},
                format="json",
            )
        )

    def test_scheduling_against_a_foreign_exam_subject_does_not_validate(self) -> None:
        """A 400, not a 404: the exam-subject id arrives in the body and fails
        the serializer's tenant-scoped queryset."""
        response = self.client.post(
            EXAM_SCHEDULES,
            {
                "exam_subject_id": str(self.foreign_exam_subject.pk),
                "section_id": str(self.section.pk),
                "exam_date": str(timezone.localdate()),
                "start_time": "09:00",
                "end_time": "11:00",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_sitting_never_enters_this_tenant_s_clash_list(self) -> None:
        """The engine compares against other exams *on the same dates*, which is
        exactly the query a missing tenant scope would leak through — a room
        double-booking reported against another school's hall.
        """
        from apps.examinations import conflicts

        with tenant_context(self.tenant.id):
            own_exam = ExamFactory(
                tenant=self.tenant, academic_session=self.session, grading_scale=self.scale
            )
            own_subject = ExamSubjectFactory(
                tenant=self.tenant,
                exam=own_exam,
                school_class=self.school_class,
                subject=self.subject,
            )
        day = exam_week(self.tenant, own_exam)
        with tenant_context(self.tenant.id):
            # Same date and the same *room code* as the foreign sitting, in a
            # room of this tenant's own — so anything that matched across
            # tenants would report a double-booking here.
            own_room = RoomFactory(tenant=self.tenant, campus=self.campus)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=own_subject,
                section=self.section,
                exam_date=day,
                room=own_room,
            )
            findings = conflicts.detect_conflicts(exam=own_exam)

        self.assertEqual(
            [f for f in findings if f["severity"] == "hard"],
            [],
            f"a foreign tenant's sitting leaked into the clash list: {findings}",
        )

    # --- marks ------------------------------------------------------------

    def test_retrieving_a_foreign_marks_row_is_a_404(self) -> None:
        self.assert404(self.client.get(f"{MARKS}/{self.foreign_marks.pk}"))

    def test_listing_marks_never_shows_another_tenant_s(self) -> None:
        response = self.client.get(MARKS)

        ids = {row["id"] for row in response.json()["data"]}
        self.assertNotIn(str(self.foreign_marks.pk), ids)

    def test_entering_marks_against_a_foreign_exam_subject_does_not_validate(self) -> None:
        """A 400, not a 404: the exam-subject id arrives in the body and fails
        the serializer's tenant-scoped queryset. The message says the id is
        invalid, never that it belongs to another school."""
        response = self.client.post(
            BULK_ENTRY,
            {
                "exam_subject_id": str(self.foreign_exam_subject.pk),
                "entries": [{"student_id": str(self.students[0].pk), "theory_marks": "50.00"}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertNotIn(str(self.other_tenant.pk), str(response.json()))

    def test_locking_a_foreign_exam_subject_is_a_404(self) -> None:
        self.assert404(
            self.client.post(f"/api/v1/exam-subjects/{self.foreign_exam_subject.pk}:lock-marks")
        )

    def test_unlocking_a_foreign_exam_subject_is_a_404(self) -> None:
        self.assert404(
            self.client.post(f"/api/v1/exam-subjects/{self.foreign_exam_subject.pk}:unlock-marks")
        )

    def test_reading_a_foreign_exam_s_marks_progress_is_a_404(self) -> None:
        self.assert404(self.client.get(f"{EXAMS}/{self.foreign_exam.pk}/marks-progress"))

    def test_importing_into_a_foreign_exam_subject_does_not_validate(self) -> None:
        from django.core.files.uploadedfile import SimpleUploadedFile

        response = self.client.post(
            "/api/v1/marks-imports",
            {
                "exam_subject_id": str(self.foreign_exam_subject.pk),
                "file": SimpleUploadedFile("m.csv", b"admission_number\n", "text/csv"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # --- results ----------------------------------------------------------

    def test_retrieving_a_foreign_result_is_a_404(self) -> None:
        self.assert404(self.client.get(f"{RESULTS}/{self.foreign_result.pk}"))

    def test_listing_results_never_shows_another_tenant_s(self) -> None:
        response = self.client.get(RESULTS)

        ids = {row["id"] for row in response.json()["data"]}
        self.assertNotIn(str(self.foreign_result.pk), ids)

    def test_processing_a_foreign_exam_s_results_is_a_404(self) -> None:
        self.assert404(self.client.post(f"{EXAMS}/{self.foreign_exam.pk}:process-results"))

    def test_approving_a_foreign_exam_s_results_is_a_404(self) -> None:
        """Succeeding here would sign off another school's grades under this
        caller's name."""
        self.assert404(self.client.post(f"{EXAMS}/{self.foreign_exam.pk}:approve-results"))

    def test_publishing_a_foreign_exam_s_results_is_a_404(self) -> None:
        self.assert404(self.client.post(f"{EXAMS}/{self.foreign_exam.pk}:publish-results"))

    def test_sending_a_foreign_exam_s_results_back_is_a_404(self) -> None:
        self.assert404(
            self.client.post(
                f"{EXAMS}/{self.foreign_exam.pk}:send-results-back",
                {"reason": "not mine"},
                format="json",
            )
        )

    def test_withholding_a_foreign_result_is_a_404(self) -> None:
        self.assert404(
            self.client.post(
                f"{RESULTS}/{self.foreign_result.pk}:withhold",
                {"reason": "not mine"},
                format="json",
            )
        )

    # --- report cards -----------------------------------------------------

    def test_retrieving_a_foreign_report_card_is_a_404(self) -> None:
        self.assert404(self.client.get(f"{REPORT_CARDS}/{self.foreign_report_card.pk}"))

    def test_patching_a_foreign_report_card_s_remarks_is_a_404(self) -> None:
        self.assert404(
            self.client.patch(
                f"{REPORT_CARDS}/{self.foreign_report_card.pk}",
                {"class_teacher_remarks": "not mine to write"},
                format="json",
            )
        )

    def test_listing_report_cards_never_shows_another_tenant_s(self) -> None:
        response = self.client.get(REPORT_CARDS)

        ids = {row["id"] for row in response.json()["data"]}
        self.assertNotIn(str(self.foreign_report_card.pk), ids)

    def test_generating_a_foreign_exam_s_report_cards_is_a_404(self) -> None:
        self.assert404(self.client.post(f"{EXAMS}/{self.foreign_exam.pk}:generate-report-cards"))

    def test_publishing_a_foreign_exam_s_report_cards_is_a_404(self) -> None:
        self.assert404(self.client.post(f"{EXAMS}/{self.foreign_exam.pk}:publish-report-cards"))
