"""§5.2's sittings and the clash engine — models, detectors, and publish.

The engine gets the bulk of these cases, and deliberately: it is the piece a
school actually leans on (§8's journey is "resolves the two room clashes the
checker flags"), and it is the piece with no database constraint standing behind
most of what it reports. The two partial uniques catch only an exact-duplicate
race; everything about *overlap* lives here or nowhere.
"""

from __future__ import annotations

import datetime

from django.db import IntegrityError, connection, transaction
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from apps.examinations import conflicts
from apps.examinations.models import ExamStatus, ScheduleStatus
from apps.examinations.tests.base import ExaminationsAPITestCase
from apps.examinations.tests.factories import (
    AFTERNOON,
    MORNING,
    ClassSubjectFactory,
    ExamFactory,
    ExamScheduleFactory,
    ExamSubjectFactory,
    RoomFactory,
    SectionFactory,
    StaffFactory,
    StudentEnrollmentFactory,
    SubjectFactory,
    exam_week,
)
from core.tenancy.context import tenant_context


class ScheduleTestCase(ExaminationsAPITestCase):
    """One exam with a real date window, one subject configured, one room."""

    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        with tenant_context(self.tenant.id):
            self.exam = ExamFactory(
                tenant=self.tenant, academic_session=self.session, grading_scale=self.scale
            )
            self.exam_subject = ExamSubjectFactory(
                tenant=self.tenant,
                exam=self.exam,
                school_class=self.school_class,
                subject=self.subject,
            )
            self.room = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40)
        self.day = exam_week(self.tenant, self.exam)

    def sitting(self, **kwargs):
        defaults = {
            "tenant": self.tenant,
            "exam_subject": self.exam_subject,
            "section": self.section,
            "exam_date": self.day,
        }
        defaults.update(kwargs)
        return ExamScheduleFactory(**defaults)

    def second_subject(self):
        """A second paper for the same class, so one section can double-book."""
        return self._extra_subject()

    def third_subject(self):
        """A third, for the query-count test's extra dates."""
        return self._extra_subject()

    def _extra_subject(self):
        with tenant_context(self.tenant.id):
            subject = SubjectFactory(tenant=self.tenant)
            ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=subject,
            )
            return ExamSubjectFactory(
                tenant=self.tenant,
                exam=self.exam,
                school_class=self.school_class,
                subject=subject,
            )


class ScheduleConstraintTests(ScheduleTestCase):
    def test_one_sitting_per_exam_subject_per_section(self) -> None:
        with tenant_context(self.tenant.id):
            self.sitting()

        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            self.sitting()

    def test_a_sitting_ending_before_it_starts_is_refused(self) -> None:
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            self.sitting(start_time=datetime.time(11, 0), end_time=datetime.time(9, 0))

    def test_a_room_cannot_hold_two_sittings_starting_at_the_same_moment(self) -> None:
        """The exact-duplicate race the constraint exists for. Overlap in
        general is `conflicts`' job — no constraint can express it."""
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)

        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day,
                room=self.room,
            )

    def test_a_cancelled_sitting_frees_its_room_at_the_database(self) -> None:
        """`cancelled` is excluded from the occupancy constraint, because a room
        freed by a cancellation is free — which is why cancellation is a status
        rather than a soft delete."""
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room, status=ScheduleStatus.CANCELLED)
            replacement = ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day,
                room=self.room,
            )

        self.assertEqual(replacement.room_id, self.room.pk)


class ClashEngineTests(ScheduleTestCase):
    def findings(self, *, of_type: str | None = None) -> list[dict]:
        with tenant_context(self.tenant.id):
            found = conflicts.detect_conflicts(exam=self.exam)
        return [f for f in found if of_type is None or f["type"] == of_type]

    def test_a_clean_schedule_reports_nothing_hard(self) -> None:
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)

        self.assertFalse(conflicts.has_hard_conflicts(self.findings()))

    def test_a_room_booked_across_overlapping_sittings_is_hard(self) -> None:
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day,
                room=self.room,
                start_time=datetime.time(10, 0),
                end_time=datetime.time(12, 0),
            )

        found = self.findings(of_type=conflicts.ROOM_DOUBLE_BOOKED)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["severity"], "hard")
        # Both sides named, so a client highlights both rather than blaming
        # whichever was saved second.
        self.assertEqual(len(found[0]["schedule_ids"]), 2)

    def test_back_to_back_sittings_in_one_room_do_not_clash(self) -> None:
        """Overlap is half-open: a paper ending at 11:00 and one starting at
        11:00 are the normal shape of an exam day. The closed reading would
        report a false conflict on every one of them."""
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day,
                room=self.room,
                start_time=datetime.time(11, 0),
                end_time=datetime.time(13, 0),
            )

        self.assertEqual(self.findings(of_type=conflicts.ROOM_DOUBLE_BOOKED), [])

    def test_a_room_reused_on_a_different_day_does_not_clash(self) -> None:
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day + datetime.timedelta(days=1),
                room=self.room,
            )

        self.assertEqual(self.findings(of_type=conflicts.ROOM_DOUBLE_BOOKED), [])

    def test_an_invigilator_in_two_halls_at_once_is_hard(self) -> None:
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            invigilator = StaffFactory(tenant=self.tenant, campus=self.campus)
            second_room = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40)
            self.sitting(room=self.room, invigilator_staff=invigilator)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day,
                room=second_room,
                invigilator_staff=invigilator,
                start_time=datetime.time(10, 0),
                end_time=datetime.time(12, 0),
            )

        found = self.findings(of_type=conflicts.INVIGILATOR_DOUBLE_BOOKED)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["severity"], "hard")

    def test_one_section_sitting_two_overlapping_papers_is_hard(self) -> None:
        """§11's "no student may have two papers at overlapping times"."""
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            second_room = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40)
            self.sitting(room=self.room)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.section,
                exam_date=self.day,
                room=second_room,
                start_time=datetime.time(10, 0),
                end_time=datetime.time(12, 0),
            )

        found = self.findings(of_type=conflicts.STUDENT_TWO_PAPERS_AT_ONCE)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["severity"], "hard")

    def test_a_student_enrolled_across_two_sections_still_collides(self) -> None:
        """Compared through the *rosters*, not by section identity. A shared
        student between two sections is exactly the case comparing section ids
        would miss while appearing to check it."""
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            second_room = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40)
            elective = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )
            # The same student, additionally enrolled in the elective section.
            # A second enrollment row for a *different* session, so
            # `student_enrollments_unique_per_session` is respected.
            from apps.examinations.tests.factories import AcademicSessionFactory

            other_session = AcademicSessionFactory(tenant=self.tenant)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.students[0],
                academic_session=other_session,
                school_class=self.school_class,
                section=elective,
            )
            self.sitting(room=self.room)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=elective,
                exam_date=self.day,
                room=second_room,
                start_time=datetime.time(10, 0),
                end_time=datetime.time(12, 0),
            )

        found = self.findings(of_type=conflicts.STUDENT_TWO_PAPERS_AT_ONCE)
        self.assertEqual(len(found), 1)

    def test_two_sections_with_no_shared_students_do_not_collide(self) -> None:
        """The control: distinct cohorts sitting different papers at the same
        hour in different rooms is the normal shape of an exam morning."""
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            second_room = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40)
            self.sitting(room=self.room)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day,
                room=second_room,
                start_time=datetime.time(10, 0),
                end_time=datetime.time(12, 0),
            )

        self.assertEqual(self.findings(of_type=conflicts.STUDENT_TWO_PAPERS_AT_ONCE), [])

    def test_a_sitting_outside_the_exam_s_own_dates_is_hard(self) -> None:
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room, exam_date=self.day + datetime.timedelta(days=60))

        found = self.findings(of_type=conflicts.OUTSIDE_EXAM_WINDOW)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["severity"], "hard")

    def test_a_sitting_on_a_configured_holiday_is_hard(self) -> None:
        """Hard rather than soft, because the alternative is a hall of students
        arriving at a locked school. A school genuinely opening for an exam
        edits its calendar, which is a real change rather than an override."""
        from core.tenancy.models import TenantSettings

        with tenant_context(self.tenant.id):
            row, _ = TenantSettings.objects.get_or_create(tenant=self.tenant)
            row.academic = {
                **(row.academic or {}),
                "holidays": [
                    {
                        "start_date": self.day.isoformat(),
                        "end_date": self.day.isoformat(),
                        "name": "Founders Day",
                    }
                ],
            }
            row.save(update_fields=["academic", "updated_at"])
            self.sitting(room=self.room)

        found = self.findings(of_type=conflicts.NOT_A_WORKING_DAY)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["severity"], "hard")
        self.assertIn("Founders Day", found[0]["message"])

    def test_a_cancelled_sitting_participates_in_no_clash(self) -> None:
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room, status=ScheduleStatus.CANCELLED)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day,
                room=self.room,
                start_time=datetime.time(10, 0),
                end_time=datetime.time(12, 0),
            )

        self.assertEqual(self.findings(of_type=conflicts.ROOM_DOUBLE_BOOKED), [])

    def test_an_over_capacity_room_is_soft_not_blocking(self) -> None:
        """§5.2 flags it; a school may intend to split the cohort."""
        with tenant_context(self.tenant.id):
            tiny = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=1)
            self.sitting(room=tiny)

        found = self.findings(of_type=conflicts.ROOM_OVER_CAPACITY)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["severity"], "soft")
        self.assertFalse(conflicts.has_hard_conflicts(self.findings()))

    def test_a_room_with_no_recorded_capacity_is_not_a_finding(self) -> None:
        """An unknown capacity is not a small one, and guessing would make the
        whole list noise."""
        with tenant_context(self.tenant.id):
            unmeasured = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=None)
            self.sitting(room=unmeasured)

        self.assertEqual(self.findings(of_type=conflicts.ROOM_OVER_CAPACITY), [])

    def test_the_engine_does_not_query_per_sitting(self) -> None:
        """The reason `collect_scope` exists, asserted as an **invariant** rather
        than a magic number: doubling the sittings must not change the query
        count. A fixed number would only tell a later reader that something
        moved, and CI already caught the real defect this guards — the
        working-day check called `school_organization.calendar` per row, and
        that module reads `tenant_settings.academic` on every call.
        """
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            second_room = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40)
            self.sitting(room=self.room)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day,
                room=second_room,
                start_time=AFTERNOON[0],
                end_time=AFTERNOON[1],
            )

        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as small:
            conflicts.detect_conflicts(exam=self.exam)

        # Two more sittings on two more days, in two more rooms — every
        # dimension the detectors group by.
        third = self.third_subject()
        with tenant_context(self.tenant.id):
            for offset, subject_config in ((1, third), (2, third)):
                ExamScheduleFactory(
                    tenant=self.tenant,
                    exam_subject=subject_config,
                    section=self.section if offset == 1 else self.other_section,
                    exam_date=self.day + datetime.timedelta(days=offset),
                    room=RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40),
                )

        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as larger:
            conflicts.detect_conflicts(exam=self.exam)

        # The working-day map is keyed by (date, campus), so two extra *dates*
        # legitimately cost two extra calendar reads. What must not grow is the
        # per-sitting cost, which is what this compares.
        self.assertLessEqual(
            len(larger.captured_queries),
            len(small.captured_queries) + 2,
            f"query count grew with sittings: {len(small.captured_queries)} -> "
            f"{len(larger.captured_queries)}",
        )


class PublishScheduleTests(ScheduleTestCase):
    def test_publishing_moves_the_exam_to_scheduled(self) -> None:
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)

        response = self.client.post(f"/api/v1/exams/{self.exam.pk}:publish-schedule")

        self.assertEqual(response.status_code, 200, response.json())
        with tenant_context(self.tenant.id):
            self.exam.refresh_from_db()
        self.assertEqual(self.exam.status, ExamStatus.SCHEDULED)

    def test_publishing_with_a_hard_clash_is_refused_and_lists_every_one(self) -> None:
        """A school fixing one clash at a time discovers the next only after
        saving, which is why the refusal carries the whole list in
        `error.meta.conflicts`."""
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day,
                room=self.room,
                start_time=datetime.time(10, 0),
                end_time=datetime.time(12, 0),
            )

        response = self.client.post(f"/api/v1/exams/{self.exam.pk}:publish-schedule")

        self.assertEqual(response.status_code, 422, response.json())
        body = response.json()["error"]
        self.assertTrue(body["meta"]["conflicts"])
        with tenant_context(self.tenant.id):
            self.exam.refresh_from_db()
        self.assertEqual(self.exam.status, ExamStatus.DRAFT)

    def test_a_soft_clash_does_not_block_publishing(self) -> None:
        with tenant_context(self.tenant.id):
            tiny = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=1)
            self.sitting(room=tiny)

        response = self.client.post(f"/api/v1/exams/{self.exam.pk}:publish-schedule")

        self.assertEqual(response.status_code, 200, response.json())
        self.assertTrue(response.json()["data"]["conflicts"])

    def test_publishing_an_exam_with_no_sittings_is_refused(self) -> None:
        response = self.client.post(f"/api/v1/exams/{self.exam.pk}:publish-schedule")

        self.assertEqual(response.status_code, 422)
        self.assertIn("no sittings scheduled", str(response.json()))


class ScheduleEndpointTests(ScheduleTestCase):
    URL = "/api/v1/exam-schedules"

    def _payload(self, **overrides) -> dict:
        payload = {
            "exam_subject_id": str(self.exam_subject.pk),
            "section_id": str(self.section.pk),
            "exam_date": str(self.day),
            "start_time": "09:00",
            "end_time": "11:00",
            "room_id": str(self.room.pk),
        }
        payload.update(overrides)
        return payload

    def test_creating_a_sitting_returns_the_clash_list_in_meta(self) -> None:
        """§5.2 wants a clash list on every write: a schedule mid-build is
        allowed to be imperfect, and the caller needs to see what is wrong
        without a second request."""
        response = self.client.post(self.URL, self._payload(), format="json")

        self.assertEqual(response.status_code, 201, response.json())
        self.assertIn("conflicts", response.json()["meta"])

    def test_a_section_from_another_class_is_refused(self) -> None:
        """Nothing else stops a Grade 8 paper being scheduled for a Grade 3
        section: both ids are individually valid."""
        with tenant_context(self.tenant.id):
            from apps.examinations.tests.factories import ClassFactory

            other_class = ClassFactory(tenant=self.tenant, level=3)
            stranger = SectionFactory(
                tenant=self.tenant, school_class=other_class, campus=self.campus
            )

        response = self.client.post(
            self.URL, self._payload(section_id=str(stranger.pk)), format="json"
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("not in the class", str(response.json()))

    def test_a_sitting_ending_before_it_starts_is_refused(self) -> None:
        response = self.client.post(
            self.URL, self._payload(start_time="11:00", end_time="09:00"), format="json"
        )

        self.assertEqual(response.status_code, 400)

    def test_a_completed_sitting_cannot_be_rescheduled(self) -> None:
        with tenant_context(self.tenant.id):
            sitting = self.sitting(room=self.room, status=ScheduleStatus.COMPLETED)

        response = self.client.patch(
            f"{self.URL}/{sitting.pk}", {"start_time": "13:00"}, format="json"
        )

        self.assertEqual(response.status_code, 409)

    def test_sittings_filter_by_exam_through_the_exam_subject(self) -> None:
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)

        response = self.client.get(f"{self.URL}?exam_id={self.exam.pk}")

        self.assertEqual(len(response.json()["data"]), 1)

    def test_scheduling_needs_the_create_key_not_just_the_view_key(self) -> None:
        from rest_framework.test import APIClient

        from apps.examinations.tests.factories import UserFactory, authenticate, grant
        from core.rbac.models import RecordScope

        viewer = UserFactory(tenant=self.tenant)
        grant(viewer, "exams.schedule.view", scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, viewer)

        response = client.post(self.URL, self._payload(), format="json")

        self.assertEqual(response.status_code, 403)


class ScheduleRecordScopeTests(ScheduleTestCase):
    def test_a_student_sees_only_their_own_section_s_sittings(self) -> None:
        """§3 gives a student a view of their own exam schedule. The record
        scope, not the permission key, is what narrows them."""
        from rest_framework.test import APIClient

        from apps.examinations.tests.factories import UserFactory, authenticate, grant
        from core.rbac.models import RecordScope

        other = self.second_subject()
        with tenant_context(self.tenant.id):
            second_room = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40)
            mine = self.sitting(room=self.room)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day,
                room=second_room,
                start_time=AFTERNOON[0],
                end_time=AFTERNOON[1],
            )
            student_user = UserFactory(tenant=self.tenant)
            self.students[0].user_id = student_user.pk
            self.students[0].save(update_fields=["user_id"])

        grant(
            student_user,
            "exams.schedule.view",
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )
        client = APIClient()
        authenticate(client, student_user)

        response = client.get("/api/v1/exam-schedules")

        self.assertEqual(response.status_code, 200, response.json())
        ids = {row["id"] for row in response.json()["data"]}
        self.assertEqual(ids, {str(mine.pk)})

    def test_a_restricted_principal_cannot_create_a_sitting(self) -> None:
        """PR #42's lesson applied before the fact: DRF resolves
        `permission_classes` per view, so the portal read exemption has to be
        per-action or it covers the write too."""
        from rest_framework.test import APIClient

        from apps.examinations.tests.factories import UserFactory, authenticate, grant
        from core.rbac.models import RecordScope

        with tenant_context(self.tenant.id):
            student_user = UserFactory(tenant=self.tenant)
        grant(
            student_user,
            "exams.schedule.view",
            "exams.schedule.create",
            scope=RecordScope.ALL,
            is_restricted_principal=True,
        )
        client = APIClient()
        authenticate(client, student_user)

        response = client.post(
            "/api/v1/exam-schedules",
            {
                "exam_subject_id": str(self.exam_subject.pk),
                "section_id": str(self.section.pk),
                "exam_date": str(self.day),
                "start_time": "09:00",
                "end_time": "11:00",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)


class FixtureArithmeticTests(TestCase):
    def test_the_morning_and_afternoon_windows_do_not_overlap(self) -> None:
        """The fixtures' own arithmetic. Several cases above assert "no clash"
        using these two windows, and would pass vacuously if they overlapped.
        """
        self.assertLessEqual(MORNING[1], AFTERNOON[0])
