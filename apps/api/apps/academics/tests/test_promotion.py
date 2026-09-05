"""The §7.2 promotion state machine.

The assertions that matter most: an approver cannot be the preparer, execution
is idempotent, and a batch that already produced enrollments cannot be reverted
out from under them.
"""

from __future__ import annotations

from rest_framework import status

from apps.academics.models import PromotionDecision, PromotionStatus, StudentPromotion
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
    def _approved_batch(self) -> str:
        self.allow(*PREPARE_KEYS, "academics.promotion.execute")
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
        return batch_id

    def test_execution_creates_the_next_session_enrollment(self) -> None:
        batch_id = self._approved_batch()

        response = self.client.post(
            f"/api/v1/student-promotions/{batch_id}:execute", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        report = response.json()["data"]
        self.assertEqual(len(report["enrolled"]), 1)
        self.assertEqual(report["failed"], [])

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

    def test_re_execution_is_a_no_op(self) -> None:
        """§11: "re-execution attempts are no-ops"."""
        batch_id = self._approved_batch()
        self.client.post(f"/api/v1/student-promotions/{batch_id}:execute", {}, format="json")

        # A different Idempotency-Key, so this is the service's own per-row skip
        # doing the work rather than the 24h replay cache.
        second = self.client.post(
            f"/api/v1/student-promotions/{batch_id}:execute",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="a-different-key",
        )

        self.assertEqual(second.json()["data"]["skipped"][0]["reason"], "already executed")
        with tenant_context(self.tenant.id):
            count = (
                StudentEnrollment.objects.alive()
                .filter(student=self.student, academic_session=self.next_session)
                .count()
            )
        self.assertEqual(count, 1, "a re-run must not create a second enrollment")

    def test_executing_an_unapproved_batch_is_a_conflict(self) -> None:
        self.allow(*PREPARE_KEYS, "academics.promotion.execute")
        batch_id = self.create_batch()

        response = self.client.post(
            f"/api/v1/student-promotions/{batch_id}:execute", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_execution_without_a_target_section_reports_a_per_student_failure(self) -> None:
        """One student's problem must not discard the rest of the batch."""
        self.allow(*PREPARE_KEYS, "academics.promotion.execute")
        batch_id = self.create_batch()
        self.client.post(f"/api/v1/student-promotions/{batch_id}:submit", {}, format="json")
        approver = self.second_user("academics.promotion.approve")
        authenticate(self.client, approver)
        self.client.post(f"/api/v1/student-promotions/{batch_id}:approve", {}, format="json")
        authenticate(self.client, self.user)

        response = self.client.post(
            f"/api/v1/student-promotions/{batch_id}:execute", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        report = response.json()["data"]
        self.assertEqual(len(report["failed"]), 1)
        self.assertEqual(report["enrolled"], [])

    def test_reverting_after_execution_is_blocked_by_the_new_enrollments(self) -> None:
        batch_id = self._approved_batch()
        self.client.post(f"/api/v1/student-promotions/{batch_id}:execute", {}, format="json")

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

        executed = self.client.post(
            f"/api/v1/student-promotions/{batch_id}:execute", {}, format="json"
        )

        self.assertEqual(executed.status_code, status.HTTP_200_OK, executed.json())
        report = executed.json()["data"]
        self.assertEqual(len(report["graduated"]), 1)
        self.assertEqual(report["enrolled"], [])
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
