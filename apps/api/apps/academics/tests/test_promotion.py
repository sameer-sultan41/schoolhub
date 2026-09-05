"""The §7.2 promotion state machine.

The assertions that matter most: an approver cannot be the preparer, execution
is idempotent, and a batch that already produced enrollments cannot be reverted
out from under them.
"""

from __future__ import annotations

import uuid
from unittest import mock

from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from apps.academics import services, tasks
from apps.academics.models import PromotionDecision, PromotionStatus, StudentPromotion
from apps.academics.serializers import PromotionDecisionSerializer
from apps.academics.tests.base import AcademicsAPITestCase
from apps.academics.tests.factories import (
    SectionFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.student_management.models import EnrollmentStatus, StudentEnrollment
from apps.student_management.tests.factories import (
    EmergencyContactFactory,
    GuardianFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
)
from core.api.exceptions import Conflict
from core.jobs.models import BackgroundJob, JobStatus
from core.notifications.models import Notification
from core.tenancy.context import tenant_context

PREPARE_KEYS = (
    "academics.promotion.create",
    "academics.promotion.view",
    "academics.promotion.update",
)


class PromotionTestCase(AcademicsAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.student = StudentFactory(tenant=self.tenant, campus=self.campus)
            # enroll_student requires >=1 guardian and >=1 emergency contact
            # (student-management §11), and execution goes through it.
            guardian = GuardianFactory(tenant=self.tenant)
            StudentGuardianFactory(tenant=self.tenant, student=self.student, guardian=guardian)
            EmergencyContactFactory(tenant=self.tenant, student=self.student)
            self.enrollment = StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )

    def create_batch(self) -> str:
        response = self.client.post(
            "/api/v1/student-promotions",
            {
                "from_academic_session_id": str(self.session.pk),
                "to_academic_session_id": str(self.next_session.pk),
                "class_id": str(self.school_class.pk),
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        return response.json()["data"]["batch_id"]

    def second_user(self, *keys: str):
        """A distinct principal — segregation of duties needs two identities."""
        approver = UserFactory(tenant=self.tenant)
        grant(approver, *keys)
        return approver

    def _approved_batch(self, **decision_fields) -> str:
        """A batch sitting in `approved`, ready for `:execute`.

        `decision_fields` are written straight onto the rows rather than through
        the decision endpoint, deliberately: some of what `_execute_one` guards
        is unreachable through the API, and a gate is only a last gate if it is
        tested against a row the serializer never saw.
        """
        self.allow(*PREPARE_KEYS, "academics.promotion.execute")
        batch_id = self.create_batch()
        with tenant_context(self.tenant.id):
            StudentPromotion.objects.alive().filter(batch_id=batch_id).update(
                to_section_id=self.next_section.pk, **decision_fields
            )
        self.client.post(f"/api/v1/student-promotions/{batch_id}:submit", {}, format="json")

        approver = self.second_user("academics.promotion.approve")
        authenticate(self.client, approver)
        self.client.post(f"/api/v1/student-promotions/{batch_id}:approve", {}, format="json")
        authenticate(self.client, self.user)
        return batch_id

    def _execute(self, batch_id: str, **extra) -> BackgroundJob:
        response = self.client.post(
            f"/api/v1/student-promotions/{batch_id}:execute", {}, format="json", **extra
        )
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        with tenant_context(self.tenant.id):
            return BackgroundJob.objects.get(pk=response.json()["data"]["job_id"])


class CreateBatchTests(PromotionTestCase):
    def test_proposes_one_decision_per_actively_enrolled_student(self) -> None:
        self.allow(*PREPARE_KEYS)

        batch_id = self.create_batch()

        with tenant_context(self.tenant.id):
            rows = list(StudentPromotion.objects.alive().filter(batch_id=batch_id))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].decision, PromotionDecision.PROMOTED)
        self.assertEqual(rows[0].to_class_id, self.next_class.pk)
        self.assertEqual(rows[0].status, PromotionStatus.DRAFT)

    def test_the_proposal_records_that_no_rule_inputs_were_available(self) -> None:
        """Results and attendance do not exist yet; the basis must say so.

        A reviewer must not read a level-only proposal as a judgement informed
        by results the system never had.
        """
        self.allow(*PREPARE_KEYS)

        batch_id = self.create_batch()

        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertFalse(row.decision_basis["results_available"])
        self.assertFalse(row.decision_basis["attendance_available"])

    def test_a_top_level_class_graduates_rather_than_promoting(self) -> None:
        self.allow(*PREPARE_KEYS)

        response = self.client.post(
            "/api/v1/student-promotions",
            {
                "from_academic_session_id": str(self.session.pk),
                "to_academic_session_id": str(self.next_session.pk),
                "class_id": str(self.next_class.pk),
            },
            format="json",
        )

        # No students are enrolled in the top class here, so there is nothing to
        # propose. ExecutionTests.test_execute_graduates_a_top_level_student
        # covers the graduating decision itself.
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_a_duplicate_batch_for_the_same_pair_is_a_conflict(self) -> None:
        self.allow(*PREPARE_KEYS)
        self.create_batch()

        response = self.client.post(
            "/api/v1/student-promotions",
            {
                "from_academic_session_id": str(self.session.pk),
                "to_academic_session_id": str(self.next_session.pk),
                "class_id": str(self.school_class.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)


class BatchResourceTests(PromotionTestCase):
    """`/student-promotions` is the batch resource — every `{id}` is a batch id.

    Before this, GET and PATCH resolved a decision-row id while the colon-actions
    resolved a batch id, so one prefix carried two id spaces.
    """

    def test_listing_returns_one_entry_per_batch_not_per_student(self) -> None:
        self.allow(*PREPARE_KEYS)
        with tenant_context(self.tenant.id):
            second = StudentFactory(tenant=self.tenant, campus=self.campus)
            guardian = GuardianFactory(tenant=self.tenant)
            StudentGuardianFactory(tenant=self.tenant, student=second, guardian=guardian)
            EmergencyContactFactory(tenant=self.tenant, student=second)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=second,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )
        batch_id = self.create_batch()

        rows = self.client.get("/api/v1/student-promotions").json()["data"]

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["batch_id"], batch_id)
        self.assertEqual(rows[0]["students"], 2)
        self.assertEqual(rows[0]["status"], PromotionStatus.DRAFT)

    def test_retrieving_a_batch_returns_it_with_its_decisions(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()

        response = self.client.get(f"/api/v1/student-promotions/{batch_id}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        body = response.json()["data"]
        self.assertEqual(body["batch_id"], batch_id)
        self.assertEqual(body["students"], 1)
        self.assertEqual(len(body["decisions"]), 1)
        # The review screen needs a person, not a UUID.
        self.assertEqual(
            body["decisions"][0]["student_name"],
            f"{self.student.first_name} {self.student.last_name}",
        )
        self.assertEqual(body["decisions"][0]["admission_number"], self.student.admission_number)

    def test_retrieving_an_unknown_batch_is_404(self) -> None:
        self.allow(*PREPARE_KEYS)
        import uuid as _uuid

        response = self.client.get(f"/api/v1/student-promotions/{_uuid.uuid4()}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_malformed_batch_id_is_404_not_500(self) -> None:
        self.allow(*PREPARE_KEYS)

        response = self.client.get("/api/v1/student-promotions/not-a-uuid")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class ApprovalTests(PromotionTestCase):
    def test_the_preparer_cannot_approve_their_own_batch(self) -> None:
        """RBAC §2.4 segregation of duties — the rule this workflow exists for."""
        self.allow(*PREPARE_KEYS, "academics.promotion.approve")
        batch_id = self.create_batch()
        self.client.post(f"/api/v1/student-promotions/{batch_id}:submit", {}, format="json")

        response = self.client.post(
            f"/api/v1/student-promotions/{batch_id}:approve", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertEqual(row.status, PromotionStatus.PENDING_APPROVAL)

    def test_a_different_user_can_approve(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        self.client.post(f"/api/v1/student-promotions/{batch_id}:submit", {}, format="json")

        approver = self.second_user("academics.promotion.approve")
        authenticate(self.client, approver)
        response = self.client.post(
            f"/api/v1/student-promotions/{batch_id}:approve", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertEqual(row.status, PromotionStatus.APPROVED)
        self.assertEqual(row.approved_by, approver.pk)
        self.assertIsNotNone(row.approved_at)

    def test_approving_a_draft_batch_is_a_conflict(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()

        approver = self.second_user("academics.promotion.approve")
        authenticate(self.client, approver)
        response = self.client.post(
            f"/api/v1/student-promotions/{batch_id}:approve", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_rejecting_returns_the_batch_to_draft(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        self.client.post(f"/api/v1/student-promotions/{batch_id}:submit", {}, format="json")

        approver = self.second_user("academics.promotion.approve")
        authenticate(self.client, approver)
        self.client.post(f"/api/v1/student-promotions/{batch_id}:reject", {}, format="json")

        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertEqual(row.status, PromotionStatus.DRAFT)

    def test_a_submitted_decision_can_no_longer_be_edited(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        self.client.post(f"/api/v1/student-promotions/{batch_id}:submit", {}, format="json")

        response = self.client.patch(
            f"/api/v1/student-promotions/{batch_id}/decisions/{self.student.pk}",
            {"remarks": "late"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_a_draft_decision_is_editable_by_batch_and_student(self) -> None:
        """§16's addressing: a reviewer has the student in hand, not a row id."""
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()

        response = self.client.patch(
            f"/api/v1/student-promotions/{batch_id}/decisions/{self.student.pk}",
            {"remarks": "borderline"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertEqual(row.remarks, "borderline")

    def test_editing_a_student_not_in_the_batch_is_404(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        with tenant_context(self.tenant.id):
            stranger = StudentFactory(tenant=self.tenant, campus=self.campus)

        response = self.client.patch(
            f"/api/v1/student-promotions/{batch_id}/decisions/{stranger.pk}",
            {"remarks": "x"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class ExecutionTests(PromotionTestCase):
    """`:execute` is `202` + a job (§7.2).

    `CELERY_TASK_ALWAYS_EAGER` (config/settings/test.py) runs the task inside the
    request, so by the time the response comes back the job has already reached
    its terminal state and `_execute` can just read the row instead of polling.
    The one thing that hides is whether the *view* did the work rather than the
    task, which is why the first test below stubs `.delay` out entirely.
    """

    def test_execute_queues_the_work_instead_of_doing_it_in_the_request(self) -> None:
        """The gap §7.2 always described and the endpoint shipped without.

        Run in the request, `execute_batch`'s per-student `tenant_atomic` is a
        savepoint under `ATOMIC_REQUESTS` rather than a committing transaction,
        so a class of hundreds holds every row lock it takes until the response
        is rendered. With `.delay` stubbed the response must still come back
        immediately, having written nothing.
        """
        batch_id = self._approved_batch()

        with mock.patch.object(tasks.execute_promotion_batch_task, "delay") as delay:
            delay.return_value = mock.Mock(id="celery-task-1")
            response = self.client.post(
                f"/api/v1/student-promotions/{batch_id}:execute", {}, format="json"
            )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        job_id = response.json()["data"]["job_id"]
        delay.assert_called_once_with(
            tenant_id=str(self.tenant.pk), job_id=job_id, actor_id=str(self.user.pk)
        )
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=job_id)
            enrolled = StudentEnrollment.objects.alive().filter(academic_session=self.next_session)
        self.assertEqual(job.job_type, "promotion.execute")
        self.assertEqual(job.payload["batch_id"], batch_id)
        self.assertEqual(job.celery_task_id, "celery-task-1")
        self.assertEqual(job.status, JobStatus.QUEUED)
        self.assertFalse(enrolled.exists(), "the request must not have executed the batch itself")

    def test_execution_creates_the_next_session_enrollment(self) -> None:
        batch_id = self._approved_batch()

        job = self._execute(batch_id)

        self.assertEqual(job.status, JobStatus.SUCCEEDED)
        self.assertEqual(job.progress, 100)
        self.assertEqual(len(job.result["enrolled"]), 1)
        self.assertEqual(job.result["failed"], [])

        with tenant_context(self.tenant.id):
            new = StudentEnrollment.objects.alive().get(
                student=self.student, academic_session=self.next_session
            )
            old = StudentEnrollment.objects.alive().get(pk=self.enrollment.pk)
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertEqual(new.school_class_id, self.next_class.pk)
        self.assertEqual(old.status, EnrollmentStatus.PROMOTED)
        self.assertEqual(row.status, PromotionStatus.EXECUTED)
        self.assertIsNotNone(row.executed_at)

    def test_a_replayed_idempotency_key_rejoins_the_job_already_in_flight(self) -> None:
        """A retry after a timeout must not queue a second execution."""
        batch_id = self._approved_batch()
        first = self._execute(batch_id, HTTP_IDEMPOTENCY_KEY="one-intent")

        second = self._execute(batch_id, HTTP_IDEMPOTENCY_KEY="one-intent")

        self.assertEqual(second.pk, first.pk)
        with tenant_context(self.tenant.id):
            self.assertEqual(BackgroundJob.objects.count(), 1)

    def test_re_execution_is_a_no_op(self) -> None:
        """§11: "re-execution attempts are no-ops"."""
        batch_id = self._approved_batch()
        self._execute(batch_id)

        # A different Idempotency-Key, so this is the service's own per-row skip
        # doing the work rather than the 24h replay cache.
        second = self._execute(batch_id, HTTP_IDEMPOTENCY_KEY="a-different-key")

        self.assertEqual(second.result["skipped"][0]["reason"], "already executed")
        with tenant_context(self.tenant.id):
            count = (
                StudentEnrollment.objects.alive()
                .filter(student=self.student, academic_session=self.next_session)
                .count()
            )
        self.assertEqual(count, 1, "a re-run must not create a second enrollment")

    def test_executing_an_unapproved_batch_is_a_conflict(self) -> None:
        """Refused at request time, not by a job that fails minutes later."""
        self.allow(*PREPARE_KEYS, "academics.promotion.execute")
        batch_id = self.create_batch()

        response = self.client.post(
            f"/api/v1/student-promotions/{batch_id}:execute", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        with tenant_context(self.tenant.id):
            self.assertEqual(BackgroundJob.objects.count(), 0, "nothing may have been queued")

    def test_execution_without_a_target_section_reports_a_per_student_failure(self) -> None:
        """One student's problem must not discard the rest of the batch."""
        self.allow(*PREPARE_KEYS, "academics.promotion.execute")
        batch_id = self.create_batch()
        self.client.post(f"/api/v1/student-promotions/{batch_id}:submit", {}, format="json")
        approver = self.second_user("academics.promotion.approve")
        authenticate(self.client, approver)
        self.client.post(f"/api/v1/student-promotions/{batch_id}:approve", {}, format="json")
        authenticate(self.client, self.user)

        job = self._execute(batch_id)

        # The job succeeded: a per-student failure is a reported outcome, not a
        # failed run — the job itself only fails when the batch never ran at all.
        self.assertEqual(job.status, JobStatus.SUCCEEDED)
        self.assertEqual(len(job.result["failed"]), 1)
        self.assertEqual(job.result["enrolled"], [])

    def test_reverting_after_execution_is_blocked_by_the_new_enrollments(self) -> None:
        batch_id = self._approved_batch()
        self._execute(batch_id)

        response = self.client.post(
            f"/api/v1/student-promotions/{batch_id}:revert", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_execute_graduates_a_top_level_student(self) -> None:
        """The GRADUATED branch: the source enrollment closes, none is created."""
        self.allow(*PREPARE_KEYS, "academics.promotion.execute")
        with tenant_context(self.tenant.id):
            top_student = StudentFactory(tenant=self.tenant, campus=self.campus)
            guardian = GuardianFactory(tenant=self.tenant)
            StudentGuardianFactory(tenant=self.tenant, student=top_student, guardian=guardian)
            EmergencyContactFactory(tenant=self.tenant, student=top_student)
            top_section = SectionFactory(
                tenant=self.tenant, school_class=self.next_class, campus=self.campus
            )
            top_enrollment = StudentEnrollmentFactory(
                tenant=self.tenant,
                student=top_student,
                academic_session=self.session,
                school_class=self.next_class,
                section=top_section,
            )

        response = self.client.post(
            "/api/v1/student-promotions",
            {
                "from_academic_session_id": str(self.session.pk),
                "to_academic_session_id": str(self.next_session.pk),
                "class_id": str(self.next_class.pk),
            },
            format="json",
        )
        batch_id = response.json()["data"]["batch_id"]

        self.client.post(f"/api/v1/student-promotions/{batch_id}:submit", {}, format="json")
        approver = self.second_user("academics.promotion.approve")
        authenticate(self.client, approver)
        self.client.post(f"/api/v1/student-promotions/{batch_id}:approve", {}, format="json")
        authenticate(self.client, self.user)

        job = self._execute(batch_id)

        self.assertEqual(len(job.result["graduated"]), 1)
        self.assertEqual(job.result["enrolled"], [])
        with tenant_context(self.tenant.id):
            closed = StudentEnrollment.objects.alive().get(pk=top_enrollment.pk)
            created = StudentEnrollment.objects.alive().filter(
                student=top_student, academic_session=self.next_session
            )
        self.assertEqual(closed.status, EnrollmentStatus.GRADUATED)
        self.assertFalse(created.exists(), "a graduate gets no next-session enrollment")

    def test_reverting_a_draft_batch_succeeds(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()

        response = self.client.post(
            f"/api/v1/student-promotions/{batch_id}:revert", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertEqual(row.status, PromotionStatus.REVERTED)


class RetentionTests(PromotionTestCase):
    """§6: "retained students re-enroll in the same class next session".

    The rule was written into the doc and enforced nowhere — not in the
    serializer, not in `submit_batch`, not in `_execute_one` — so a retained
    student could be promoted a level up with the word "retained" on the record
    and the source enrollment closed as `retained` to match.
    """

    def _patch(self, batch_id: str, payload: dict):
        return self.client.patch(
            f"/api/v1/student-promotions/{batch_id}/decisions/{self.student.pk}",
            payload,
            format="json",
        )

    def test_retaining_a_student_into_another_class_is_a_field_error(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()

        response = self._patch(
            batch_id,
            {"decision": PromotionDecision.RETAINED, "to_class_id": str(self.next_class.pk)},
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("to_class_id", {row["field"] for row in response.json()["error"]["details"]})
        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertEqual(
            row.decision, PromotionDecision.PROMOTED, "the refused PATCH must not save"
        )

    def test_flipping_the_decision_and_leaving_the_proposed_target_is_caught(self) -> None:
        """The likelier mistake: the proposal already points a level up."""
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()

        response = self._patch(batch_id, {"decision": PromotionDecision.RETAINED})

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_retaining_into_the_same_class_is_accepted(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()

        response = self._patch(
            batch_id,
            {"decision": PromotionDecision.RETAINED, "to_class_id": str(self.school_class.pk)},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertEqual(row.decision, PromotionDecision.RETAINED)
        self.assertEqual(row.to_class_id, self.school_class.pk)

    def test_execution_refuses_a_retained_row_that_never_went_through_the_form(self) -> None:
        """The last gate. A bulk writer or a later job has no serializer in it."""
        batch_id = self._approved_batch(
            decision=PromotionDecision.RETAINED, override_reason="Repeating the year."
        )

        job = self._execute(batch_id)

        self.assertEqual(job.result["enrolled"], [])
        self.assertEqual(len(job.result["failed"]), 1)
        self.assertIn("same class", job.result["failed"][0]["error"])
        with tenant_context(self.tenant.id):
            created = StudentEnrollment.objects.alive().filter(
                student=self.student, academic_session=self.next_session
            )
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertFalse(created.exists(), "the wrong class must not have been enrolled into")
        self.assertEqual(row.status, PromotionStatus.APPROVED, "a refused row stays executable")


class BatchRaceTests(PromotionTestCase):
    """The state machine with two callers in it at once (§7.2).

    A batch's status moves batch-wide, so an interleaved pair of transitions is
    not a partial write to reconcile afterwards — it is a batch in a state the
    workflow has no name for. Both layers are asserted: the lock the status check
    takes, and the status the UPDATE itself re-states.
    """

    def _pending_batch(self) -> str:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        self.client.post(f"/api/v1/student-promotions/{batch_id}:submit", {}, format="json")
        return batch_id

    def test_the_status_check_reads_its_rows_under_a_lock(self) -> None:
        batch_id = self._pending_batch()

        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            CaptureQueriesContext(connection) as captured,
        ):
            services.assert_batch_in_status(
                batch_id=uuid.UUID(batch_id), expected=PromotionStatus.PENDING_APPROVAL
            )

        self.assertTrue(
            any("FOR UPDATE" in query["sql"] for query in captured.captured_queries),
            "rows a transition is about to rewrite must be locked while it decides",
        )

    def test_a_decision_patch_reads_its_row_under_a_lock_too(self) -> None:
        """The edit path had none: a plain SELECT, then a bare UPDATE by pk."""
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()

        with CaptureQueriesContext(connection) as captured:
            response = self.client.patch(
                f"/api/v1/student-promotions/{batch_id}/decisions/{self.student.pk}",
                {"remarks": "borderline"},
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertTrue(
            any("FOR UPDATE" in query["sql"] for query in captured.captured_queries),
            "the row a PATCH is about to rewrite must be locked while its status is checked",
        )

    def test_a_decision_patch_whose_batch_was_submitted_first_is_refused(self) -> None:
        """The losing half of a simultaneous `:submit` and a decision edit.

        With `status` only read and never restated in the UPDATE's own WHERE, the
        edit lands on a row that is already under review — a reviewer's remark
        appearing on a batch a principal is at that moment approving.
        """
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        validated = PromotionDecisionSerializer.validate

        def submit_between_the_check_and_the_write(serializer, attrs):
            attrs = validated(serializer, attrs)
            services.batch_queryset(uuid.UUID(batch_id)).update(
                status=PromotionStatus.PENDING_APPROVAL
            )
            return attrs

        with mock.patch.object(
            PromotionDecisionSerializer, "validate", submit_between_the_check_and_the_write
        ):
            response = self.client.patch(
                f"/api/v1/student-promotions/{batch_id}/decisions/{self.student.pk}",
                {"remarks": "borderline"},
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertIsNone(row.remarks, "a refused edit must leave the row untouched")

    def test_a_transition_whose_rows_moved_first_is_a_conflict_not_a_half_write(self) -> None:
        """The losing half of a simultaneous `:approve` and `:reject`.

        With the status only checked and never re-stated in the UPDATE, both
        writes land and the batch ends up rejected with an approver's name on it
        — which `promotions_approval_fields_together` permits, because it only
        couples `approved_by` with `approved_at`.
        """
        batch_id = self._pending_batch()
        approver = self.second_user("academics.promotion.approve")
        checked = services.assert_batch_in_status

        def reject_between_the_check_and_the_write(*, batch_id, expected):
            rows = checked(batch_id=batch_id, expected=expected)
            services.batch_queryset(batch_id).update(status=PromotionStatus.DRAFT)
            return rows

        with (
            tenant_context(self.tenant.id),
            mock.patch.object(
                services, "assert_batch_in_status", reject_between_the_check_and_the_write
            ),
            self.assertRaises(Conflict),
        ):
            services.approve_batch(batch_id=uuid.UUID(batch_id), actor_id=approver.pk)

        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertIsNone(row.approved_by, "a refused approval must leave no approval trail")

    def test_execution_skips_a_row_reverted_after_the_snapshot_was_taken(self) -> None:
        """The window `execute_batch`'s deliberate per-student commits leave open.

        The row list is read once, outside any lock, so a `:revert` landing
        mid-loop used to leave execution creating enrollments for every student
        still in that snapshot.
        """
        self.allow(*PREPARE_KEYS, "academics.promotion.execute")
        with tenant_context(self.tenant.id):
            classmate = StudentFactory(tenant=self.tenant, campus=self.campus)
            guardian = GuardianFactory(tenant=self.tenant)
            StudentGuardianFactory(tenant=self.tenant, student=classmate, guardian=guardian)
            EmergencyContactFactory(tenant=self.tenant, student=classmate)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=classmate,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )
        batch_id = self.create_batch()
        with tenant_context(self.tenant.id):
            StudentPromotion.objects.alive().filter(batch_id=batch_id).update(
                to_section_id=self.next_section.pk
            )
        self.client.post(f"/api/v1/student-promotions/{batch_id}:submit", {}, format="json")
        approver = self.second_user("academics.promotion.approve")
        authenticate(self.client, approver)
        self.client.post(f"/api/v1/student-promotions/{batch_id}:approve", {}, format="json")
        authenticate(self.client, self.user)

        execute_one = services._execute_one
        reverted: list[str] = []

        def revert_the_rest_after_the_first_student(**kwargs) -> None:
            execute_one(**kwargs)
            if not reverted:
                reverted.append("done")
                services.batch_queryset(kwargs["row"].batch_id).exclude(
                    status=PromotionStatus.EXECUTED
                ).update(status=PromotionStatus.REVERTED)

        with (
            tenant_context(self.tenant.id),
            mock.patch.object(services, "_execute_one", revert_the_rest_after_the_first_student),
        ):
            report = services.execute_batch(
                batch_id=uuid.UUID(batch_id), tenant_id=self.tenant.pk, actor_id=self.user.pk
            )

        self.assertEqual(len(report["enrolled"]), 1)
        self.assertEqual(len(report["skipped"]), 1)
        self.assertIn("no longer approved", report["skipped"][0]["reason"])
        with tenant_context(self.tenant.id):
            created = (
                StudentEnrollment.objects.alive().filter(academic_session=self.next_session).count()
            )
        self.assertEqual(created, 1, "the reverted half of the batch must not be enrolled")


class PromotionNotificationTests(PromotionTestCase):
    """§12's two promotion triggers, registered since the module shipped but,
    until now, never emitted."""

    def _notifications(self, event_key: str) -> list[Notification]:
        with tenant_context(self.tenant.id):
            return list(Notification.objects.filter(event_key=event_key))

    def test_submitting_a_batch_tells_everyone_who_can_approve_it(self) -> None:
        self.allow(*PREPARE_KEYS)
        approver = self.second_user("academics.promotion.approve")
        batch_id = self.create_batch()

        response = self.client.post(
            f"/api/v1/student-promotions/{batch_id}:submit", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        pending = self._notifications("academics.promotion-pending")
        self.assertEqual([row.user_id for row in pending], [approver.pk])
        self.assertIn(self.school_class.name, pending[0].body)

    def test_the_preparer_is_never_asked_to_approve_their_own_batch(self) -> None:
        """Asking them would be an instruction `approve_batch` then refuses."""
        self.allow(*PREPARE_KEYS, "academics.promotion.approve")
        batch_id = self.create_batch()

        self.client.post(f"/api/v1/student-promotions/{batch_id}:submit", {}, format="json")

        self.assertEqual(self._notifications("academics.promotion-pending"), [])

    def test_approving_tells_the_preparer_the_outcome(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        self.client.post(f"/api/v1/student-promotions/{batch_id}:submit", {}, format="json")
        approver = self.second_user("academics.promotion.approve")
        authenticate(self.client, approver)

        self.client.post(f"/api/v1/student-promotions/{batch_id}:approve", {}, format="json")

        outcome = self._notifications("academics.promotion-outcome")
        self.assertEqual([row.user_id for row in outcome], [self.user.pk])
        self.assertIn("approved", outcome[0].body)

    def test_rejecting_tells_the_preparer_too(self) -> None:
        """The reviewer who has to act on a rejection is the one who prepared it."""
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        self.client.post(f"/api/v1/student-promotions/{batch_id}:submit", {}, format="json")
        approver = self.second_user("academics.promotion.approve")
        authenticate(self.client, approver)

        self.client.post(f"/api/v1/student-promotions/{batch_id}:reject", {}, format="json")

        outcome = self._notifications("academics.promotion-outcome")
        self.assertEqual([row.user_id for row in outcome], [self.user.pk])
        self.assertIn("returned to draft", outcome[0].body)
