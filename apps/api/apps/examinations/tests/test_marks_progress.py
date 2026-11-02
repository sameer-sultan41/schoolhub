"""The marks reads around the grid: the view key, `/marks`, progress, lock and the reminder.

Each is narrowed per section by `services.may_enter_marks`, as the grid is
(`test_marks_grid.py`).
"""

from __future__ import annotations

from unittest import mock

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from apps.examinations.models import MarksStatus
from apps.examinations.tasks import remind_tenant_marks_entry
from apps.examinations.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    SectionFactory,
    StaffFactory,
    TeacherAllocationFactory,
    UserFactory,
)
from apps.examinations.tests.test_marks import MARKS
from apps.examinations.tests.test_marks_grid import GridTestCase
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context


class MarksViewKeyTests(GridTestCase):
    def test_the_view_key_has_the_default_roles(self) -> None:
        from core.rbac.registry import registry

        spec = next(spec for spec in registry.all() if spec.key == "exams.marks.view")

        self.assertEqual(
            set(spec.default_roles),
            {
                "teacher",
                "class_teacher",
                "exam_staff",
                "school_admin",
                "principal",
                "vice_principal",
            },
        )

    def test_a_view_only_reader_lists_marks_and_progress(self) -> None:
        """What `principal` and `school_admin` hold: the view key, no entry key."""
        self.submit()
        for scope in (RecordScope.ALL, RecordScope.CAMPUS):
            with self.subTest(scope=scope):
                with tenant_context(self.tenant.id):
                    reader = UserFactory(tenant=self.tenant)
                client = self.client_for(
                    reader,
                    "exams.marks.view",
                    scope=scope,
                    scope_ref=self.campus.pk if scope == RecordScope.CAMPUS else None,
                )

                listed = client.get(MARKS, {"exam_subject_id": str(self.exam_subject.pk)})
                progress = client.get(f"/api/v1/exams/{self.exam.pk}/marks-progress")

                self.assertEqual(listed.status_code, status.HTTP_200_OK, listed.json())
                self.assertEqual(len(listed.json()["data"]), 3)
                self.assertEqual(progress.status_code, status.HTTP_200_OK, progress.json())
                self.assertEqual(len(progress.json()["data"]), 1)

    def test_marks_filter_by_section(self) -> None:
        self.submit()
        outsider = self.enrol(self.other_section)
        self.submit(
            [{"student_id": str(outsider.pk), "theory_marks": "50.00"}], section=self.other_section
        )

        response = self.client.get(MARKS, {"section_id": str(self.other_section.pk)})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual([row["student_id"] for row in response.json()["data"]], [str(outsider.pk)])

    def test_a_campus_read_follows_the_section_s_campus(self) -> None:
        """Not the student's own campus: the same campus `may_enter_marks` checks."""
        with tenant_context(self.tenant.id):
            far_campus = CampusFactory(tenant=self.tenant)
            far_section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=far_campus
            )
        # Student on the far campus, seated in a home-campus section; and the reverse.
        visiting = self.enrol(self.section)
        with tenant_context(self.tenant.id):
            visiting.campus = far_campus
            visiting.save(update_fields=["campus"])
        away = self.enrol(far_section)
        self.submit([{"student_id": str(visiting.pk), "theory_marks": "50.00"}])
        self.submit([{"student_id": str(away.pk), "theory_marks": "50.00"}], section=far_section)
        with tenant_context(self.tenant.id):
            reader = UserFactory(tenant=self.tenant)
        client = self.client_for(
            reader, "exams.marks.view", scope=RecordScope.CAMPUS, scope_ref=self.campus.pk
        )

        listed = {row["student_id"] for row in client.get(MARKS).json()["data"]}

        self.assertIn(str(visiting.pk), listed)
        self.assertNotIn(str(away.pk), listed)


class ProgressBySectionTests(GridTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.outsider = self.enrol(self.other_section)
        self.submit(self.entries(status=MarksStatus.SUBMITTED))

    def progress(self, client=None):
        response = (client or self.client).get(f"/api/v1/exams/{self.exam.pk}/marks-progress")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return {row["section_id"]: row for row in response.json()["data"]}

    def test_one_row_per_section_with_its_own_counts(self) -> None:
        rows = self.progress()

        self.assertEqual(set(rows), {str(self.section.pk), str(self.other_section.pk)})
        own = rows[str(self.section.pk)]
        self.assertEqual(
            {key: own[key] for key in ("expected", "entered", "submitted", "is_locked")},
            {"expected": 3, "entered": 3, "submitted": 1, "is_locked": False},
        )
        self.assertEqual(own["section_name"], self.section.name)
        self.assertEqual(own["exam_subject_id"], str(self.exam_subject.pk))
        other = rows[str(self.other_section.pk)]
        self.assertEqual((other["expected"], other["entered"]), (1, 0))

    def test_an_assigned_caller_sees_only_their_sections(self) -> None:
        client = self.client_for(self.subject_teacher_user, "exams.marks.view")

        self.assertEqual(set(self.progress(client)), {str(self.section.pk)})

    def test_progress_of_an_exam_outside_the_caller_s_scope_is_a_404(self) -> None:
        with tenant_context(self.tenant.id):
            stranger = UserFactory(tenant=self.tenant)
        client = self.client_for(stranger, "exams.marks.view")

        response = client.get(f"/api/v1/exams/{self.exam.pk}/marks-progress")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_progress_is_a_flat_number_of_queries(self) -> None:
        def count() -> int:
            with CaptureQueriesContext(connection) as captured:
                self.progress()
            return len(captured.captured_queries)

        count()  # Warm the permission and scope caches.
        small = count()
        self.second_subject()
        with tenant_context(self.tenant.id):
            SectionFactory(tenant=self.tenant, school_class=self.school_class, campus=self.campus)
        self.enrol(self.other_section)

        self.assertEqual(count(), small)


class LockScopeTests(GridTestCase):
    def test_locking_or_unlocking_an_out_of_scope_exam_subject_is_a_404(self) -> None:
        """L34: the exam-subject resolves through its record scope, not by bare id."""
        with tenant_context(self.tenant.id):
            stranger = UserFactory(tenant=self.tenant)
        client = self.client_for(stranger, "exams.marks.lock")

        for action in ("lock-marks", "unlock-marks"):
            with self.subTest(action=action):
                response = client.post(f"/api/v1/exam-subjects/{self.exam_subject.pk}:{action}")
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.tenant.id):
            self.exam_subject.refresh_from_db()
        self.assertIsNone(self.exam_subject.marks_locked_at)

    def test_an_assigned_locker_reaches_their_own_exam_subject(self) -> None:
        client = self.client_for(self.subject_teacher_user, "exams.marks.lock")

        response = client.post(f"/api/v1/exam-subjects/{self.exam_subject.pk}:lock-marks")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())


class MarksEntryReminderTests(GridTestCase):
    """One reminder per outstanding section, to that section's teacher in the exam's session."""

    def setUp(self) -> None:
        super().setUp()
        self.enrol(self.other_section)
        with tenant_context(self.tenant.id):
            self.other_teacher_user = UserFactory(tenant=self.tenant)
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=StaffFactory(
                    tenant=self.tenant, campus=self.campus, user_id=self.other_teacher_user.pk
                ),
            )
            # Same section and subject, last session: must not be reminded.
            self.former_teacher_user = UserFactory(tenant=self.tenant)
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=AcademicSessionFactory(tenant=self.tenant, is_current=False),
                section=self.section,
                subject=self.subject,
                staff=StaffFactory(
                    tenant=self.tenant, campus=self.campus, user_id=self.former_teacher_user.pk
                ),
            )

    def remind(self) -> list:
        with mock.patch("core.notifications.services.notify") as notify:
            remind_tenant_marks_entry(self.tenant.id)
        return notify.call_args_list

    def test_each_section_reminds_only_its_own_current_teacher(self) -> None:
        calls = self.remind()

        sent = {
            call.kwargs["context"]["class.name"]: [r.user_id for r in call.kwargs["recipients"]]
            for call in calls
        }
        self.assertEqual(
            sent,
            {
                f"{self.school_class.name} {self.section.name}": [self.subject_teacher_user.pk],
                f"{self.school_class.name} {self.other_section.name}": [self.other_teacher_user.pk],
            },
        )
        self.assertNotIn(
            self.former_teacher_user.pk,
            {r.user_id for call in calls for r in call.kwargs["recipients"]},
        )

    def test_a_section_with_every_mark_submitted_is_not_reminded(self) -> None:
        self.submit([{**entry, "status": MarksStatus.SUBMITTED} for entry in self.entries()])

        sections = {call.kwargs["context"]["class.name"] for call in self.remind()}

        self.assertEqual(sections, {f"{self.school_class.name} {self.other_section.name}"})

    def test_the_sweep_reads_allocations_once_per_exam(self) -> None:
        """A third outstanding section adds a reminder, not a query."""
        self.remind()  # warm any one-time cost so both counts compare like for like
        with CaptureQueriesContext(connection) as captured:
            self.remind()
        two_sections = len(captured.captured_queries)
        with tenant_context(self.tenant.id):
            third = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=third,
                subject=self.subject,
                staff=StaffFactory(
                    tenant=self.tenant,
                    campus=self.campus,
                    user_id=UserFactory(tenant=self.tenant).pk,
                ),
            )
        self.enrol(third)

        with self.assertNumQueries(two_sections):
            self.assertEqual(len(self.remind()), 3)
