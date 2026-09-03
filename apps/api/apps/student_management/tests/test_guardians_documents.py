"""Tests for guardians, the student<->guardian link, emergency contacts, and

student documents (PR2 of student-management).
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.student_management.tests.factories import (
    EmergencyContactFactory,
    FileFactory,
    GuardianFactory,
    StudentDocumentFactory,
    StudentFactory,
    StudentGuardianFactory,
    enable_feature,
)
from core.files.models import FileStatus
from core.tenancy.context import tenant_context


class TenantFixtureMixin:
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.student = StudentFactory(tenant=self.tenant, campus=self.campus)


class StudentGuardianConstraintTests(TenantFixtureMixin, TestCase):
    def test_a_second_link_between_the_same_student_and_guardian_is_rejected(self) -> None:
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant)
            StudentGuardianFactory(tenant=self.tenant, student=self.student, guardian=guardian)
            with self.assertRaises(IntegrityError), transaction.atomic():
                StudentGuardianFactory(tenant=self.tenant, student=self.student, guardian=guardian)

    def test_a_second_primary_guardian_for_the_same_student_is_rejected(self) -> None:
        with tenant_context(self.tenant.id):
            first = GuardianFactory(tenant=self.tenant)
            second = GuardianFactory(tenant=self.tenant)
            StudentGuardianFactory(
                tenant=self.tenant, student=self.student, guardian=first, is_primary=True
            )
            with self.assertRaises(IntegrityError), transaction.atomic():
                StudentGuardianFactory(
                    tenant=self.tenant, student=self.student, guardian=second, is_primary=True
                )


class StudentDocumentConstraintTests(TenantFixtureMixin, TestCase):
    def test_a_decided_document_without_a_verifier_is_rejected(self) -> None:
        with tenant_context(self.tenant.id):
            file = FileFactory(tenant=self.tenant)
            with self.assertRaises(IntegrityError), transaction.atomic():
                StudentDocumentFactory(
                    tenant=self.tenant,
                    student=self.student,
                    file=file,
                    verification_status="verified",
                )

    def test_a_pending_document_with_a_verifier_already_set_is_rejected(self) -> None:
        import datetime

        with tenant_context(self.tenant.id):
            file = FileFactory(tenant=self.tenant)
            with self.assertRaises(IntegrityError), transaction.atomic():
                StudentDocumentFactory(
                    tenant=self.tenant,
                    student=self.student,
                    file=file,
                    verification_status="pending",
                    verified_by="00000000-0000-0000-0000-000000000000",
                    verified_at=datetime.datetime.now(datetime.UTC),
                )


class StudentManagementAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, "module.students")
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.student = StudentFactory(tenant=self.tenant, campus=self.campus)

    def allow(self, *keys: str) -> None:
        grant(self.user, *keys)


class GuardianLinkTests(StudentManagementAPITestCase):
    def test_linking_an_existing_guardian_succeeds(self) -> None:
        self.allow("students.guardian.create", "students.guardian.view")
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant)

        response = self.client.post(
            f"/api/v1/students/{self.student.pk}/guardians",
            {"guardian_id": str(guardian.pk), "relationship": "father", "is_primary": True},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertTrue(response.json()["data"]["is_primary"])

    def test_promoting_a_second_guardian_to_primary_demotes_the_first(self) -> None:
        self.allow("students.guardian.create", "students.guardian.view", "students.guardian.update")
        with tenant_context(self.tenant.id):
            first_guardian = GuardianFactory(tenant=self.tenant)
            second_guardian = GuardianFactory(tenant=self.tenant)
            first_link = StudentGuardianFactory(
                tenant=self.tenant, student=self.student, guardian=first_guardian, is_primary=True
            )
            second_link = StudentGuardianFactory(
                tenant=self.tenant, student=self.student, guardian=second_guardian, is_primary=False
            )

        response = self.client.patch(
            f"/api/v1/student-guardians/{second_link.pk}", {"is_primary": True}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertTrue(response.json()["data"]["is_primary"])

        with tenant_context(self.tenant.id):
            first_link.refresh_from_db()
        self.assertFalse(first_link.is_primary)

    def test_linking_a_foreign_guardian_is_rejected(self) -> None:
        self.allow("students.guardian.create")
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign_guardian = GuardianFactory(tenant=other_tenant)

        response = self.client.post(
            f"/api/v1/students/{self.student.pk}/guardians",
            {"guardian_id": str(foreign_guardian.pk), "relationship": "father"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_nesting_under_a_foreign_student_is_404(self) -> None:
        self.allow("students.guardian.create", "students.guardian.view")
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign_campus = CampusFactory(tenant=other_tenant)
            foreign_student = StudentFactory(tenant=other_tenant, campus=foreign_campus)

        response = self.client.get(f"/api/v1/students/{foreign_student.pk}/guardians")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class EmergencyContactTests(StudentManagementAPITestCase):
    def test_add_an_emergency_contact(self) -> None:
        self.allow("students.student.update", "students.student.view")

        response = self.client.post(
            f"/api/v1/students/{self.student.pk}/emergency-contacts",
            {"name": "Aunt Ayesha", "relationship": "aunt", "phone": "+923001234567"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())


class StudentDocumentTests(StudentManagementAPITestCase):
    def _ready_file(self):
        with tenant_context(self.tenant.id):
            return FileFactory(
                tenant=self.tenant, purpose="student.document", status=FileStatus.READY
            )

    def test_upload_a_document_and_verify_it(self) -> None:
        self.allow("students.document.create", "students.document.view", "students.document.verify")
        file = self._ready_file()

        create_response = self.client.post(
            f"/api/v1/students/{self.student.pk}/documents",
            {"file_id": str(file.pk), "document_type": "birth_certificate", "title": "Birth cert"},
            format="json",
        )
        self.assertEqual(
            create_response.status_code, status.HTTP_201_CREATED, create_response.json()
        )
        document_id = create_response.json()["data"]["id"]

        verify_url = f"/api/v1/student-documents/{document_id}:verify"
        verify_response = self.client.post(verify_url, {"decision": "verified"}, format="json")
        self.assertEqual(verify_response.status_code, status.HTTP_200_OK)
        self.assertEqual(verify_response.json()["data"]["verification_status"], "verified")
        self.assertEqual(verify_response.json()["data"]["verified_by"], str(self.user.pk))

    def test_verifying_twice_is_a_conflict(self) -> None:
        self.allow("students.document.create", "students.document.verify")
        file = self._ready_file()
        create_response = self.client.post(
            f"/api/v1/students/{self.student.pk}/documents",
            {"file_id": str(file.pk), "document_type": "birth_certificate", "title": "Birth cert"},
            format="json",
        )
        document_id = create_response.json()["data"]["id"]
        verify_url = f"/api/v1/student-documents/{document_id}:verify"
        self.client.post(verify_url, {"decision": "verified"})

        second = self.client.post(verify_url, {"decision": "verified"}, format="json")

        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)

    def test_uploading_a_document_with_a_pending_file_is_rejected(self) -> None:
        self.allow("students.document.create")
        with tenant_context(self.tenant.id):
            pending_file = FileFactory(
                tenant=self.tenant, purpose="student.document", status=FileStatus.PENDING
            )

        response = self.client.post(
            f"/api/v1/students/{self.student.pk}/documents",
            {"file_id": str(pending_file.pk), "document_type": "birth_certificate", "title": "x"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_uploading_a_photo_purposed_file_as_a_document_is_rejected(self) -> None:
        self.allow("students.document.create")
        with tenant_context(self.tenant.id):
            photo_file = FileFactory(
                tenant=self.tenant, purpose="student.photo", status=FileStatus.READY
            )

        response = self.client.post(
            f"/api/v1/students/{self.student.pk}/documents",
            {"file_id": str(photo_file.pk), "document_type": "birth_certificate", "title": "x"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_deleting_a_document_soft_deletes_it(self) -> None:
        self.allow("students.document.create", "students.document.delete", "students.document.view")
        file = self._ready_file()
        create_response = self.client.post(
            f"/api/v1/students/{self.student.pk}/documents",
            {"file_id": str(file.pk), "document_type": "birth_certificate", "title": "Birth cert"},
            format="json",
        )
        document_id = create_response.json()["data"]["id"]

        delete_response = self.client.delete(f"/api/v1/student-documents/{document_id}")

        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)


class CrossTenantGuardianDocumentTests(APITestCase):
    """Extends PR1's cross-tenant matrix to the new endpoint classes."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant_a = TenantFactory()
        self.tenant_b = TenantFactory()
        self.user = UserFactory(tenant=self.tenant_a)
        from core.rbac.registry import registry

        grant(self.user, *(spec.key for spec in registry.for_module("students")))
        authenticate(self.client, self.user)
        enable_feature(self.tenant_a, "module.students")
        enable_feature(self.tenant_b, "module.students")

        self.own = self._build(self.tenant_a)
        self.foreign = self._build(self.tenant_b)

    @staticmethod
    def _build(tenant):
        with tenant_context(tenant.id):
            campus = CampusFactory(tenant=tenant)
            student = StudentFactory(tenant=tenant, campus=campus)
            guardian = GuardianFactory(tenant=tenant)
            link = StudentGuardianFactory(tenant=tenant, student=student, guardian=guardian)
            contact = EmergencyContactFactory(tenant=tenant, student=student)
            file = FileFactory(tenant=tenant, purpose="student.document", status=FileStatus.READY)
            document = StudentDocumentFactory(tenant=tenant, student=student, file=file)
        return {
            "student": student,
            "guardian": guardian,
            "link": link,
            "contact": contact,
            "document": document,
        }

    def test_retrieving_a_foreign_guardian_is_404(self) -> None:
        response = self.client.get(f"/api/v1/guardians/{self.foreign['guardian'].pk}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_patching_a_foreign_student_guardian_link_is_404(self) -> None:
        link_id = self.foreign["link"].pk
        response = self.client.patch(
            f"/api/v1/student-guardians/{link_id}", {"is_primary": True}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_listing_guardians_under_a_foreign_student_is_404(self) -> None:
        response = self.client.get(f"/api/v1/students/{self.foreign['student'].pk}/guardians")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_listing_documents_under_a_foreign_student_is_404(self) -> None:
        response = self.client.get(f"/api/v1/students/{self.foreign['student'].pk}/documents")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_verifying_a_foreign_document_is_404(self) -> None:
        response = self.client.post(
            f"/api/v1/student-documents/{self.foreign['document'].pk}:verify",
            {"decision": "verified"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_deleting_a_foreign_document_is_404(self) -> None:
        response = self.client.delete(f"/api/v1/student-documents/{self.foreign['document'].pk}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_own_guardian_link_routes_succeed(self) -> None:
        """Positive control: the 404s above are isolation, not a broken route table."""
        response = self.client.get(f"/api/v1/students/{self.own['student'].pk}/guardians")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row["id"] for row in response.json()["data"]}
        self.assertIn(str(self.own["link"].pk), ids)
