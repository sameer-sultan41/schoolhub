"""Tests for the enrollment lifecycle: enroll/change-section/withdraw and the

student-transfer request/approve/reject/complete flow (PR3 of
student-management).
"""

from __future__ import annotations

from rest_framework import status

from apps.school_organization.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    SectionFactory,
    TenantFactory,
)
from apps.student_management.models import StudentEnrollment, StudentStatus
from apps.student_management.tests.factories import (
    EmergencyContactFactory,
    GuardianFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
    StudentTransferFactory,
)
from apps.student_management.tests.test_guardians_documents import StudentManagementAPITestCase
from core.tenancy.context import tenant_context


class EnrollmentTests(StudentManagementAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.session = AcademicSessionFactory(tenant=self.tenant)
            self.school_class = ClassFactory(tenant=self.tenant)
            self.section = SectionFactory(
                tenant=self.tenant,
                school_class=self.school_class,
                campus=self.campus,
                capacity=1,
            )

    def _satisfy_prerequisites(self) -> None:
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant)
            StudentGuardianFactory(tenant=self.tenant, student=self.student, guardian=guardian)
            EmergencyContactFactory(tenant=self.tenant, student=self.student)

    def _enroll_payload(self, **overrides) -> dict:
        payload = {
            "academic_session_id": str(self.session.pk),
            "class_id": str(self.school_class.pk),
            "section_id": str(self.section.pk),
            "enrollment_date": "2026-04-05",
        }
        payload.update(overrides)
        return payload

    def test_enroll_requires_a_guardian_and_an_emergency_contact(self) -> None:
        self.allow("students.enrollment.enroll")

        response = self.client.post(
            f"/api/v1/students/{self.student.pk}:enroll", self._enroll_payload(), format="json"
        )

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.json()
        )

    def test_enroll_succeeds_once_prerequisites_are_met(self) -> None:
        self.allow("students.enrollment.enroll")
        self._satisfy_prerequisites()

        response = self.client.post(
            f"/api/v1/students/{self.student.pk}:enroll", self._enroll_payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertEqual(response.json()["data"]["status"], "active")

    def test_enroll_rejects_a_second_active_enrollment_in_the_same_session(self) -> None:
        self.allow("students.enrollment.enroll")
        self._satisfy_prerequisites()
        with tenant_context(self.tenant.id):
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )
            # A second, roomy section — the (student, session) uniqueness is what
            # this test targets, not the capacity check on the original section.
            other_section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus, capacity=5
            )

        response = self.client.post(
            f"/api/v1/students/{self.student.pk}:enroll",
            self._enroll_payload(section_id=str(other_section.pk)),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT, response.json())

    def test_enroll_rejects_over_capacity_without_an_override(self) -> None:
        self.allow("students.enrollment.enroll")
        self._satisfy_prerequisites()
        with tenant_context(self.tenant.id):
            other_student = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=other_student,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )

        response = self.client.post(
            f"/api/v1/students/{self.student.pk}:enroll", self._enroll_payload(), format="json"
        )

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.json()
        )

    def test_enroll_over_capacity_with_override_reason_requires_admin_permission(self) -> None:
        self.allow("students.enrollment.enroll")
        self._satisfy_prerequisites()
        with tenant_context(self.tenant.id):
            other_student = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=other_student,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )

        response = self.client.post(
            f"/api/v1/students/{self.student.pk}:enroll",
            self._enroll_payload(capacity_override_reason="Sibling priority admission"),
            format="json",
        )
        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.json()
        )

        self.allow("students.enrollment.enroll", "students.student.update")
        response = self.client.post(
            f"/api/v1/students/{self.student.pk}:enroll",
            self._enroll_payload(capacity_override_reason="Sibling priority admission"),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_enroll_replays_the_stored_response_for_a_repeated_idempotency_key(self) -> None:
        self.allow("students.enrollment.enroll")
        self._satisfy_prerequisites()

        headers = {"HTTP_IDEMPOTENCY_KEY": "enroll-once"}
        first = self.client.post(
            f"/api/v1/students/{self.student.pk}:enroll",
            self._enroll_payload(),
            format="json",
            **headers,
        )
        second = self.client.post(
            f"/api/v1/students/{self.student.pk}:enroll",
            self._enroll_payload(),
            format="json",
            **headers,
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.json())
        self.assertEqual(second.status_code, status.HTTP_201_CREATED, second.json())
        self.assertEqual(first.json()["data"]["id"], second.json()["data"]["id"])
        with tenant_context(self.tenant.id):
            self.assertEqual(
                StudentEnrollment.objects.alive().filter(student=self.student).count(), 1
            )

    def test_change_section_reallocates_to_a_new_section(self) -> None:
        self.allow("students.enrollment.enroll", "students.enrollment.update")
        self._satisfy_prerequisites()
        with tenant_context(self.tenant.id):
            enrollment = StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )
            new_section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus, capacity=5
            )

        response = self.client.post(
            f"/api/v1/students/{self.student.pk}:change-section",
            {"section_id": str(new_section.pk)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["section_id"], str(new_section.pk))
        with tenant_context(self.tenant.id):
            enrollment.refresh_from_db()
        self.assertEqual(enrollment.section_id, new_section.pk)

    def test_withdraw_ends_the_enrollment_and_sets_student_status(self) -> None:
        self.allow("students.student.withdraw", "students.enrollment.enroll")
        self._satisfy_prerequisites()
        with tenant_context(self.tenant.id):
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )

        response = self.client.post(
            f"/api/v1/students/{self.student.pk}:withdraw",
            {"reason": "Family relocation", "effective_date": "2026-06-01"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["status"], "withdrawn")

    def test_history_lists_the_enrollment(self) -> None:
        self.allow("students.enrollment.enroll", "students.student.view")
        self._satisfy_prerequisites()
        with tenant_context(self.tenant.id):
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )

        response = self.client.get(f"/api/v1/students/{self.student.pk}/history")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        events = response.json()["data"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "enrollment")


class TransferTests(StudentManagementAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.to_campus = CampusFactory(tenant=self.tenant)

    def test_inter_campus_transfer_requires_both_campuses(self) -> None:
        self.allow("students.transfer.create")

        response = self.client.post(
            "/api/v1/student-transfers",
            {
                "student_id": str(self.student.pk),
                "transfer_type": "inter_campus",
                "from_campus_id": str(self.campus.pk),
                "reason": "Relocation",
                "effective_date": "2026-06-01",
            },
            format="json",
        )

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.json()
        )

    def test_the_initiator_cannot_approve_their_own_transfer(self) -> None:
        self.allow("students.transfer.create", "students.transfer.approve")
        with tenant_context(self.tenant.id):
            transfer = StudentTransferFactory(
                tenant=self.tenant,
                student=self.student,
                from_campus=self.campus,
                to_campus=self.to_campus,
                created_by=self.user.pk,
            )

        response = self.client.post(f"/api/v1/student-transfers/{transfer.pk}:approve")

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.json()
        )

    def test_approve_then_complete_reallocates_campus_and_section(self) -> None:
        self.allow("students.transfer.create", "students.transfer.approve")
        with tenant_context(self.tenant.id):
            school_class = ClassFactory(tenant=self.tenant)
            destination_section = SectionFactory(
                tenant=self.tenant, school_class=school_class, campus=self.to_campus, capacity=5
            )
            transfer = StudentTransferFactory(
                tenant=self.tenant,
                student=self.student,
                from_campus=self.campus,
                to_campus=self.to_campus,
                created_by=None,
            )

        approve = self.client.post(f"/api/v1/student-transfers/{transfer.pk}:approve")
        self.assertEqual(approve.status_code, status.HTTP_200_OK, approve.json())

        complete = self.client.post(
            f"/api/v1/student-transfers/{transfer.pk}:complete",
            {"section_id": str(destination_section.pk)},
            format="json",
        )
        self.assertEqual(complete.status_code, status.HTTP_200_OK, complete.json())
        self.assertEqual(complete.json()["data"]["status"], "completed")
        with tenant_context(self.tenant.id):
            self.student.refresh_from_db()
        self.assertEqual(self.student.campus_id, self.to_campus.pk)

    def test_complete_replays_the_stored_response_for_a_repeated_idempotency_key(self) -> None:
        self.allow("students.transfer.create", "students.transfer.approve")
        with tenant_context(self.tenant.id):
            school_class = ClassFactory(tenant=self.tenant)
            destination_section = SectionFactory(
                tenant=self.tenant, school_class=school_class, campus=self.to_campus, capacity=5
            )
            transfer = StudentTransferFactory(
                tenant=self.tenant,
                student=self.student,
                from_campus=self.campus,
                to_campus=self.to_campus,
                created_by=None,
            )
        self.client.post(f"/api/v1/student-transfers/{transfer.pk}:approve")

        headers = {"HTTP_IDEMPOTENCY_KEY": "complete-once"}
        first = self.client.post(
            f"/api/v1/student-transfers/{transfer.pk}:complete",
            {"section_id": str(destination_section.pk)},
            format="json",
            **headers,
        )
        second = self.client.post(
            f"/api/v1/student-transfers/{transfer.pk}:complete",
            {"section_id": str(destination_section.pk)},
            format="json",
            **headers,
        )

        self.assertEqual(first.status_code, status.HTTP_200_OK, first.json())
        # Without idempotency wired up, this replay would instead re-run
        # complete_transfer against an already-completed transfer and get back a
        # 409 Conflict ("Transfer must be approved...") rather than the same 200.
        self.assertEqual(second.status_code, status.HTTP_200_OK, second.json())
        self.assertEqual(first.json()["data"], second.json()["data"])

    def test_completing_a_transfer_for_a_no_longer_active_student_is_rejected(self) -> None:
        self.allow("students.transfer.create", "students.transfer.approve")
        with tenant_context(self.tenant.id):
            school_class = ClassFactory(tenant=self.tenant)
            destination_section = SectionFactory(
                tenant=self.tenant, school_class=school_class, campus=self.to_campus, capacity=5
            )
            transfer = StudentTransferFactory(
                tenant=self.tenant,
                student=self.student,
                from_campus=self.campus,
                to_campus=self.to_campus,
                created_by=None,
            )

        approve = self.client.post(f"/api/v1/student-transfers/{transfer.pk}:approve")
        self.assertEqual(approve.status_code, status.HTTP_200_OK, approve.json())

        with tenant_context(self.tenant.id):
            # Simulates the student being withdrawn through a separate action in the
            # gap between approval and completion.
            self.student.status = StudentStatus.WITHDRAWN
            self.student.save(update_fields=["status"])

        complete = self.client.post(
            f"/api/v1/student-transfers/{transfer.pk}:complete",
            {"section_id": str(destination_section.pk)},
            format="json",
        )

        self.assertEqual(
            complete.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, complete.json()
        )
        with tenant_context(self.tenant.id):
            self.student.refresh_from_db()
        self.assertEqual(self.student.status, StudentStatus.WITHDRAWN)
        self.assertEqual(self.student.campus_id, self.campus.pk)

    def test_complete_before_approval_is_a_conflict(self) -> None:
        self.allow("students.transfer.create")
        with tenant_context(self.tenant.id):
            transfer = StudentTransferFactory(
                tenant=self.tenant,
                student=self.student,
                from_campus=self.campus,
                to_campus=self.to_campus,
            )

        response = self.client.post(f"/api/v1/student-transfers/{transfer.pk}:complete")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT, response.json())


class CrossTenantEnrollmentTests(StudentManagementAPITestCase):
    """Extends the cross-tenant matrix to enrollments/transfers (PR3)."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.session = AcademicSessionFactory(tenant=self.tenant)
            self.school_class = ClassFactory(tenant=self.tenant)
            self.section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )

    def test_history_for_a_foreign_student_is_404(self) -> None:
        self.allow("students.student.view")
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign_campus = CampusFactory(tenant=other_tenant)
            foreign_student = StudentFactory(tenant=other_tenant, campus=foreign_campus)

        response = self.client.get(f"/api/v1/students/{foreign_student.pk}/history")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_transfer_for_a_foreign_student_is_404(self) -> None:
        self.allow("students.student.view")
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign_campus = CampusFactory(tenant=other_tenant)
            foreign_student = StudentFactory(tenant=other_tenant, campus=foreign_campus)
            foreign_transfer = StudentTransferFactory(
                tenant=other_tenant, student=foreign_student, from_campus=foreign_campus
            )

        response = self.client.get(f"/api/v1/student-transfers/{foreign_transfer.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
