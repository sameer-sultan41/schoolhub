"""Regressions for PR B's review — seven findings, each pinned by name.

Kept in one file rather than distributed into the suites they belong to, for the
reason `attendance/tests/test_review_findings.py` gives: a reviewer checking
that a finding was actually addressed should not have to hunt for the case, and
three of these describe rules the module now depends on.

Two are worth reading even if the rest are skimmed:

- `PublishPermissionTests` — the same privilege-escalation class as PR #42's
  `:bulk-mark`, in the module whose own docstring warns about it. `publish` was
  missing from the write-action list, so it fell back to the bare *view* key.
- `UnroomedSittingTests` — the null guard in `_pairs_by_key` never fired,
  because the grouping key is a tuple that contains None rather than being
  None. Two not-yet-roomed sittings on one day were a hard room clash, which
  blocked publish on the ordinary case of building a schedule before assigning
  halls.
"""

from __future__ import annotations

import datetime

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.examinations import conflicts, services
from apps.examinations.models import AdmitCard, AdmitCardStatus, ExamStatus, ScheduleStatus
from apps.examinations.tests.factories import (
    AFTERNOON,
    ClassSubjectFactory,
    ExamFactory,
    ExamScheduleFactory,
    ExamSubjectFactory,
    RoomFactory,
    SubjectFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.examinations.tests.test_schedules import ScheduleTestCase
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context


class PublishPermissionTests(ScheduleTestCase):
    """Finding 1 — `:publish-schedule` had no restricted-principal guard."""

    def _portal_client(self, *keys: str) -> APIClient:
        with tenant_context(self.tenant.id):
            user = UserFactory(tenant=self.tenant)
        grant(user, *keys, scope=RecordScope.ALL, is_restricted_principal=True)
        client = APIClient()
        authenticate(client, user)
        return client

    def test_a_restricted_principal_cannot_publish_a_schedule(self) -> None:
        """Publishing releases a timetable to every student in the tenant and
        fires §12's announcement. A guardian holding the write key must still be
        refused — the key being misconfigured should not also be an escalation.
        """
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)
        client = self._portal_client("exams.schedule.view", "exams.schedule.update")

        response = client.post(f"/api/v1/exams/{self.exam.pk}:publish-schedule")

        self.assertEqual(response.status_code, 403)

    def test_the_view_key_alone_cannot_publish(self) -> None:
        """The actual defect: `publish` was absent from
        `required_permission_map`, so it inherited `required_permission` — the
        bare view key every portal user holds.
        """
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)
            staff_user = UserFactory(tenant=self.tenant)
        grant(staff_user, "exams.schedule.view", scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, staff_user)

        response = client.post(f"/api/v1/exams/{self.exam.pk}:publish-schedule")

        self.assertEqual(response.status_code, 403)

    def test_a_new_action_defaults_to_staff_only(self) -> None:
        """The structural half of the fix: the set is now the *readable*
        actions, so an action nobody remembered to classify is staff-only. A
        list of writes has to be updated whenever one is added, and forgetting
        is silent.
        """
        from apps.examinations.views import AdmitCardViewSet, ExamScheduleViewSet

        for viewset in (ExamScheduleViewSet, AdmitCardViewSet):
            with self.subTest(viewset=viewset.__name__):
                self.assertEqual(viewset.PORTAL_READABLE_ACTIONS, frozenset({"list", "retrieve"}))
                self.assertFalse(hasattr(viewset, "STAFF_ONLY_ACTIONS"))


class ScheduleDeleteTests(ScheduleTestCase):
    """Finding 2 — DELETE bypassed the check PATCH enforced."""

    def test_a_completed_sitting_cannot_be_deleted(self) -> None:
        """A completed sitting is a paper students have sat. `cancelled` is the
        state for calling one off, and it keeps the row visible."""
        with tenant_context(self.tenant.id):
            sitting = self.sitting(room=self.room, status=ScheduleStatus.COMPLETED)

        response = self.client.delete(f"/api/v1/exam-schedules/{sitting.pk}")

        self.assertEqual(response.status_code, 409)

    def test_a_scheduled_sitting_can_still_be_deleted(self) -> None:
        """The control: the check must not have closed the ordinary case."""
        with tenant_context(self.tenant.id):
            sitting = self.sitting(room=self.room)

        response = self.client.delete(f"/api/v1/exam-schedules/{sitting.pk}")

        self.assertEqual(response.status_code, 204)


class UnroomedSittingTests(ScheduleTestCase):
    """Finding 3 — the null guard never fired, so unroomed sittings clashed."""

    def test_two_unroomed_sittings_on_one_day_do_not_clash(self) -> None:
        """A school builds a schedule before it assigns halls. Grouping under
        `(None, date)` made every such pair a hard room clash, which blocked
        publish until every sitting had a distinct room — with nothing actually
        double-booked.
        """
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            self.sitting(room=None)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day,
                room=None,
                start_time=datetime.time(10, 0),
                end_time=datetime.time(12, 0),
            )
            findings = conflicts.detect_conflicts(exam=self.exam)

        self.assertEqual([f for f in findings if f["type"] == conflicts.ROOM_DOUBLE_BOOKED], [])

    def test_two_sittings_with_no_invigilator_do_not_clash(self) -> None:
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            second_room = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40)
            self.sitting(room=self.room, invigilator_staff=None)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day,
                room=second_room,
                invigilator_staff=None,
                start_time=datetime.time(10, 0),
                end_time=datetime.time(12, 0),
            )
            findings = conflicts.detect_conflicts(exam=self.exam)

        self.assertEqual(
            [f for f in findings if f["type"] == conflicts.INVIGILATOR_DOUBLE_BOOKED], []
        )

    def test_a_publish_still_succeeds_with_no_rooms_assigned(self) -> None:
        """The consequence the bug had: publish was unreachable."""
        other = self.second_subject()
        with tenant_context(self.tenant.id):
            self.sitting(room=None)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=other,
                section=self.other_section,
                exam_date=self.day,
                room=None,
                start_time=AFTERNOON[0],
                end_time=AFTERNOON[1],
            )

        response = self.client.post(f"/api/v1/exams/{self.exam.pk}:publish-schedule")

        self.assertEqual(response.status_code, 200, response.json())

    def test_a_real_room_double_booking_is_still_reported(self) -> None:
        """The control that keeps the fix honest."""
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
            findings = conflicts.detect_conflicts(exam=self.exam)

        self.assertEqual(len([f for f in findings if f["type"] == conflicts.ROOM_DOUBLE_BOOKED]), 1)


class CrossExamIsolationTests(ScheduleTestCase):
    """Finding 4 — one exam's clash list reported other exams' clashes."""

    def test_a_clash_between_two_other_exams_is_not_this_exam_s_problem(self) -> None:
        """`scope.schedules` includes other exams deliberately — a room clash is
        by definition with some other exam — but a clash purely *between two
        others* is not this exam's to resolve, and reporting it blocked a
        publish over something the caller could not fix.
        """
        with tenant_context(self.tenant.id):
            # Two other exams, double-booking a room between themselves on a day
            # this exam also uses.
            shared_room = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40)
            for index in (1, 2):
                subject = SubjectFactory(tenant=self.tenant)
                ClassSubjectFactory(
                    tenant=self.tenant,
                    academic_session=self.session,
                    school_class=self.school_class,
                    subject=subject,
                )
                stranger_exam = ExamFactory(
                    tenant=self.tenant,
                    academic_session=self.session,
                    grading_scale=self.scale,
                    starts_on=self.day,
                    ends_on=self.day,
                )
                stranger_subject = ExamSubjectFactory(
                    tenant=self.tenant,
                    exam=stranger_exam,
                    school_class=self.school_class,
                    subject=subject,
                )
                ExamScheduleFactory(
                    tenant=self.tenant,
                    exam_subject=stranger_subject,
                    section=self.other_section,
                    exam_date=self.day,
                    room=shared_room,
                    start_time=datetime.time(9, 30 * (index - 1)),
                    end_time=datetime.time(11, 30 * (index - 1)),
                )

            # This exam's own sitting, in its own room, clashing with nothing.
            self.sitting(room=self.room)
            findings = conflicts.detect_conflicts(exam=self.exam)

        self.assertEqual(
            [f for f in findings if f["severity"] == "hard"],
            [],
            f"another exam's clash was reported against this one: {findings}",
        )

    def test_a_clash_with_another_exam_is_still_reported(self) -> None:
        """The control: cross-exam clashes involving *this* exam are exactly
        why the scope is wider than one exam in the first place."""
        with tenant_context(self.tenant.id):
            subject = SubjectFactory(tenant=self.tenant)
            ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=subject,
            )
            stranger_exam = ExamFactory(
                tenant=self.tenant,
                academic_session=self.session,
                grading_scale=self.scale,
                starts_on=self.day,
                ends_on=self.day,
            )
            stranger_subject = ExamSubjectFactory(
                tenant=self.tenant,
                exam=stranger_exam,
                school_class=self.school_class,
                subject=subject,
            )
            self.sitting(room=self.room)
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=stranger_subject,
                section=self.other_section,
                exam_date=self.day,
                room=self.room,
                start_time=datetime.time(10, 0),
                end_time=datetime.time(12, 0),
            )
            findings = conflicts.detect_conflicts(exam=self.exam)

        self.assertEqual(len([f for f in findings if f["type"] == conflicts.ROOM_DOUBLE_BOOKED]), 1)


class AdmitCardBatchTests(ScheduleTestCase):
    """Findings 5, 6 and 7 — the notification, the count, and the N+1."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.sitting(room=self.room)
            self.exam.status = ExamStatus.SCHEDULED
            self.exam.save(update_fields=["status"])

    def test_the_issued_count_is_what_the_database_holds(self) -> None:
        """Finding 6 — `len(created)` overstated under exactly the race
        `ignore_conflicts` exists to absorb: the loser attempted N rows,
        inserted none, and reported N.
        """
        with tenant_context(self.tenant.id):
            first = services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)
            # A second run with nothing new. The invariant is what matters
            # and what the fix guarantees: `issued` is always the change in row
            # count, never the number of rows attempted. A genuine concurrent
            # race is not reproducible in a single-connection `TestCase`, so
            # asserting the invariant is the honest test — faking the race by
            # rewriting card numbers would violate the very uniqueness
            # constraint the race turns on.
            second = services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)
            total = AdmitCard.objects.alive().filter(exam=self.exam).count()

        self.assertEqual(first["issued"], 3)
        self.assertEqual(second["issued"], 0)
        self.assertEqual(first["issued"] + second["issued"], total)

    def test_rendering_does_not_query_per_card(self) -> None:
        """Finding 7 — `student_sittings` was called once per card, two queries
        each. `sittings_by_student` answers the whole batch in two.
        """
        with tenant_context(self.tenant.id):
            students = list(self.students)

        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as three:
            services.sittings_by_student(exam=self.exam, students=students)

        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as one:
            services.sittings_by_student(exam=self.exam, students=students[:1])

        self.assertEqual(len(three.captured_queries), len(one.captured_queries))
        self.assertLessEqual(len(three.captured_queries), 2)

    def test_the_batch_lookup_agrees_with_the_single_form(self) -> None:
        """The property that keeps the two from drifting."""
        with tenant_context(self.tenant.id):
            batch = services.sittings_by_student(exam=self.exam, students=list(self.students))
            single = {
                student.pk: services.student_sittings(exam=self.exam, student=student)
                for student in self.students
            }

        for student in self.students:
            with self.subTest(student=student.pk):
                self.assertEqual(
                    [row.pk for row in batch.get(student.pk, [])],
                    [row.pk for row in single[student.pk]],
                )

    def test_the_admit_card_notification_is_actually_sent(self) -> None:
        """Finding 5 — `ADMIT_CARD_ISSUED` was registered with templates,
        documented as wired, and called from nowhere. It fires after the
        *render*, because the message says the card is ready to download.
        """
        from unittest.mock import patch

        from apps.examinations import notifications, tasks

        with tenant_context(self.tenant.id):
            services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)
            card = AdmitCard.objects.alive().filter(exam=self.exam).first()
            card.status = AdmitCardStatus.ISSUED
            card.file = self._a_file()
            card.save(update_fields=["status", "file"])
            self.students[0].user_id = self.user.pk
            self.students[0].save(update_fields=["user_id"])

        with patch("core.notifications.services.notify") as notify:
            tasks.notify_admit_cards_issued(
                tenant_id=str(self.tenant.pk), exam_id=str(self.exam.pk)
            )

        self.assertTrue(notify.called)
        self.assertEqual(notify.call_args.args[0], notifications.ADMIT_CARD_ISSUED)
        context = notify.call_args.kwargs["context"]
        self.assertIn("admit_card_no", context)
        self.assertIn("student.first_name", context)

    def _a_file(self):
        """A ready `File` row, so a card can look rendered without WeasyPrint."""
        from apps.examinations import uploads
        from core.files.services import create_ready_file

        return create_ready_file(
            tenant_id=self.tenant.pk,
            purpose=uploads.ADMIT_CARD.key,
            original_name="stub.pdf",
            mime_type="application/pdf",
            data=b"%PDF-stub",
            actor_id=self.user.pk,
        )
