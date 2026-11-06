"""§5.4's marks entry — the lifecycle, the four gates, and the import.

The four gates are checked together by `bulk_enter_marks` and each has its own
case here, because they fail for different reasons and a caller needs to know
which: the exam's own status (§7.1), the entry window (§6), the subject lock
(§5.4), and the teacher's allocation (§4).

**A rejected row rejects the whole grid**, which is the opposite of the import
in the same module. That contrast is deliberate and tested from both sides: a
grid is one act of judgement over one class, so a teacher who believes they
saved forty marks and saved thirty-nine is worse off than one told which cell is
wrong. An import is a file a school is migrating, where §6 asks to "re-import
failed rows only" — which needs a per-row verdict.
"""

from __future__ import annotations

import datetime
from decimal import Decimal
from unittest import mock

from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations import services, tasks
from apps.examinations.models import ExamStatus, Marks, MarksStatus
from apps.examinations.tests.base import ExaminationsAPITestCase
from apps.examinations.tests.factories import (
    CampusFactory,
    ClassFactory,
    ExamFactory,
    ExamSubjectFactory,
    MarksFactory,
    SectionFactory,
    StaffFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    TeacherAllocationFactory,
    UserFactory,
    authenticate,
    grant,
    open_marks_entry,
)
from core.api.exceptions import DomainRuleViolation
from core.jobs.tests.base import assert_sent_on_commit
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

MARKS = "/api/v1/marks"
BULK_ENTRY = "/api/v1/marks:bulk-entry"


class MarksTestCase(ExaminationsAPITestCase):
    """An exam in `marks_entry` with one subject configured and its window open."""

    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        with tenant_context(self.tenant.id):
            self.exam = ExamFactory(
                tenant=self.tenant,
                academic_session=self.session,
                grading_scale=self.scale,
                status=ExamStatus.MARKS_ENTRY,
            )
            self.exam_subject = ExamSubjectFactory(
                tenant=self.tenant,
                exam=self.exam,
                school_class=self.school_class,
                subject=self.subject,
                max_marks=Decimal("100.00"),
                pass_marks=Decimal("40.00"),
            )
        open_marks_entry(self.exam_subject)

    def entries(self, **overrides) -> list[dict]:
        rows = [
            {"student_id": str(student.pk), "theory_marks": "60.00"} for student in self.students
        ]
        if overrides:
            rows[0].update(overrides)
        return rows

    def submit(self, entries=None, client=None, section=None):
        return (client or self.client).post(
            BULK_ENTRY,
            {
                "exam_subject_id": str(self.exam_subject.pk),
                "section_id": str((section or self.section).pk),
                "entries": entries or self.entries(),
            },
            format="json",
        )


class MarksConstraintTests(MarksTestCase):
    def test_one_row_per_student_per_exam_subject(self) -> None:
        with tenant_context(self.tenant.id):
            MarksFactory(
                tenant=self.tenant,
                exam_subject=self.exam_subject,
                student=self.students[0],
                entered_by=self.user.pk,
            )

        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            MarksFactory(
                tenant=self.tenant,
                exam_subject=self.exam_subject,
                student=self.students[0],
                entered_by=self.user.pk,
            )

    def test_a_negative_mark_is_refused_by_the_database(self) -> None:
        """The half of §11's range rule a CHECK can hold. The upper bound is on
        another table, so it lives in `services`."""
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            MarksFactory(
                tenant=self.tenant,
                exam_subject=self.exam_subject,
                student=self.students[0],
                entered_by=self.user.pk,
                theory_marks=Decimal("-1.00"),
            )

    def test_an_absent_student_cannot_also_have_a_mark(self) -> None:
        """§11 — mutually exclusive, and both columns are on this row, so the
        database genuinely enforces it. An absent student with a score is a
        contradiction that would otherwise reach a report card."""
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            MarksFactory(
                tenant=self.tenant,
                exam_subject=self.exam_subject,
                student=self.students[0],
                entered_by=self.user.pk,
                is_absent=True,
                theory_marks=Decimal("50.00"),
            )

    def test_absent_and_exempt_cannot_both_be_asserted(self) -> None:
        """ "Did not sit" and "was not required to" are different claims, and a
        row asserting both describes neither."""
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            MarksFactory(
                tenant=self.tenant,
                exam_subject=self.exam_subject,
                student=self.students[0],
                entered_by=self.user.pk,
                is_absent=True,
                is_exempt=True,
            )


class BulkEntryTests(MarksTestCase):
    def test_a_grid_is_saved(self) -> None:
        response = self.submit()

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            self.assertEqual(
                Marks.objects.alive().filter(exam_subject=self.exam_subject).count(), 3
            )

    def test_resubmitting_updates_in_place(self) -> None:
        """§16 calls this an idempotent grid submit. A teacher's browser
        genuinely re-sends, and `bulk_create` would hit the unique index on the
        second attempt and fail the whole grid."""
        self.submit()

        response = self.submit(self.entries(theory_marks="75.00"))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            self.assertEqual(
                Marks.objects.alive().filter(exam_subject=self.exam_subject).count(), 3
            )
            row = Marks.objects.alive().get(
                exam_subject=self.exam_subject, student=self.students[0]
            )
        self.assertEqual(row.theory_marks, Decimal("75.00"))

    def test_a_mark_above_the_maximum_rejects_the_whole_grid(self) -> None:
        """The rule a CHECK cannot hold, and the contract that makes it usable:
        nothing is saved, and the response names the cell."""
        response = self.submit(self.entries(theory_marks="150.00"))

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        body = response.json()["error"]
        self.assertEqual(body["meta"]["rows"][0]["field"], "theory_marks")
        self.assertIn("maximum of 100", body["meta"]["rows"][0]["issue"])
        with tenant_context(self.tenant.id):
            self.assertEqual(
                Marks.objects.alive().filter(exam_subject=self.exam_subject).count(), 0
            )

    def test_an_ineligible_student_rejects_the_whole_grid_and_names_the_index(self) -> None:
        with tenant_context(self.tenant.id):
            stranger = StudentFactory(tenant=self.tenant, campus=self.campus)

        entries = [*self.entries(), {"student_id": str(stranger.pk), "theory_marks": "50.00"}]
        response = self.submit(entries)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        rows = response.json()["error"]["meta"]["rows"]
        self.assertEqual(rows[0]["index"], 3)
        self.assertEqual(rows[0]["student_id"], str(stranger.pk))

    def test_a_duplicated_student_in_one_submission_is_refused(self) -> None:
        """Two cells for one student is a client bug, and silently taking the
        last would make which one won depend on ordering."""
        entries = [*self.entries(), {"student_id": str(self.students[0].pk)}]

        response = self.submit(entries)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_practical_mark_on_a_theory_only_subject_is_refused(self) -> None:
        response = self.submit(self.entries(practical_marks="10.00"))

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("no practical component", str(response.json()))

    def test_an_absent_student_is_saved_with_no_mark(self) -> None:
        response = self.submit(self.entries(is_absent=True, theory_marks=None))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            row = Marks.objects.alive().get(
                exam_subject=self.exam_subject, student=self.students[0]
            )
        self.assertTrue(row.is_absent)
        self.assertIsNone(row.theory_marks)

    def test_entering_marks_moves_the_exam_into_marks_entry(self) -> None:
        """Done in the service so the status cannot lag behind the data: a
        school looking at a `scheduled` exam that already holds marks has no way
        to tell which is true."""
        with tenant_context(self.tenant.id):
            self.exam.status = ExamStatus.SCHEDULED
            self.exam.save(update_fields=["status"])

        self.submit()

        with tenant_context(self.tenant.id):
            self.exam.refresh_from_db()
        self.assertEqual(self.exam.status, ExamStatus.MARKS_ENTRY)

    def test_an_idempotency_key_replays_the_counts(self) -> None:
        first = self.client.post(
            BULK_ENTRY,
            {
                "exam_subject_id": str(self.exam_subject.pk),
                "section_id": str(self.section.pk),
                "entries": self.entries(),
            },
            format="json",
            **{"HTTP_IDEMPOTENCY_KEY": "grid-1"},
        )
        second = self.client.post(
            BULK_ENTRY,
            {
                "exam_subject_id": str(self.exam_subject.pk),
                "section_id": str(self.section.pk),
                "entries": self.entries(),
            },
            format="json",
            **{"HTTP_IDEMPOTENCY_KEY": "grid-1"},
        )

        self.assertEqual(first.status_code, status.HTTP_200_OK, first.json())
        self.assertEqual(second.json()["meta"]["message"], first.json()["meta"]["message"])


class EntryGateTests(MarksTestCase):
    def test_entry_before_the_window_opens_is_refused(self) -> None:
        now = timezone.now()
        open_marks_entry(
            self.exam_subject,
            opens_at=now + datetime.timedelta(days=1),
            closes_at=now + datetime.timedelta(days=2),
        )

        response = self.submit()

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("opens", str(response.json()))

    def test_entry_after_the_window_closes_is_refused(self) -> None:
        now = timezone.now()
        open_marks_entry(
            self.exam_subject,
            opens_at=now - datetime.timedelta(days=3),
            closes_at=now - datetime.timedelta(days=1),
        )

        response = self.submit()

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("reopened", str(response.json()))

    def test_no_window_at_all_means_always_open(self) -> None:
        """A school that has not configured entry dates has not asked to be
        gated, and refusing on a null would make the window mandatory — which
        §6 does not say and no migration set."""
        with tenant_context(self.tenant.id):
            self.exam_subject.marks_entry_opens_at = None
            self.exam_subject.marks_entry_closes_at = None
            self.exam_subject.save(update_fields=["marks_entry_opens_at", "marks_entry_closes_at"])

        self.assertEqual(self.submit().status_code, status.HTTP_200_OK)

    def test_entry_into_a_locked_subject_is_refused_naming_the_unlock(self) -> None:
        with tenant_context(self.tenant.id):
            services.lock_marks(exam_subject=self.exam_subject, actor_id=self.user.pk)

        response = self.submit()

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("unlock", str(response.json()).lower())

    def test_entry_after_results_are_approved_is_refused(self) -> None:
        """§7.1's one-way gate. Editing a mark after approval would leave a
        published result that no longer follows from its inputs."""
        with tenant_context(self.tenant.id):
            self.exam.status = ExamStatus.APPROVED
            self.exam.save(update_fields=["status"])

        response = self.submit()

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("send the results back", str(response.json()).lower())


class AllocationScopeTests(MarksTestCase):
    def _teacher_client(self, user) -> APIClient:
        grant(user, "exams.marks.view", "exams.marks.create", scope=RecordScope.ASSIGNED)
        client = APIClient()
        authenticate(client, user)
        return client

    def test_an_allocated_teacher_may_enter_marks(self) -> None:
        """The base fixture allocates `subject_teacher` to (section, subject),
        which is what `academics.TeacherSubjectAllocation` exists for."""
        client = self._teacher_client(self.subject_teacher_user)

        response = self.submit(client=client)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_a_teacher_not_allocated_to_the_class_subject_is_refused(self) -> None:
        """The exam-subject is outside their `assigned` reach, so it is a 404 (ADR-0031
        decision 3), whatever section is posted: a 422 would say whether it is in the class."""
        with tenant_context(self.tenant.id):
            stranger_user = UserFactory(tenant=self.tenant)
            StaffFactory(tenant=self.tenant, campus=self.campus, user_id=stranger_user.pk)
            elsewhere = SectionFactory(
                tenant=self.tenant,
                school_class=ClassFactory(tenant=self.tenant, level=9),
                campus=self.campus,
            )
        client = self._teacher_client(stranger_user)

        for section in (self.section, elsewhere):
            with self.subTest(section=section.name):
                response = self.submit(client=client, section=section)
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.tenant.id):
            self.assertFalse(Marks.objects.filter(exam_subject=self.exam_subject).exists())

    def test_the_gate_names_a_missing_allocation(self) -> None:
        """The section gate's own sentence, for a caller who reaches the exam-subject."""
        with tenant_context(self.tenant.id):
            stranger_user = UserFactory(tenant=self.tenant)
            StaffFactory(tenant=self.tenant, campus=self.campus, user_id=stranger_user.pk)
        grant(stranger_user, "exams.marks.create", scope=RecordScope.ASSIGNED)
        # An unrelated key at `all` must not lift the marks key past the allocation check.
        grant(stranger_user, "exams.exam.view", scope=RecordScope.ALL)

        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation) as raised:
            services.assert_marker_may_enter(
                user=stranger_user,
                exam_subject=self.exam_subject,
                section=self.section,
                permission=services.MARKS_CREATE,
            )

        self.assertIn("not currently allocated", str(raised.exception.detail))

    def test_unrelated_all_role_does_not_skip_allocation_check(self) -> None:
        """Only the roles granting `exams.marks.create` decide the early return.

        The teacher's marks role is `assigned`; an `all` role for another key must
        not lift them past the allocation check. Against the key-blind union this
        teacher looked `all`-scoped and the unallocated grid was saved.
        """
        with tenant_context(self.tenant.id):
            stranger_user = UserFactory(tenant=self.tenant)
            StaffFactory(tenant=self.tenant, campus=self.campus, user_id=stranger_user.pk)
        grant(stranger_user, "exams.exam.view", scope=RecordScope.ALL)
        client = self._teacher_client(stranger_user)

        response = self.submit(client=client)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.tenant.id):
            self.assertFalse(Marks.objects.filter(exam_subject=self.exam_subject).exists())

    def test_an_account_with_no_staff_row_is_refused(self) -> None:
        """No staff row teaches nothing: the exam-subject is a 404, and the gate's own
        sentence says why."""
        with tenant_context(self.tenant.id):
            orphan = UserFactory(tenant=self.tenant)
        client = self._teacher_client(orphan)

        response = self.submit(client=client)
        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation) as raised:
            services.assert_marker_may_enter(
                user=orphan,
                exam_subject=self.exam_subject,
                section=self.section,
                permission=services.MARKS_CREATE,
            )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("no active staff record", str(raised.exception.detail))

    def test_an_all_scoped_caller_needs_no_allocation(self) -> None:
        """Many `exam_staff` and admin users have no `Staff` row at all, so
        requiring an allocation would break the legitimate case — the same early
        return `attendance.register.may_mark_register` makes."""
        response = self.submit()

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_an_assigned_teacher_reads_only_their_own_class_subject_s_marks(self) -> None:
        with tenant_context(self.tenant.id):
            other_subject_config = ExamSubjectFactory(
                tenant=self.tenant,
                exam=self.exam,
                school_class=self.school_class,
                subject=self._another_subject(),
            )
            MarksFactory(
                tenant=self.tenant,
                exam_subject=other_subject_config,
                student=self.students[0],
                entered_by=self.user.pk,
            )
        self.submit()
        grant(
            self.subject_teacher_user,
            "exams.marks.view",
            "exams.marks.create",
            scope=RecordScope.ASSIGNED,
        )
        client = APIClient()
        authenticate(client, self.subject_teacher_user)

        response = client.get(f"{MARKS}?exam_subject_id={other_subject_config.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"], [])

    def _another_subject(self):
        from apps.examinations.tests.factories import ClassSubjectFactory, SubjectFactory

        subject = SubjectFactory(tenant=self.tenant)
        ClassSubjectFactory(
            tenant=self.tenant,
            academic_session=self.session,
            school_class=self.school_class,
            subject=subject,
        )
        return subject


class CampusBMarksTestCase(MarksTestCase):
    """The base class gains a campus-B section and one student enrolled in it."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.campus_b = CampusFactory(tenant=self.tenant)
            self.section_b = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus_b
            )
            self.student_b = self._enrol(campus=self.campus_b, section=self.section_b)

    def _enrol(self, *, campus, section):
        student = StudentFactory(tenant=self.tenant, campus=campus)
        StudentEnrollmentFactory(
            tenant=self.tenant,
            student=student,
            academic_session=self.session,
            school_class=self.school_class,
            section=section,
        )
        return student

    def _client(self, user) -> APIClient:
        client = APIClient()
        authenticate(client, user)
        return client

    def _marks_written(self) -> int:
        with tenant_context(self.tenant.id):
            return Marks.objects.alive().filter(exam_subject=self.exam_subject).count()


class EntryRecordScopeTests(CampusBMarksTestCase):
    """Which students a marker may write is `exams.marks.create`'s record scope.

    Entry is per section (the section gate) and per student (this key's record
    scope over the student), one section per submit. Against the old code a
    campus-scoped marker returned early and every enrolled student of the class
    was eligible, so a campus-A marker wrote campus-B marks, and an allocated
    teacher wrote marks for a section they do not teach.
    """

    def _row(self, student) -> dict:
        return {"student_id": str(student.pk), "theory_marks": "55.00"}

    def _assert_rejected_alone(self, response, *, index: int, student) -> None:
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        rows = response.json()["error"]["meta"]["rows"]
        self.assertEqual(
            [(row["index"], row["student_id"], row["field"]) for row in rows],
            [(index, str(student.pk), "student_id")],
        )
        self.assertEqual(self._marks_written(), 0)

    def _campus_a_marker(self):
        with tenant_context(self.tenant.id):
            marker = UserFactory(tenant=self.tenant)
        grant(
            marker,
            "exams.marks.view",
            "exams.marks.create",
            scope=RecordScope.CAMPUS,
            scope_ref=self.campus.pk,
        )
        return marker

    def test_a_campus_a_marker_cannot_write_a_campus_b_student(self) -> None:
        """Proves the section roll: `student_b` is on campus B's section, not this one."""
        marker = self._campus_a_marker()

        response = self.submit(
            [*self.entries(), self._row(self.student_b)], client=self._client(marker)
        )

        self._assert_rejected_alone(response, index=3, student=self.student_b)

    def test_a_campus_b_student_in_a_campus_a_section_is_rejected_by_record_scope(self) -> None:
        """Proves the per-student filter: the section passes the gate and the student is
        on its roll, so only `exams.marks.create`'s scope over the student refuses them
        (the student-vs-section campus edge in `deferred-work.md`)."""
        marker = self._campus_a_marker()
        with tenant_context(self.tenant.id):
            visitor = self._enrol(campus=self.campus_b, section=self.section)

        response = self.submit([*self.entries(), self._row(visitor)], client=self._client(marker))

        self._assert_rejected_alone(response, index=3, student=visitor)

    def test_a_campus_a_marker_still_writes_their_own_campus(self) -> None:
        marker = self._campus_a_marker()

        response = self.submit(client=self._client(marker))

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(self._marks_written(), 3)

    def test_an_assigned_teacher_cannot_write_a_student_outside_their_sections(self) -> None:
        """Proves the section roll: the allocation is to `self.section`, and a student on
        `other_section`'s roll is not on it."""
        with tenant_context(self.tenant.id):
            outsider = self._enrol(campus=self.campus, section=self.other_section)
        grant(
            self.subject_teacher_user,
            "exams.marks.view",
            "exams.marks.create",
            scope=RecordScope.ASSIGNED,
        )

        response = self.submit(
            [*self.entries(), self._row(outsider)],
            client=self._client(self.subject_teacher_user),
        )

        self._assert_rejected_alone(response, index=3, student=outsider)

    def test_campus_a_plus_assigned_without_a_campus_b_allocation_cannot_write_campus_b(
        self,
    ) -> None:
        """`deferred-work.md`'s case: the `campus` grant used to skip the allocation check."""
        with tenant_context(self.tenant.id):
            marker = UserFactory(tenant=self.tenant)
            StaffFactory(tenant=self.tenant, campus=self.campus, user_id=marker.pk)
        grant(
            marker,
            "exams.marks.view",
            "exams.marks.create",
            scope=RecordScope.CAMPUS,
            scope_ref=self.campus.pk,
        )
        grant(marker, "exams.marks.create", scope=RecordScope.ASSIGNED)
        client = self._client(marker)

        in_own_section = self.submit([self._row(self.student_b)], client=client)
        in_its_section = self.submit(
            [self._row(self.student_b)], client=client, section=self.section_b
        )

        self._assert_rejected_alone(in_own_section, index=0, student=self.student_b)
        self.assertEqual(in_its_section.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        fields = [detail["field"] for detail in in_its_section.json()["error"]["details"]]
        self.assertEqual(fields, ["section_id"])
        self.assertEqual(self._marks_written(), 0)

    def test_campus_a_plus_assigned_writes_the_campus_b_section_they_are_allocated(
        self,
    ) -> None:
        """The two grants are a union (ADR-0031 decision 7), not the narrower of the two."""
        with tenant_context(self.tenant.id):
            marker = UserFactory(tenant=self.tenant)
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, user_id=marker.pk)
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.section_b,
                subject=self.subject,
                staff=staff,
            )
        grant(
            marker,
            "exams.marks.view",
            "exams.marks.create",
            scope=RecordScope.CAMPUS,
            scope_ref=self.campus.pk,
        )
        grant(marker, "exams.marks.view", "exams.marks.create", scope=RecordScope.ASSIGNED)
        client = self._client(marker)

        grid = client.get(
            f"{MARKS}/grid",
            {"exam_subject_id": str(self.exam_subject.pk), "section_id": str(self.section_b.pk)},
        )
        # One section per submit (the grid's shape): campus A's, then the allocated campus B's.
        own = self.submit(client=client)
        allocated = self.submit([self._row(self.student_b)], client=client, section=self.section_b)

        self.assertEqual(grid.status_code, status.HTTP_200_OK, grid.json())
        self.assertTrue(grid.json()["meta"]["writable"])
        self.assertEqual(own.status_code, status.HTTP_200_OK, own.json())
        self.assertEqual(allocated.status_code, status.HTTP_200_OK, allocated.json())
        self.assertEqual(self._marks_written(), 4)

    def test_an_all_scoped_marker_still_writes_every_campus_and_section(self) -> None:
        with tenant_context(self.tenant.id):
            outsider = self._enrol(campus=self.campus, section=self.other_section)

        # One section per submit (the grid's shape), every one of them accepted.
        responses = [
            self.submit(),
            self.submit([self._row(self.student_b)], section=self.section_b),
            self.submit([self._row(outsider)], section=self.other_section),
        ]

        for response in responses:
            self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(self._marks_written(), 5)


class LockLifecycleTests(MarksTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.submit()

    def test_locking_stamps_every_row_and_closes_the_window(self) -> None:
        """Both halves matter: the window closes entry, and the row status is
        what result processing reads — a row still `draft` when its subject
        locked was never claimed as finished."""
        response = self.client.post(f"/api/v1/exam-subjects/{self.exam_subject.pk}:lock-marks")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            self.exam_subject.refresh_from_db()
            statuses = set(
                Marks.objects.alive()
                .filter(exam_subject=self.exam_subject)
                .values_list("status", flat=True)
            )
        self.assertIsNotNone(self.exam_subject.marks_locked_at)
        self.assertEqual(statuses, {MarksStatus.LOCKED})

    def test_locking_twice_is_a_retry_not_a_conflict(self) -> None:
        self.client.post(f"/api/v1/exam-subjects/{self.exam_subject.pk}:lock-marks")

        response = self.client.post(f"/api/v1/exam-subjects/{self.exam_subject.pk}:lock-marks")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertTrue(response.json()["data"]["already_locked"])

    def test_unlocking_returns_rows_to_submitted_not_draft(self) -> None:
        """They *were* submitted. Sending them to draft would lose the
        distinction the missing-entries dashboard depends on and make every
        reopened subject look unfinished."""
        self.client.post(f"/api/v1/exam-subjects/{self.exam_subject.pk}:lock-marks")

        response = self.client.post(f"/api/v1/exam-subjects/{self.exam_subject.pk}:unlock-marks")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            self.exam_subject.refresh_from_db()
            statuses = set(
                Marks.objects.alive()
                .filter(exam_subject=self.exam_subject)
                .values_list("status", flat=True)
            )
        self.assertIsNone(self.exam_subject.marks_locked_at)
        self.assertEqual(statuses, {MarksStatus.SUBMITTED})

    def test_unlocking_needs_the_lock_key_not_the_entry_key(self) -> None:
        """§6 — "re-open requires `exams.marks.lock` and is audited"."""
        with tenant_context(self.tenant.id):
            entrant = UserFactory(tenant=self.tenant)
        grant(entrant, "exams.marks.create", scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, entrant)

        response = client.post(f"/api/v1/exam-subjects/{self.exam_subject.pk}:unlock-marks")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_unlocking_after_approval_is_refused(self) -> None:
        """Unlocking then would let a mark change under a result a school has
        already given to a parent."""
        self.client.post(f"/api/v1/exam-subjects/{self.exam_subject.pk}:lock-marks")
        with tenant_context(self.tenant.id):
            self.exam.status = ExamStatus.APPROVED
            self.exam.save(update_fields=["status"])

        response = self.client.post(f"/api/v1/exam-subjects/{self.exam_subject.pk}:unlock-marks")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)


class ProgressTests(MarksTestCase):
    def test_progress_reports_expected_entered_and_submitted(self) -> None:
        self.submit(self.entries())

        response = self.client.get(f"/api/v1/exams/{self.exam.pk}/marks-progress")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        row = response.json()["data"][0]
        self.assertEqual(row["expected"], 3)
        self.assertEqual(row["entered"], 3)
        # Submitted counts only rows claimed as finished, so a grid saved as
        # draft still shows as outstanding — which is the point of §6's
        # dashboard.
        self.assertEqual(row["submitted"], 0)

    def test_progress_is_a_bounded_number_of_queries(self) -> None:
        """Four queries flat (subjects, rolls, sections, marks counts), whatever
        the size of the exam. The obvious shape — for each subject, count its
        marks — is a query per subject, and an exam covers every subject in
        every year group."""
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with tenant_context(self.tenant.id):
            for _ in range(3):
                ExamSubjectFactory(
                    tenant=self.tenant,
                    exam=self.exam,
                    school_class=self.school_class,
                    subject=self._extra_subject(),
                )

        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as captured:
            services.all_marks_entry_progress(exam=self.exam)

        self.assertLessEqual(len(captured.captured_queries), 4)

    def _extra_subject(self):
        from apps.examinations.tests.factories import ClassSubjectFactory, SubjectFactory

        subject = SubjectFactory(tenant=self.tenant)
        ClassSubjectFactory(
            tenant=self.tenant,
            academic_session=self.session,
            school_class=self.school_class,
            subject=subject,
        )
        return subject


class MarksImportTests(MarksTestCase):
    URL = "/api/v1/marks-imports"

    def _sheet(self, rows: list[str]) -> bytes:
        header = ",".join(services.MARKS_IMPORT_COLUMNS)
        return ("\n".join([header, *rows]) + "\n").encode()

    def upload(self, content: bytes, name: str = "marks.csv"):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return self.client.post(
            self.URL,
            {
                "exam_subject_id": str(self.exam_subject.pk),
                "file": SimpleUploadedFile(name, content, content_type="text/csv"),
            },
            format="multipart",
        )

    def test_an_import_returns_202_and_a_job(self) -> None:
        response = self.upload(self._sheet([f"{self.students[0].admission_number},60,,,,"]))

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        self.assertIn("job_id", response.json()["data"])

    def test_the_import_is_sent_only_after_its_job_commits(self) -> None:
        sheet = self._sheet([f"{self.students[0].admission_number},60,,,,"])
        assert_sent_on_commit(
            self,
            tasks.import_marks_task,
            lambda: self.upload(sheet),
            tenant_id=self.tenant.pk,
            actor_id=self.user.pk,
        )

    def test_a_misspelled_header_fails_the_job_with_one_readable_error(self) -> None:
        from core.jobs.models import BackgroundJob, JobStatus

        # The view queues the task with transaction.on_commit, which a rolled-back test only runs
        # when the callbacks are captured and executed.
        with self.captureOnCommitCallbacks(execute=True):
            response = self.upload(b"Admission Number,theory_marks\nX,60\n")

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=response.json()["data"]["job_id"])
        self.assertEqual(job.status, JobStatus.FAILED)
        self.assertIn("admission_number", job.error)

    def test_a_bad_row_is_reported_and_the_good_rows_still_land(self) -> None:
        """The contrast with `:bulk-entry`, and the whole reason the import has
        its own path: §6 asks to re-import failed rows only, which needs a
        per-row verdict."""
        with tenant_context(self.tenant.id):
            enrollments = services.import_candidates_by_admission_number(
                exam_subject=self.exam_subject,
                user=self.user,
                permission="exams.marks.import",
            )
        rows = [
            f"{self.students[0].admission_number},60,,,,",
            "NOT-A-STUDENT,55,,,,",
            f"{self.students[1].admission_number},999,,,,",
        ]

        errors = []
        succeeded = 0
        with tenant_context(self.tenant.id):
            for index, row in enumerate(
                services.parse_marks_import(filename="m.csv", data=self._sheet(rows)),
                start=1,
            ):
                error = services.import_marks_row(
                    row=row,
                    row_number=index + 1,
                    exam_subject=self.exam_subject,
                    enrollments_by_number=enrollments,
                    actor_id=self.user.pk,
                )
                if error:
                    errors.append(error)
                else:
                    succeeded += 1
            landed = Marks.objects.alive().filter(exam_subject=self.exam_subject).count()

        self.assertEqual(succeeded, 1)
        self.assertEqual(landed, 1)
        self.assertEqual([e["field"] for e in errors], ["admission_number", "theory_marks"])

    def test_an_imported_row_lands_submitted_not_draft(self) -> None:
        """A school importing a sheet is asserting these are the marks, not
        saving a working state."""
        with tenant_context(self.tenant.id):
            services.import_marks_row(
                row={"admission_number": self.students[0].admission_number, "theory_marks": "60"},
                row_number=2,
                exam_subject=self.exam_subject,
                enrollments_by_number=services.import_candidates_by_admission_number(
                    exam_subject=self.exam_subject,
                    user=self.user,
                    permission="exams.marks.import",
                ),
                actor_id=self.user.pk,
            )
            row = Marks.objects.alive().get(
                exam_subject=self.exam_subject, student=self.students[0]
            )

        self.assertEqual(row.status, MarksStatus.SUBMITTED)

    def test_a_blank_cell_is_absent_of_a_mark_not_a_zero(self) -> None:
        """The distinction the whole import turns on: reading a blank as zero
        would fail a student who did not sit."""
        with tenant_context(self.tenant.id):
            services.import_marks_row(
                row={"admission_number": self.students[0].admission_number, "theory_marks": ""},
                row_number=2,
                exam_subject=self.exam_subject,
                enrollments_by_number=services.import_candidates_by_admission_number(
                    exam_subject=self.exam_subject,
                    user=self.user,
                    permission="exams.marks.import",
                ),
                actor_id=self.user.pk,
            )
            row = Marks.objects.alive().get(
                exam_subject=self.exam_subject, student=self.students[0]
            )

        self.assertIsNone(row.theory_marks)

    def test_importing_into_a_locked_subject_is_refused_before_a_job_is_made(self) -> None:
        """Told immediately, rather than by polling a job that fails."""
        with tenant_context(self.tenant.id):
            services.lock_marks(exam_subject=self.exam_subject, actor_id=self.user.pk)

        response = self.upload(self._sheet([f"{self.students[0].admission_number},60,,,,"]))

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def _queue_then(self, change, rows: list[str]):
        """Upload while entry is open, apply `change` while the job is queued, then run it.

        The gap the gates have to survive: the view's check passes, and the
        subject changes before the task writes a row.
        """
        from core.jobs.models import BackgroundJob

        with self.captureOnCommitCallbacks() as callbacks:
            response = self.upload(self._sheet(rows))
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        with tenant_context(self.tenant.id):
            change()
        for callback in callbacks:
            callback()
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=response.json()["data"]["job_id"])
            landed = Marks.objects.alive().filter(exam_subject=self.exam_subject).count()
        return job.result, landed

    def _two_rows(self) -> list[str]:
        return [f"{student.admission_number},60,,,," for student in self.students[:2]]

    def test_an_import_queued_before_a_lock_writes_nothing(self) -> None:
        """The review's case: a clerk uploads while entry is open, an admin
        locks the subject while the job is queued, and the import must not
        write into a result set that is meant to be final."""
        result, landed = self._queue_then(
            lambda: services.lock_marks(exam_subject=self.exam_subject, actor_id=self.user.pk),
            self._two_rows(),
        )

        self.assertEqual(landed, 0)
        self.assertEqual(result["succeeded"], 0)
        self.assertEqual({e["field"] for e in result["errors"]}, {"exam_subject"})
        self.assertIn("unlock", result["errors"][0]["issue"].lower())

    def test_a_lock_partway_through_an_import_refuses_the_rows_after_it(self) -> None:
        original = services.import_marks_row
        calls = []

        def lock_after_first_row(**kwargs):
            outcome = original(**kwargs)
            calls.append(outcome)
            if len(calls) == 1:
                services.lock_marks(exam_subject=self.exam_subject, actor_id=self.user.pk)
            return outcome

        with mock.patch.object(services, "import_marks_row", side_effect=lock_after_first_row):
            result, landed = self._queue_then(lambda: None, self._two_rows())

        self.assertEqual(landed, 1)
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual([e["field"] for e in result["errors"]], ["exam_subject"])

    def test_an_import_after_the_window_closes_writes_nothing(self) -> None:
        def close_window():
            now = timezone.now()
            self.exam_subject.marks_entry_opens_at = now - datetime.timedelta(days=2)
            self.exam_subject.marks_entry_closes_at = now - datetime.timedelta(minutes=1)
            self.exam_subject.save(update_fields=["marks_entry_opens_at", "marks_entry_closes_at"])

        result, landed = self._queue_then(close_window, self._two_rows())

        self.assertEqual(landed, 0)
        self.assertIn("closed", result["errors"][0]["issue"].lower())

    def test_an_import_after_results_are_approved_writes_nothing(self) -> None:
        def approve():
            self.exam.status = ExamStatus.APPROVED
            self.exam.save(update_fields=["status"])

        result, landed = self._queue_then(approve, self._two_rows())

        self.assertEqual(landed, 0)
        self.assertIn("send the results back", result["errors"][0]["issue"].lower())

    def _remove_subject(self) -> None:
        self.exam_subject.deleted_at = timezone.now()
        self.exam_subject.save(update_fields=["deleted_at"])

    def test_a_subject_removed_mid_import_is_a_row_error_not_a_failed_job(self) -> None:
        """The rows already written stay counted, and the report says why the rest stopped."""
        original = services.import_marks_row
        calls = []

        def remove_after_first_row(**kwargs):
            outcome = original(**kwargs)
            calls.append(outcome)
            if len(calls) == 1:
                self._remove_subject()
            return outcome

        with mock.patch.object(services, "import_marks_row", side_effect=remove_after_first_row):
            result, landed = self._queue_then(lambda: None, self._two_rows())

        self.assertEqual(landed, 1)
        self.assertEqual((result["succeeded"], result["failed"]), (1, 1))
        self.assertIn("removed", result["errors"][0]["issue"])

    def test_a_subject_removed_while_queued_fails_the_job_in_a_sentence(self) -> None:
        from core.jobs.models import BackgroundJob, JobStatus

        with self.captureOnCommitCallbacks() as callbacks:
            response = self.upload(self._sheet(self._two_rows()))
        with tenant_context(self.tenant.id):
            self._remove_subject()
        for callback in callbacks:
            callback()

        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=response.json()["data"]["job_id"])
        self.assertEqual(job.status, JobStatus.FAILED)
        self.assertIn("was removed", job.error)
        self.assertNotIn("matching query", job.error)

    def test_a_non_spreadsheet_upload_is_refused(self) -> None:
        response = self.upload(b"not a sheet", name="notes.txt")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_importing_needs_the_import_key(self) -> None:
        from django.core.files.uploadedfile import SimpleUploadedFile

        with tenant_context(self.tenant.id):
            entrant = UserFactory(tenant=self.tenant)
        grant(entrant, "exams.marks.create", scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, entrant)

        response = client.post(
            self.URL,
            {
                "exam_subject_id": str(self.exam_subject.pk),
                "file": SimpleUploadedFile("m.csv", b"admission_number\n", "text/csv"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


def _data_statements(captured) -> list[str]:
    """The statements that read or write a table, without SAVEPOINT or SET."""
    return [
        query["sql"]
        for query in captured.captured_queries
        if query["sql"].lstrip().upper().startswith(("SELECT", "INSERT", "UPDATE", "DELETE"))
    ]


class SubjectLockOrderTests(MarksTestCase):
    """Every marks writer, and the locker, locks the exam then the subject, before anything else.

    That order is the whole fix. A gate read under these locks cannot miss a
    `:lock-marks` or a processing run that commits beside it. One order on
    every path means no deadlock. The weak modes (`KEY SHARE`, `NO KEY UPDATE`)
    keep sitting writes, which hold the exam and insert rows referencing the
    subject, from deadlocking against them.
    """

    def assert_subject_lock_first(self, captured) -> None:
        exam_lock, subject_lock = _data_statements(captured)[:2]
        self.assertIn('FROM "exams"', exam_lock)
        self.assertIn("FOR KEY SHARE", exam_lock)
        self.assertIn('FROM "exam_subjects"', subject_lock)
        self.assertIn("FOR NO KEY UPDATE", subject_lock)

    def test_the_grid_locks_the_subject_first(self) -> None:
        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as captured:
            services.bulk_enter_marks(
                exam_subject=self.exam_subject,
                section=self.section,
                entries=[{"student_id": self.students[0].pk, "theory_marks": Decimal("60")}],
                user=self.user,
                actor_id=self.user.pk,
            )

        self.assert_subject_lock_first(captured)

    def test_an_imported_row_locks_the_subject_first(self) -> None:
        with tenant_context(self.tenant.id):
            enrollments = services.import_candidates_by_admission_number(
                exam_subject=self.exam_subject,
                user=self.user,
                permission="exams.marks.import",
            )
            with CaptureQueriesContext(connection) as captured:
                services.import_marks_row(
                    row={
                        "admission_number": self.students[0].admission_number,
                        "theory_marks": "60",
                    },
                    row_number=2,
                    exam_subject=self.exam_subject,
                    enrollments_by_number=enrollments,
                    actor_id=self.user.pk,
                )

        self.assert_subject_lock_first(captured)

    def test_lock_and_unlock_lock_the_subject_first(self) -> None:
        for change in (services.lock_marks, services.unlock_marks):
            with self.subTest(change=change.__name__):
                with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as captured:
                    change(exam_subject=self.exam_subject, actor_id=self.user.pk)

                self.assert_subject_lock_first(captured)


class ImportRecordScopeTests(CampusBMarksTestCase):
    """Plan, ruling 14: the import matches rows only against the students its key reaches.

    Against the old code the job read the whole class roll, so an `exam_staff` importer
    scoped to campus A wrote campus-B marks by CSV that `:bulk-entry` now refuses.
    """

    def _upload(self, client, rows: list[str]):
        from django.core.files.uploadedfile import SimpleUploadedFile

        header = ",".join(services.MARKS_IMPORT_COLUMNS)
        content = ("\n".join([header, *rows]) + "\n").encode()
        return client.post(
            MarksImportTests.URL,
            {
                "exam_subject_id": str(self.exam_subject.pk),
                "file": SimpleUploadedFile("marks.csv", content, content_type="text/csv"),
            },
            format="multipart",
        )

    def _job(self, job_id: str):
        from core.jobs.models import BackgroundJob

        with tenant_context(self.tenant.id):
            return BackgroundJob.objects.get(pk=job_id)

    def test_the_import_job_carries_the_request_s_key(self) -> None:
        response = self._upload(self.client, [f"{self.students[0].admission_number},60,,,,"])

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        job = self._job(response.json()["data"]["job_id"])
        self.assertEqual(job.payload.get("scope_permission"), ["exams.marks.import"])

    def test_a_campus_a_importer_s_campus_b_row_is_rejected_as_unknown(self) -> None:
        from core.jobs.models import JobStatus

        with tenant_context(self.tenant.id):
            importer = UserFactory(tenant=self.tenant)
            own_number = self.students[0].admission_number
            b_number = self.student_b.admission_number
        grant(importer, "exams.marks.import", scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)

        with self.captureOnCommitCallbacks(execute=True):
            response = self._upload(
                self._client(importer),
                [f"{own_number},60,,,,", f"{b_number},70,,,,", "NOT-A-STUDENT,55,,,,"],
            )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        job = self._job(response.json()["data"]["job_id"])
        self.assertEqual(job.status, JobStatus.SUCCEEDED, job.error)
        self.assertEqual(job.result["succeeded"], 1)
        out_of_scope, unknown = job.result["errors"]
        self.assertEqual(out_of_scope["field"], "admission_number")
        # Worded exactly as an unknown number, so the row says nothing about the student.
        self.assertEqual(
            out_of_scope["issue"].replace(repr(b_number), "<n>"),
            unknown["issue"].replace(repr("NOT-A-STUDENT"), "<n>"),
        )
        with tenant_context(self.tenant.id):
            b_marks = Marks.objects.filter(exam_subject=self.exam_subject, student=self.student_b)
            self.assertFalse(b_marks.exists())
        self.assertEqual(self._marks_written(), 1)

    def test_a_campus_b_student_in_a_campus_a_section_is_rejected_as_unknown(self) -> None:
        """Proves the per-student filter on the import: the section is the importer's,
        the student is on its roll, and only the key's scope over the student refuses them."""
        from core.jobs.models import JobStatus

        with tenant_context(self.tenant.id):
            importer = UserFactory(tenant=self.tenant)
            visitor = self._enrol(campus=self.campus_b, section=self.section)
            own_number = self.students[0].admission_number
            visitor_number = visitor.admission_number
        grant(importer, "exams.marks.import", scope=RecordScope.CAMPUS, scope_ref=self.campus.pk)

        with self.captureOnCommitCallbacks(execute=True):
            response = self._upload(
                self._client(importer),
                [f"{own_number},60,,,,", f"{visitor_number},70,,,,", "NOT-A-STUDENT,55,,,,"],
            )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        job = self._job(response.json()["data"]["job_id"])
        self.assertEqual(job.status, JobStatus.SUCCEEDED, job.error)
        self.assertEqual(job.result["succeeded"], 1)
        out_of_scope, unknown = job.result["errors"]
        self.assertEqual(
            out_of_scope["issue"].replace(repr(visitor_number), "<n>"),
            unknown["issue"].replace(repr("NOT-A-STUDENT"), "<n>"),
        )
        with tenant_context(self.tenant.id):
            self.assertFalse(Marks.objects.filter(student=visitor).exists())

    def test_a_legacy_import_job_without_the_key_fails_closed(self) -> None:
        """Queued before `scope_permission`: read under no key it would be empty, and
        under every role's scope it would leak, so it fails and says what to do."""
        import base64

        from core.exports.scope import MISSING_SCOPE_PERMISSION
        from core.jobs.models import JobStatus
        from core.jobs.services import create_job

        sheet = ",".join(services.MARKS_IMPORT_COLUMNS) + "\n"
        sheet += f"{self.students[0].admission_number},60,,,,\n"
        with tenant_context(self.tenant.id):
            job = create_job(
                tenant_id=self.tenant.pk,
                job_type="exams.marks-import",
                payload={
                    "exam_subject_id": str(self.exam_subject.pk),
                    "filename": "marks.csv",
                    "content_base64": base64.b64encode(sheet.encode()).decode(),
                    "requested_by": str(self.user.pk),
                },
                actor_id=self.user.pk,
            )

        tasks.import_marks_task(
            tenant_id=str(self.tenant.pk), job_id=str(job.pk), actor_id=str(self.user.pk)
        )

        job = self._job(str(job.pk))
        self.assertEqual(job.status, JobStatus.FAILED)
        self.assertEqual(job.error, MISSING_SCOPE_PERMISSION)
        self.assertEqual(self._marks_written(), 0)


class NoDirectWriteTests(MarksTestCase):
    def test_there_is_no_per_row_create_endpoint(self) -> None:
        """§16 declares `GET /marks` plus `:bulk-entry`. A per-row create would
        bypass the window, the lock, the allocation check and the eligible
        roll — all four of which the grid path applies together."""
        response = self.client.post(MARKS, {"student_id": str(self.students[0].pk)}, format="json")

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_status_cannot_be_set_to_locked_through_the_grid(self) -> None:
        """`locked` is `:lock-marks`'s to set, and a grid submit that could set
        it would let a teacher close their own window."""
        response = self.submit(self.entries(status=MarksStatus.LOCKED))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
