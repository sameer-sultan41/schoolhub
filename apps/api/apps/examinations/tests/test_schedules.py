"""§5.2's sittings and the clash engine — models, detectors, and publish.

The engine gets the bulk of these cases, and deliberately: it is the piece a
school actually leans on (§8's journey is "resolves the two room clashes the
checker flags"), and it is the piece with no database constraint standing behind
most of what it reports. The two partial uniques catch only an exact-duplicate
race; everything about *overlap* lives here or nowhere.
"""

from __future__ import annotations

import datetime
from unittest import mock

from django.db import IntegrityError, connection, transaction
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from apps.examinations import conflicts, services
from apps.examinations.models import ExamSchedule, ExamStatus, ScheduleStatus
from apps.examinations.tests.base import ExaminationsAPITestCase
from apps.examinations.tests.factories import (
    AFTERNOON,
    MORNING,
    AcademicSessionFactory,
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
from core.tenancy.locks import AdvisoryLockNamespace, advisory_lock_key


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

        # Exact equality, not a tolerance: `calendar.working_day_map` reads the
        # configuration once for the whole exam, so extra dates cost nothing
        # either. A tolerance here would have hidden the two-queries-per-date
        # cost the first fix still had.
        self.assertEqual(
            len(larger.captured_queries),
            len(small.captured_queries),
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

    def test_an_exam_past_scheduled_cannot_be_published_again(self) -> None:
        """Re-publishing a `marks_entry` exam would move it back to
        `scheduled` and reopen a timetable students have already sat."""
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)
            self.exam.status = ExamStatus.MARKS_ENTRY
            self.exam.save(update_fields=["status"])

        response = self.client.post(f"/api/v1/exams/{self.exam.pk}:publish-schedule")

        self.assertEqual(response.status_code, 409, response.json())
        with tenant_context(self.tenant.id):
            self.exam.refresh_from_db()
        self.assertEqual(self.exam.status, ExamStatus.MARKS_ENTRY)

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


class SittingWriteLockTests(ScheduleTestCase):
    """Every sitting write takes the school's schedule lock, then its exam's,
    as `:publish-schedule` does.

    Publish reads the clash list, other exams' sittings included, under the
    school lock; a sitting write that did not take it could commit after that
    read, and the exam went to `scheduled` over a hard clash publish never saw.
    Asserted on the SQL issued, as `fees_finance` `ConcurrencyTests` does: a
    real race needs two connections.
    """

    URL = ScheduleEndpointTests.URL
    # Borrowed rather than inherited, so the endpoint cases do not run twice.
    _payload = ScheduleEndpointTests._payload

    def _exam_locks_before_the_write(self, captured, write_sql: str) -> list[str]:
        sql = [query["sql"] for query in captured.captured_queries]
        write_at = next(i for i, q in enumerate(sql) if q.startswith(write_sql))
        exam_locks = [i for i, q in enumerate(sql[:write_at]) if _is_exam_lock(q)]
        self.assert_school_lock_first(sql, before=exam_locks[0] if exam_locks else write_at)
        return [sql[i] for i in exam_locks]

    def assert_school_lock_first(self, sql: list[str], *, before: int) -> None:
        """The school's schedule lock is taken once, ahead of index `before`."""
        locks = [i for i, q in enumerate(sql) if _is_school_schedule_lock(q, self.tenant.pk)]
        self.assertEqual(len(locks), 1, "expected one school schedule lock")
        self.assertLess(locks[0], before)

    def test_create_locks_the_exam_before_saving(self) -> None:
        with CaptureQueriesContext(connection) as captured:
            response = self.client.post(self.URL, self._payload(), format="json")

        self.assertEqual(response.status_code, 201, response.json())
        locks = self._exam_locks_before_the_write(captured, 'INSERT INTO "exam_schedules"')
        self.assertEqual(len(locks), 1)
        self.assertIn(self.exam.pk.hex, locks[0])

    def test_update_locks_the_exam_before_saving(self) -> None:
        with tenant_context(self.tenant.id):
            sitting = self.sitting()

        with CaptureQueriesContext(connection) as captured:
            response = self.client.patch(
                f"{self.URL}/{sitting.pk}", {"room_id": str(self.room.pk)}, format="json"
            )

        self.assertEqual(response.status_code, 200, response.json())
        locks = self._exam_locks_before_the_write(captured, 'UPDATE "exam_schedules"')
        self.assertEqual(len(locks), 1)
        self.assertIn(self.exam.pk.hex, locks[0])

    def test_moving_a_sitting_to_another_exam_locks_both(self) -> None:
        with tenant_context(self.tenant.id):
            sitting = self.sitting()
            other_exam = ExamFactory(
                tenant=self.tenant, academic_session=self.session, grading_scale=self.scale
            )
            other_subject = ExamSubjectFactory(
                tenant=self.tenant,
                exam=other_exam,
                school_class=self.school_class,
                subject=self.subject,
            )
        exam_week(self.tenant, other_exam)

        with CaptureQueriesContext(connection) as captured:
            response = self.client.patch(
                f"{self.URL}/{sitting.pk}",
                {"exam_subject_id": str(other_subject.pk)},
                format="json",
            )

        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["data"]["exam_id"], str(other_exam.pk))
        locks = self._exam_locks_before_the_write(captured, 'UPDATE "exam_schedules"')
        self.assertEqual(len(locks), 1)
        self.assertIn(self.exam.pk.hex, locks[0])
        self.assertIn(other_exam.pk.hex, locks[0])

    def test_delete_locks_the_exam_before_deleting(self) -> None:
        with tenant_context(self.tenant.id):
            sitting = self.sitting()

        with CaptureQueriesContext(connection) as captured:
            response = self.client.delete(f"{self.URL}/{sitting.pk}")

        self.assertEqual(response.status_code, 204)
        locks = self._exam_locks_before_the_write(captured, 'UPDATE "exam_schedules"')
        self.assertEqual(len(locks), 1)
        self.assertIn(self.exam.pk.hex, locks[0])

    def test_cancelling_takes_the_school_lock_before_saving(self) -> None:
        with tenant_context(self.tenant.id):
            sitting = self.sitting()

        with CaptureQueriesContext(connection) as captured:
            response = self.client.patch(
                f"{self.URL}/{sitting.pk}", {"status": ScheduleStatus.CANCELLED}, format="json"
            )

        self.assertEqual(response.status_code, 200, response.json())
        locks = self._exam_locks_before_the_write(captured, 'UPDATE "exam_schedules"')
        self.assertEqual(len(locks), 1)
        self.assertIn(self.exam.pk.hex, locks[0])

    def test_publishing_takes_the_school_lock_before_the_exam_lock(self) -> None:
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)

        with CaptureQueriesContext(connection) as captured:
            response = self.client.post(f"/api/v1/exams/{self.exam.pk}:publish-schedule")

        self.assertEqual(response.status_code, 200, response.json())
        sql = [query["sql"] for query in captured.captured_queries]
        exam_lock_at = next(i for i, q in enumerate(sql) if _is_exam_lock(q))
        self.assertIn(self.exam.pk.hex, sql[exam_lock_at])
        self.assert_school_lock_first(sql, before=exam_lock_at)


class SittingStaleReadTests(ScheduleTestCase):
    """The state check runs on the row re-read under the school lock, not on
    the one the view read before it.

    A cancel committed between the view's read and the lock is simulated by
    writing it inside the school-lock call, the first step under the lock. That
    write shares the request's transaction, so the 409 rolls it back too: the
    proof is the refusal and that the stale write never landed.
    """

    URL = ScheduleEndpointTests.URL

    def _cancel_when_the_lock_is_taken(self, sitting):
        real_lock = services.lock_school_schedule

        def lock_then_cancel(tenant_id) -> None:
            real_lock(tenant_id)
            ExamSchedule.objects.filter(pk=sitting.pk).update(status=ScheduleStatus.CANCELLED)

        return mock.patch.object(services, "lock_school_schedule", side_effect=lock_then_cancel)

    def test_a_patch_read_before_a_cancel_does_not_write_scheduled_back(self) -> None:
        with tenant_context(self.tenant.id):
            sitting = self.sitting()

        with self._cancel_when_the_lock_is_taken(sitting):
            response = self.client.patch(
                f"{self.URL}/{sitting.pk}", {"room_id": str(self.room.pk)}, format="json"
            )

        self.assertEqual(response.status_code, 409, response.json())
        with tenant_context(self.tenant.id):
            sitting.refresh_from_db()
        self.assertIsNone(sitting.room_id)

    def test_a_delete_read_before_a_cancel_leaves_the_sitting(self) -> None:
        with tenant_context(self.tenant.id):
            sitting = self.sitting()

        with self._cancel_when_the_lock_is_taken(sitting):
            response = self.client.delete(f"{self.URL}/{sitting.pk}")

        self.assertEqual(response.status_code, 409, response.json())
        with tenant_context(self.tenant.id):
            sitting.refresh_from_db()
        self.assertIsNone(sitting.deleted_at)

    def test_update_re_reads_the_sitting_after_the_school_lock(self) -> None:
        with tenant_context(self.tenant.id):
            sitting = self.sitting()

        with CaptureQueriesContext(connection) as captured:
            response = self.client.patch(
                f"{self.URL}/{sitting.pk}", {"room_id": str(self.room.pk)}, format="json"
            )

        self.assertEqual(response.status_code, 200, response.json())
        sql = [query["sql"] for query in captured.captured_queries]
        school_lock = next(
            i for i, q in enumerate(sql) if _is_school_schedule_lock(q, self.tenant.pk)
        )
        re_read = next(
            i for i, q in enumerate(sql) if "FOR UPDATE" in q and '"exam_schedules"' in q
        )
        write = next(i for i, q in enumerate(sql) if q.startswith('UPDATE "exam_schedules"'))
        self.assertLess(school_lock, re_read)
        self.assertLess(re_read, write)


def _is_exam_lock(query: str) -> bool:
    # A lock *on* the exam row, not a FOR UPDATE OF another table that joins `exams`.
    return "FOR UPDATE" in query and 'FROM "exams"' in query


def _is_school_schedule_lock(query: str, tenant_id) -> bool:
    # The two-int advisory lock: (namespace, int4 derived from the tenant id).
    namespace = int(AdvisoryLockNamespace.EXAM_SCHEDULE)
    key = advisory_lock_key(tenant_id)
    return "pg_advisory_xact_lock" in query and f"({namespace}, {key})" in query


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


class ScheduleConflictsEndpointTests(ScheduleTestCase):
    """`GET /exams/{id}/schedule-conflicts` — the engine's list on a fresh read.

    A client opening the schedule has to see what publishing would refuse
    without saving a sitting first, and without re-deriving §11's rules itself.
    """

    def url(self, exam=None) -> str:
        return f"/api/v1/exams/{(exam or self.exam).pk}/schedule-conflicts"

    def test_the_list_carries_hard_and_soft_findings_hard_first(self) -> None:
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            # Three students into a one-seat room: soft. The same room again,
            # overlapping, for the other section: hard.
            tiny = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=1)
            self.sitting(room=tiny)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day,
                room=tiny,
                start_time=datetime.time(10, 0),
                end_time=datetime.time(12, 0),
            )

        response = self.client.get(self.url())

        self.assertEqual(response.status_code, 200, response.json())
        found = response.json()["data"]
        self.assertEqual(
            {(row["type"], row["severity"]) for row in found},
            {
                (conflicts.ROOM_DOUBLE_BOOKED, "hard"),
                (conflicts.ROOM_OVER_CAPACITY, "soft"),
            },
        )
        severities = [row["severity"] for row in found]
        self.assertEqual(severities, sorted(severities, key=lambda value: value != "hard"))
        self.assertEqual(len(found[0]["schedule_ids"]), 2)

    def test_a_cancelled_sitting_is_left_out_of_the_list(self) -> None:
        """A room freed by a cancellation is free, on this read as in the engine."""
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

        response = self.client.get(self.url())

        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["data"], [])

    def test_the_list_is_the_same_one_publishing_refuses_with(self) -> None:
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

        listed = self.client.get(self.url()).json()["data"]
        refused = self.client.post(f"/api/v1/exams/{self.exam.pk}:publish-schedule")

        self.assertEqual(refused.status_code, 422, refused.json())
        self.assertEqual(refused.json()["error"]["meta"]["conflicts"], listed)

    def test_a_restricted_principal_cannot_read_the_list(self) -> None:
        """Staff-only: a clash list names rooms, invigilators and other
        sections, which a portal reader holding the schedule key has no use for."""
        from rest_framework.test import APIClient

        from apps.examinations.tests.factories import UserFactory, authenticate, grant
        from core.rbac.models import RecordScope

        with tenant_context(self.tenant.id):
            student_user = UserFactory(tenant=self.tenant)
        grant(
            student_user,
            "exams.schedule.view",
            scope=RecordScope.ALL,
            is_restricted_principal=True,
        )
        client = APIClient()
        authenticate(client, student_user)

        self.assertEqual(client.get(self.url()).status_code, 403)

    def test_the_list_needs_the_schedule_view_key(self) -> None:
        from rest_framework.test import APIClient

        from apps.examinations.tests.factories import UserFactory, authenticate, grant
        from core.rbac.models import RecordScope

        viewer = UserFactory(tenant=self.tenant)
        grant(viewer, "exams.exam.view", scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, viewer)

        self.assertEqual(client.get(self.url()).status_code, 403)

    def test_the_list_costs_the_same_for_one_sitting_or_three(self) -> None:
        with tenant_context(self.tenant.id):
            self.sitting(
                room=self.room,
                invigilator_staff=StaffFactory(tenant=self.tenant, campus=self.campus),
            )
        # Warm the per-user permission caches, so the baseline counts the
        # action's own queries and not a cold first request.
        self.client.get(self.url())
        with CaptureQueriesContext(connection) as baseline:
            self.assertEqual(self.client.get(self.url()).status_code, 200)

        for offset, config in ((1, self.second_subject()), (2, self.third_subject())):
            with tenant_context(self.tenant.id):
                ExamScheduleFactory(
                    tenant=self.tenant,
                    exam_subject=config,
                    section=self.other_section,
                    exam_date=self.day + datetime.timedelta(days=offset),
                    room=RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40),
                    invigilator_staff=StaffFactory(tenant=self.tenant, campus=self.campus),
                )

        with self.assertNumQueries(len(baseline)):
            self.assertEqual(self.client.get(self.url()).status_code, 200)


class ExamLookupScopeTests(ScheduleTestCase):
    """The exam an action addresses by id resolves through `ExamViewSet`'s
    record scope, under the hosting view's read key and the route's own: out of
    scope is a 404, as a foreign id is."""

    def client_for(self, user, *keys: str):
        from rest_framework.test import APIClient

        from apps.examinations.tests.factories import authenticate, grant
        from core.rbac.models import RecordScope

        grant(user, *keys, scope=RecordScope.ASSIGNED)
        client = APIClient()
        authenticate(client, user)
        return client

    def unassigned_teacher(self):
        from apps.examinations.tests.factories import UserFactory

        with tenant_context(self.tenant.id):
            user = UserFactory(tenant=self.tenant)
            StaffFactory(tenant=self.tenant, campus=self.campus, user_id=user.pk)
        return user

    def test_an_unallocated_teacher_gets_a_404_for_the_clash_list(self) -> None:
        client = self.client_for(self.unassigned_teacher(), "exams.schedule.view")

        response = client.get(f"/api/v1/exams/{self.exam.pk}/schedule-conflicts")

        self.assertEqual(response.status_code, 404)

    def test_an_allocated_teacher_gets_the_clash_list(self) -> None:
        client = self.client_for(self.subject_teacher_user, "exams.schedule.view")

        response = client.get(f"/api/v1/exams/{self.exam.pk}/schedule-conflicts")

        self.assertEqual(response.status_code, 200, response.json())

    def test_an_unallocated_teacher_gets_a_404_publishing(self) -> None:
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)
        client = self.client_for(
            self.unassigned_teacher(), "exams.schedule.view", "exams.schedule.update"
        )

        response = client.post(f"/api/v1/exams/{self.exam.pk}:publish-schedule")

        self.assertEqual(response.status_code, 404)
        with tenant_context(self.tenant.id):
            self.exam.refresh_from_db()
        self.assertEqual(self.exam.status, ExamStatus.DRAFT)

    def test_a_colon_action_cannot_reach_an_exam_its_view_role_hides(self) -> None:
        """L36's mixed user: the view key on an unallocated `assigned` role, the
        action key at `all`. The route reaches the exam under both, so a 404."""
        from apps.examinations.tests.factories import grant
        from core.rbac.models import RecordScope

        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)
        user = self.unassigned_teacher()
        grant(user, "exams.schedule.update", scope=RecordScope.ALL)
        client = self.client_for(user, "exams.schedule.view")

        response = client.post(f"/api/v1/exams/{self.exam.pk}:publish-schedule")

        self.assertEqual(response.status_code, 404)
        with tenant_context(self.tenant.id):
            self.exam.refresh_from_db()
        self.assertEqual(self.exam.status, ExamStatus.DRAFT)

    def test_schedule_conflicts_stays_readable_to_schedule_readers(self) -> None:
        """The lookup reads under the hosting view's key, not `ExamViewSet`'s, so a
        schedule reader without `exams.exam.view` keeps the clash list."""
        from rest_framework.test import APIClient

        from apps.examinations.tests.factories import UserFactory, authenticate, grant

        with tenant_context(self.tenant.id):
            user = UserFactory(tenant=self.tenant)
        grant(user, "exams.schedule.view")
        client = APIClient()
        authenticate(client, user)

        response = client.get(f"/api/v1/exams/{self.exam.pk}/schedule-conflicts")

        self.assertEqual(response.status_code, 200, response.json())


class PublishScheduleContractTests(ScheduleTestCase):
    def test_a_successful_publish_answers_status_and_conflicts(self) -> None:
        """The body `ExamSchedulePublishSerializer` documents, not a list of
        sittings."""
        with tenant_context(self.tenant.id):
            tiny = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=1)
            self.sitting(room=tiny)

        response = self.client.post(f"/api/v1/exams/{self.exam.pk}:publish-schedule")

        self.assertEqual(response.status_code, 200, response.json())
        data = response.json()["data"]
        self.assertEqual(set(data), {"status", "conflicts"})
        self.assertEqual(data["status"], ExamStatus.SCHEDULED)
        self.assertEqual([row["severity"] for row in data["conflicts"]], ["soft"])


class ScheduleNamesTests(ScheduleTestCase):
    URL = "/api/v1/exam-schedules"

    def test_a_listed_sitting_carries_every_name_a_row_renders(self) -> None:
        with tenant_context(self.tenant.id):
            invigilator = StaffFactory(tenant=self.tenant, campus=self.campus)
            self.sitting(room=self.room, invigilator_staff=invigilator)

        response = self.client.get(f"{self.URL}?exam_id={self.exam.pk}")

        self.assertEqual(response.status_code, 200, response.json())
        row = response.json()["data"][0]
        self.assertEqual(row["exam_id"], str(self.exam.pk))
        self.assertEqual(row["exam_name"], self.exam.name)
        self.assertEqual(row["subject_name"], self.subject.name)
        self.assertEqual(row["class_name"], self.school_class.name)
        self.assertEqual(row["section_name"], self.section.name)
        self.assertEqual(row["room_name"], self.room.name)
        self.assertEqual(row["invigilator_name"], invigilator.full_name)

    def test_a_sitting_with_no_room_or_invigilator_names_neither(self) -> None:
        with tenant_context(self.tenant.id):
            self.sitting()

        row = self.client.get(self.URL).json()["data"][0]

        self.assertIsNone(row["room_name"])
        self.assertIsNone(row["invigilator_name"])

    def test_a_created_sitting_answers_with_its_names_too(self) -> None:
        """The single-object path, which never passed through the list's joins."""
        response = self.client.post(
            self.URL,
            {
                "exam_subject_id": str(self.exam_subject.pk),
                "section_id": str(self.section.pk),
                "exam_date": str(self.day),
                "start_time": "09:00",
                "end_time": "11:00",
                "room_id": str(self.room.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.json())
        data = response.json()["data"]
        self.assertEqual(data["exam_id"], str(self.exam.pk))
        self.assertEqual(data["subject_name"], self.subject.name)
        self.assertEqual(data["room_name"], self.room.name)

    def test_the_list_does_not_query_per_sitting(self) -> None:
        """Every name rides on `select_related`: more sittings, each with its
        own room, invigilator and subject, must not change the count."""
        with tenant_context(self.tenant.id):
            self.sitting(
                room=self.room,
                invigilator_staff=StaffFactory(tenant=self.tenant, campus=self.campus),
            )
        # Warm the per-user permission caches, so the baseline counts the
        # list's own queries and not a cold first request.
        self.client.get(self.URL)
        with CaptureQueriesContext(connection) as baseline:
            self.assertEqual(self.client.get(self.URL).status_code, 200)

        for config in (self.second_subject(), self.third_subject()):
            with tenant_context(self.tenant.id):
                ExamScheduleFactory(
                    tenant=self.tenant,
                    exam_subject=config,
                    section=self.other_section,
                    exam_date=self.day,
                    room=RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40),
                    invigilator_staff=StaffFactory(tenant=self.tenant, campus=self.campus),
                )

        with self.assertNumQueries(len(baseline)):
            response = self.client.get(self.URL)

        self.assertEqual(len(response.json()["data"]), 3)


class ScheduleAssignedScopeTests(ScheduleTestCase):
    """§4's `assigned` on sittings: what a teacher teaches, homerooms or invigilates."""

    URL = "/api/v1/exam-schedules"

    def setUp(self) -> None:
        super().setUp()
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            # The fixture's allocation: this section, this subject, this session.
            self.taught = self.sitting(room=self.room)
            # Same subject, another section: not the subject teacher's.
            self.other_section_paper = self.sitting(section=self.other_section)
            # Another subject in the homeroom: the class teacher's, not the
            # subject teacher's.
            self.homeroom_paper = self.sitting(
                exam_subject=other, start_time=AFTERNOON[0], end_time=AFTERNOON[1]
            )

    def listed_as(self, user) -> set[str]:
        from apps.examinations.tests.factories import authenticate, grant
        from core.rbac.models import RecordScope

        grant(user, "exams.schedule.view", scope=RecordScope.ASSIGNED)
        authenticate(self.client, user)
        response = self.client.get(self.URL)
        self.assertEqual(response.status_code, 200, response.json())
        return {row["id"] for row in response.json()["data"]}

    def test_a_subject_teacher_sees_the_sittings_of_what_they_teach(self) -> None:
        self.assertEqual(self.listed_as(self.subject_teacher_user), {str(self.taught.pk)})

    def test_a_subject_teacher_also_sees_what_they_invigilate(self) -> None:
        with tenant_context(self.tenant.id):
            self.other_section_paper.invigilator_staff = self.subject_teacher
            self.other_section_paper.save(update_fields=["invigilator_staff"])

        self.assertEqual(
            self.listed_as(self.subject_teacher_user),
            {str(self.taught.pk), str(self.other_section_paper.pk)},
        )

    def test_an_end_dated_allocation_hides_the_sitting(self) -> None:
        with tenant_context(self.tenant.id):
            self.allocation.effective_to = self.session.end_date
            self.allocation.save(update_fields=["effective_to", "updated_at"])

        self.assertEqual(self.listed_as(self.subject_teacher_user), set())

    def test_an_allocation_in_another_session_hides_the_sitting(self) -> None:
        from apps.academics.models import TeacherSubjectAllocation

        with tenant_context(self.tenant.id):
            last_year = AcademicSessionFactory(tenant=self.tenant)
            TeacherSubjectAllocation.objects.filter(pk=self.allocation.pk).update(
                academic_session=last_year
            )

        self.assertEqual(self.listed_as(self.subject_teacher_user), set())

    def test_a_homeroom_whose_enrollments_are_in_another_session_hides_it(self) -> None:
        from apps.student_management.models import StudentEnrollment

        with tenant_context(self.tenant.id):
            last_year = AcademicSessionFactory(tenant=self.tenant)
            StudentEnrollment.objects.filter(section=self.section).update(
                academic_session=last_year
            )

        self.assertEqual(self.listed_as(self.teacher_user), set())

    def test_a_class_teacher_sees_every_sitting_of_their_homeroom(self) -> None:
        self.assertEqual(
            self.listed_as(self.teacher_user),
            {str(self.taught.pk), str(self.homeroom_paper.pk)},
        )


class FixtureArithmeticTests(TestCase):
    def test_the_morning_and_afternoon_windows_do_not_overlap(self) -> None:
        """The fixtures' own arithmetic. Several cases above assert "no clash"
        using these two windows, and would pass vacuously if they overlapped.
        """
        self.assertLessEqual(MORNING[1], AFTERNOON[0])
