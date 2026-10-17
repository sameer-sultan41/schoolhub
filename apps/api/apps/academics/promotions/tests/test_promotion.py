"""The §7.2 promotion state machine.

The assertions that matter most: an approver cannot be the preparer, execution
is idempotent, and a batch that already produced enrollments cannot be reverted
out from under them.
"""

from __future__ import annotations

import uuid
from unittest import mock

from django.contrib.admin import AdminSite
from django.db import connection, transaction
from django.test import SimpleTestCase
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from apps.academics import tasks
from apps.academics.admin import StudentPromotionAdmin
from apps.academics.models import PromotionDecision, PromotionStatus, StudentPromotion
from apps.academics.promotions import services
from apps.academics.promotions.serializers import (
    PromotionBatchCreatedSerializer,
    PromotionBatchDetailSerializer,
    PromotionDecisionSerializer,
)
from apps.academics.tests.base import AcademicsAPITestCase
from apps.academics.tests.factories import (
    ClassFactory,
    SectionFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.school_organization.models import Class, SessionStatus
from apps.student_management.models import EnrollmentStatus, StudentEnrollment
from apps.student_management.tests.factories import (
    EmergencyContactFactory,
    GuardianFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
)
from core.api.exceptions import Conflict, DomainRuleViolation
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

    def create_batch(self, school_class=None) -> str:
        response = self.client.post(
            "/api/v1/student-promotions",
            {
                "from_academic_session_id": str(self.session.pk),
                "to_academic_session_id": str(self.next_session.pk),
                "class_id": str((school_class or self.school_class).pk),
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        return response.json()["data"]["batch_id"]

    def enroll_classmate(self, school_class=None, section=None):
        """Another actively enrolled student, ready to be proposed in a batch."""
        with tenant_context(self.tenant.id):
            student = StudentFactory(tenant=self.tenant, campus=self.campus)
            guardian = GuardianFactory(tenant=self.tenant)
            StudentGuardianFactory(tenant=self.tenant, student=student, guardian=guardian)
            EmergencyContactFactory(tenant=self.tenant, student=student)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=student,
                academic_session=self.session,
                school_class=school_class or self.school_class,
                section=section or self.section,
            )
        return student

    def patch_decision(self, batch_id: str, payload: dict, student=None):
        """The raw response, for tests that expect a refusal."""
        return self.client.patch(
            f"/api/v1/student-promotions/{batch_id}/decisions/{(student or self.student).pk}",
            payload,
            format="json",
        )

    def edit_decision(self, batch_id: str, payload: dict, student=None) -> dict:
        response = self.patch_decision(batch_id, payload, student)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return response.json()["data"]

    def transition(self, batch_id: str, action: str):
        return self.client.post(
            f"/api/v1/student-promotions/{batch_id}:{action}", {}, format="json"
        )

    def second_user(self, *keys: str):
        """A distinct principal — segregation of duties needs two identities."""
        approver = UserFactory(tenant=self.tenant)
        grant(approver, *keys)
        return approver

    def close_target_session(self) -> None:
        with tenant_context(self.tenant.id):
            self.next_session.status = SessionStatus.CLOSED
            self.next_session.save(update_fields=["status"])

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

    def test_the_proposal_is_recorded_at_creation(self) -> None:
        self.allow(*PREPARE_KEYS)

        batch_id = self.create_batch()

        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertEqual(row.decision_basis["proposed_decision"], PromotionDecision.PROMOTED)
        self.assertEqual(row.decision_basis["proposed_to_class_id"], str(self.next_class.pk))

    def test_a_graduating_proposal_is_recorded_with_a_null_target(self) -> None:
        """The key is present and null, which is what tells it from a pre-recording row."""
        self.allow(*PREPARE_KEYS)
        self.enroll_classmate(self.next_class, self.next_section)

        batch_id = self.create_batch(self.next_class)

        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertEqual(row.decision, PromotionDecision.GRADUATED)
        self.assertEqual(row.decision_basis["proposed_decision"], PromotionDecision.GRADUATED)
        self.assertIn("proposed_to_class_id", row.decision_basis)
        self.assertIsNone(row.decision_basis["proposed_to_class_id"])

    def test_creating_a_batch_returns_its_id_and_row_count(self) -> None:
        self.allow(*PREPARE_KEYS)
        self.enroll_classmate()

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
        body = response.json()["data"]
        self.assertEqual(set(body), set(PromotionBatchCreatedSerializer().fields))
        self.assertEqual(body["students"], 2)
        with tenant_context(self.tenant.id):
            stored = StudentPromotion.objects.alive().filter(batch_id=body["batch_id"]).count()
        self.assertEqual(stored, 2, "the id returned must be the id the rows were written under")

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

    def test_a_stray_list_filter_does_not_shrink_or_hide_a_batch(self) -> None:
        """The list's filters belong to the list: a detail read is the whole batch or a 404."""
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()

        response = self.client.get(
            f"/api/v1/student-promotions/{batch_id}", {"decision": PromotionDecision.RETAINED}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["students"], 1)
        self.assertEqual(len(response.json()["data"]["decisions"]), 1)

    def test_the_admin_cannot_edit_the_recorded_proposal(self) -> None:
        model_admin = StudentPromotionAdmin(StudentPromotion, AdminSite())

        self.assertIn("decision_basis", model_admin.get_readonly_fields(mock.Mock()))

    def test_batch_detail_matches_its_serializer(self) -> None:
        """Keys come from the serializer, so a hand-built dict cannot drift from the schema."""
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()

        body = self.client.get(f"/api/v1/student-promotions/{batch_id}").json()["data"]

        self.assertEqual(set(body), set(PromotionBatchDetailSerializer().fields))
        self.assertEqual(set(body["decisions"][0]), set(PromotionDecisionSerializer().fields))

    def test_the_batch_and_its_decisions_carry_names_not_just_ids(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()

        body = self.client.get(f"/api/v1/student-promotions/{batch_id}").json()["data"]

        self.assertEqual(body["from_class_name"], self.school_class.name)
        self.assertEqual(body["from_academic_session_name"], self.session.name)
        self.assertEqual(body["to_academic_session_name"], self.next_session.name)
        decision = body["decisions"][0]
        self.assertEqual(decision["from_class_name"], self.school_class.name)
        self.assertEqual(decision["to_class_name"], self.next_class.name)
        self.assertIsNone(decision["to_section_name"], "no section has been chosen yet")

    def test_decision_names_follow_an_edit(self) -> None:
        """A PATCH answers with the edited row, so its names must be the new ones."""
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()

        with_section = self.edit_decision(batch_id, {"to_section_id": str(self.next_section.pk)})
        graduated = self.edit_decision(batch_id, {"decision": "graduated", "to_class_id": None})

        self.assertEqual(with_section["to_section_name"], self.next_section.name)
        self.assertEqual(with_section["to_class_name"], self.next_class.name)
        self.assertIsNone(graduated["to_class_name"])

    def test_a_decision_patch_cannot_rewrite_the_recorded_proposal(self) -> None:
        """`proposed_*` is what submit compares an edit against, so an edit must not move it."""
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        with tenant_context(self.tenant.id):
            recorded = StudentPromotion.objects.alive().get(batch_id=batch_id).decision_basis
        self.assertEqual(recorded["proposed_decision"], PromotionDecision.PROMOTED)
        self.assertEqual(recorded["proposed_to_class_id"], str(self.next_class.pk))

        edited = self.edit_decision(
            batch_id,
            {
                "decision": PromotionDecision.RETAINED,
                "to_class_id": str(self.school_class.pk),
                "decision_basis": {
                    "proposed_decision": PromotionDecision.RETAINED,
                    "proposed_to_class_id": str(self.school_class.pk),
                },
            },
        )

        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertEqual(row.decision, PromotionDecision.RETAINED, "the rest of the body applies")
        self.assertEqual(row.decision_basis, recorded)
        self.assertEqual(edited["decision_basis"], recorded)

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

    def test_a_closed_target_session_refuses_submit(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        self.close_target_session()

        response = self.transition(batch_id, "submit")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertEqual(row.status, PromotionStatus.DRAFT)

    def test_a_closed_target_session_refuses_approve(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        self.transition(batch_id, "submit")
        self.close_target_session()
        authenticate(self.client, self.second_user("academics.promotion.approve"))

        response = self.transition(batch_id, "approve")

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

    def test_transitions_return_the_updated_count(self) -> None:
        """Two rows, so `updated` is a count of what moved and not a constant 1."""
        self.allow(*PREPARE_KEYS)
        self.enroll_classmate()
        batch_id = self.create_batch()
        approver = self.second_user("academics.promotion.approve")

        def result(action: str) -> dict:
            response = self.transition(batch_id, action)
            self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
            return response.json()["data"]

        self.assertEqual(result("submit"), {"updated": 2})
        authenticate(self.client, approver)
        self.assertEqual(result("reject"), {"updated": 2})
        authenticate(self.client, self.user)
        self.assertEqual(result("submit"), {"updated": 2})
        authenticate(self.client, approver)
        self.assertEqual(result("approve"), {"updated": 2})
        authenticate(self.client, self.user)
        self.assertEqual(result("revert"), {"updated": 2})

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

    def test_a_closed_target_session_refuses_execute_before_queueing(self) -> None:
        batch_id = self._approved_batch()
        self.close_target_session()

        response = self.client.post(
            f"/api/v1/student-promotions/{batch_id}:execute", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        with tenant_context(self.tenant.id):
            self.assertEqual(BackgroundJob.objects.count(), 0, "nothing may have been queued")

    def test_a_student_whose_source_enrollment_ended_is_reported_failed_not_enrolled(self) -> None:
        """Closing the source would match nothing, and the student would be enrolled onward."""
        batch_id = self._approved_batch()
        with tenant_context(self.tenant.id):
            StudentEnrollment.objects.filter(pk=self.enrollment.pk).update(
                status=EnrollmentStatus.WITHDRAWN
            )

        job = self._execute(batch_id)

        self.assertEqual(job.status, JobStatus.SUCCEEDED)
        self.assertEqual(job.result["enrolled"], [])
        self.assertEqual(len(job.result["failed"]), 1)
        self.assertEqual(
            job.result["failed"][0]["error"],
            "The student's enrollment in the source class has ended.",
        )
        with tenant_context(self.tenant.id):
            onward = StudentEnrollment.objects.alive().filter(
                student=self.student, academic_session=self.next_session
            )
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertFalse(onward.exists())
        self.assertEqual(row.status, PromotionStatus.APPROVED)

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
        self.assertEqual(
            job.result["failed"][0]["error"], "Assign a target section before executing this batch."
        )
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

    def test_retaining_a_student_into_another_class_is_a_field_error(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()

        response = self.patch_decision(
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

        response = self.patch_decision(batch_id, {"decision": PromotionDecision.RETAINED})

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_retaining_into_the_same_class_is_accepted(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()

        response = self.patch_decision(
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
        self.assertEqual(
            job.result["failed"][0]["error"],
            "A retained student re-enrolls in the same class they were in.",
        )
        with tenant_context(self.tenant.id):
            created = StudentEnrollment.objects.alive().filter(
                student=self.student, academic_session=self.next_session
            )
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertFalse(created.exists(), "the wrong class must not have been enrolled into")
        self.assertEqual(row.status, PromotionStatus.APPROVED, "a refused row stays executable")


class OverrideReasonTests(PromotionTestCase):
    """§11: a decision or target class differing from the recorded proposal needs a reason."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            # Two levels above `school_class`: choosing it skips `next_class`.
            self.skip_class = ClassFactory(tenant=self.tenant, level=8)

    def assert_reason_required(self, response) -> None:
        body = response.json()
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, body)
        self.assertIn("override_reason", {row["field"] for row in body["error"]["details"]})

    def assert_still_draft(self, batch_id: str) -> None:
        with tenant_context(self.tenant.id):
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertEqual(row.status, PromotionStatus.DRAFT, "a refused submit must not move it")

    def strip_the_recorded_proposal(self, batch_id: str) -> None:
        """Make the rows look like a batch created before the proposal was recorded."""
        with tenant_context(self.tenant.id):
            StudentPromotion.objects.alive().filter(batch_id=batch_id).update(
                decision_basis={"rule": "level+1"}
            )

    def test_submit_requires_a_reason_when_the_target_class_skips_a_level(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        # The decision stays `promoted`; only the class moves.
        self.edit_decision(batch_id, {"to_class_id": str(self.skip_class.pk)})

        self.assert_reason_required(self.transition(batch_id, "submit"))
        self.assert_still_draft(batch_id)

        self.edit_decision(batch_id, {"override_reason": "Placed two levels up after assessment."})
        accepted = self.transition(batch_id, "submit")
        self.assertEqual(accepted.status_code, status.HTTP_200_OK, accepted.json())
        self.assertEqual(accepted.json()["data"], {"updated": 1})

    def test_choosing_the_proposed_class_explicitly_needs_no_reason(self) -> None:
        """The control: only a class *other than* the proposal asks for a reason."""
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        self.edit_decision(batch_id, {"to_class_id": str(self.next_class.pk)})

        response = self.transition(batch_id, "submit")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_a_different_decision_with_the_proposed_class_still_requires_a_reason(self) -> None:
        """The decision half of the rule, which the class half must not have displaced."""
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        self.edit_decision(batch_id, {"decision": PromotionDecision.PROMOTED_ON_TRIAL})

        self.assert_reason_required(self.transition(batch_id, "submit"))

        self.edit_decision(batch_id, {"override_reason": "Promoted on trial pending results."})
        self.assertEqual(self.transition(batch_id, "submit").status_code, status.HTTP_200_OK)

    def test_clearing_the_target_class_does_not_move_the_proposal(self) -> None:
        """The old derived proposal read the cleared `to_class_id` as "graduating" and passed."""
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        self.edit_decision(batch_id, {"decision": PromotionDecision.GRADUATED, "to_class_id": None})

        self.assert_reason_required(self.transition(batch_id, "submit"))
        self.assert_still_draft(batch_id)

        self.edit_decision(batch_id, {"override_reason": "Completed the programme early."})
        self.assertEqual(self.transition(batch_id, "submit").status_code, status.HTTP_200_OK)

    def test_a_recorded_graduating_proposal_is_not_mistaken_for_a_legacy_row(self) -> None:
        """A null `proposed_to_class_id` is a proposal, not a missing one.

        The class above the top one comes into use only after the batch exists. Read as a
        legacy row, the graduating decision would now deviate from "next level = that
        class"; read as the recorded proposal (graduate, no target) it matches.
        """
        self.allow(*PREPARE_KEYS)
        self.enroll_classmate(self.next_class, self.next_section)
        with tenant_context(self.tenant.id):
            Class.objects.filter(pk=self.skip_class.pk).update(is_active=False)
        batch_id = self.create_batch(self.next_class)
        with tenant_context(self.tenant.id):
            Class.objects.filter(pk=self.skip_class.pk).update(is_active=True)
            row = StudentPromotion.objects.alive().get(batch_id=batch_id)
        self.assertEqual(row.decision, PromotionDecision.GRADUATED, "the setup must graduate")

        response = self.transition(batch_id, "submit")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_a_legacy_row_without_a_recorded_proposal_falls_back_to_the_next_level(self) -> None:
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        self.strip_the_recorded_proposal(batch_id)
        self.edit_decision(batch_id, {"to_class_id": str(self.skip_class.pk)})

        self.assert_reason_required(self.transition(batch_id, "submit"))

        # The control: back on the next level, the same legacy row passes without a reason.
        self.edit_decision(batch_id, {"to_class_id": str(self.next_class.pk)})
        self.assertEqual(self.transition(batch_id, "submit").status_code, status.HTTP_200_OK)

    def test_a_legacy_row_cleared_to_graduated_still_needs_a_reason(self) -> None:
        """The fallback derives its decision from the ladder, not from the cleared row."""
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        self.strip_the_recorded_proposal(batch_id)
        self.edit_decision(batch_id, {"decision": PromotionDecision.GRADUATED, "to_class_id": None})

        self.assert_reason_required(self.transition(batch_id, "submit"))

    def test_a_legacy_batch_looks_up_the_next_class_once_per_class(self) -> None:
        self.allow(*PREPARE_KEYS)
        self.enroll_classmate()
        batch_id = self.create_batch()
        self.strip_the_recorded_proposal(batch_id)

        with mock.patch.object(
            services, "next_class_for", wraps=services.next_class_for
        ) as next_class_for:
            response = self.transition(batch_id, "submit")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(next_class_for.call_count, 1, "two rows, one class, one lookup")

    def test_a_recorded_proposal_never_consults_the_current_ladder(self) -> None:
        self.allow(*PREPARE_KEYS)
        self.enroll_classmate()
        batch_id = self.create_batch()

        with mock.patch.object(
            services, "next_class_for", wraps=services.next_class_for
        ) as next_class_for:
            response = self.transition(batch_id, "submit")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        next_class_for.assert_not_called()

    def test_a_recorded_proposal_survives_a_later_change_to_the_ladder(self) -> None:
        """The proposal is what was proposed, whatever the classes look like by submit."""
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        with tenant_context(self.tenant.id):
            Class.objects.filter(pk=self.next_class.pk).update(is_active=False)

        response = self.transition(batch_id, "submit")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_a_legacy_row_is_checked_against_the_current_ladder(self) -> None:
        """The documented limit of the fallback, and the control for the test above."""
        self.allow(*PREPARE_KEYS)
        batch_id = self.create_batch()
        self.strip_the_recorded_proposal(batch_id)
        with tenant_context(self.tenant.id):
            Class.objects.filter(pk=self.next_class.pk).update(is_active=False)

        self.assert_reason_required(self.transition(batch_id, "submit"))


class FailureMessageTests(SimpleTestCase):
    """A failed student's report line is an API error's plain text, never a repr or DB text."""

    def test_a_dict_detail_gives_its_message_without_the_field_key_or_a_repr(self) -> None:
        exc = DomainRuleViolation(
            {"to_section_id": "Assign a target section before executing this batch."}
        )

        message = services._failure_message(exc)

        self.assertEqual(message, "Assign a target section before executing this batch.")
        self.assertNotIn("ErrorDetail", message)
        self.assertNotIn("to_section_id", message)

    def test_a_list_detail_joins_its_messages(self) -> None:
        exc = DomainRuleViolation(["First problem.", "Second problem."])

        self.assertEqual(services._failure_message(exc), "First problem. Second problem.")

    def test_a_dict_of_lists_is_flattened(self) -> None:
        exc = DomainRuleViolation({"a": ["One.", "Two."], "b": "Three."})

        self.assertEqual(services._failure_message(exc), "One. Two. Three.")

    def test_a_plain_string_detail_is_kept(self) -> None:
        self.assertEqual(
            services._failure_message(Conflict("A batch already exists.")),
            "A batch already exists.",
        )

    def test_a_non_api_exception_is_generic_and_leaks_nothing(self) -> None:
        exc = RuntimeError('relation "student_promotions" does not exist')

        message = services._failure_message(exc)

        self.assertEqual(message, services.GENERIC_FAILURE_MESSAGE)
        self.assertNotIn("student_promotions", message)
        self.assertNotIn("ErrorDetail", message)


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
