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

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations import services
from apps.examinations.models import ExamStatus, Marks, MarksStatus
from apps.examinations.tests.base import ExaminationsAPITestCase
from apps.examinations.tests.factories import (
    ExamFactory,
    ExamSubjectFactory,
    MarksFactory,
    StudentFactory,
    UserFactory,
    authenticate,
    grant,
    open_marks_entry,
)
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

    def submit(self, entries=None, client=None):
        return (client or self.client).post(
            BULK_ENTRY,
            {"exam_subject_id": str(self.exam_subject.pk), "entries": entries or self.entries()},
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
            {"exam_subject_id": str(self.exam_subject.pk), "entries": self.entries()},
            format="json",
            **{"HTTP_IDEMPOTENCY_KEY": "grid-1"},
        )
        second = self.client.post(
            BULK_ENTRY,
            {"exam_subject_id": str(self.exam_subject.pk), "entries": self.entries()},
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
        grant(user, "exams.marks.create", scope=RecordScope.ASSIGNED)
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
        with tenant_context(self.tenant.id):
            stranger_user = UserFactory(tenant=self.tenant)
            from apps.examinations.tests.factories import StaffFactory

            StaffFactory(tenant=self.tenant, campus=self.campus, user_id=stranger_user.pk)
        client = self._teacher_client(stranger_user)

        response = self.submit(client=client)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("not currently allocated", str(response.json()))

    def test_an_account_with_no_staff_row_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            orphan = UserFactory(tenant=self.tenant)
        client = self._teacher_client(orphan)

        response = self.submit(client=client)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("no active staff record", str(response.json()))

    def test_an_all_scoped_caller_needs_no_allocation(self) -> None:
        """Many `exam_staff` and admin users have no `Staff` row at all, so
        requiring an allocation would break the legitimate case — the same early
        return `attendance.assert_marker_may_mark_section` makes."""
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
        grant(self.subject_teacher_user, "exams.marks.create", scope=RecordScope.ASSIGNED)
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
        """Two queries flat, whatever the size of the exam. The obvious shape —
        for each subject, count its marks — is a query per subject, and an exam
        covers every subject in every year group."""
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
            services.marks_entry_progress(exam=self.exam)

        self.assertLessEqual(len(captured.captured_queries), 3)

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

    def test_a_bad_row_is_reported_and_the_good_rows_still_land(self) -> None:
        """The contrast with `:bulk-entry`, and the whole reason the import has
        its own path: §6 asks to re-import failed rows only, which needs a
        per-row verdict."""
        with tenant_context(self.tenant.id):
            students = {student.admission_number: student for student in self.students}
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
                    students_by_number=students,
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
                students_by_number={self.students[0].admission_number: self.students[0]},
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
                students_by_number={self.students[0].admission_number: self.students[0]},
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
