"""Tests for the standalone Guardian resource — creation, photo-file validation,
and tenant isolation on `/guardians`.

The student<->guardian *link* (`StudentGuardian`) has its own tests in the
sibling `student_guardians/` package; this file covers only the guardian
person record in isolation. Split out of
student_management/tests/test_guardians_documents.py's ``GuardianPhotoFileTests``
and the guardian-retrieve case from ``CrossTenantGuardianDocumentTests``.
"""

from __future__ import annotations

from rest_framework import status

from apps.school_organization.tests.factories import TenantFactory
from apps.student_management.tests.base import StudentManagementAPITestCase
from apps.student_management.tests.factories import FileFactory, GuardianFactory
from core.files.models import FileStatus
from core.tenancy.context import tenant_context


class GuardianPhotoFileTests(StudentManagementAPITestCase):
    def test_creating_a_guardian_with_a_ready_guardian_photo_succeeds(self) -> None:
        self.allow("students.guardian.create")
        with tenant_context(self.tenant.id):
            photo = FileFactory(
                tenant=self.tenant, purpose="guardian.photo", status=FileStatus.READY
            )

        response = self.client.post(
            "/api/v1/guardians",
            {
                "first_name": "Amina",
                "last_name": "Khan",
                "phone": "+923001234567",
                "photo_file_id": str(photo.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_creating_a_guardian_with_an_unconfirmed_photo_is_rejected(self) -> None:
        self.allow("students.guardian.create")
        with tenant_context(self.tenant.id):
            pending_photo = FileFactory(
                tenant=self.tenant, purpose="guardian.photo", status=FileStatus.PENDING
            )

        response = self.client.post(
            "/api/v1/guardians",
            {
                "first_name": "Amina",
                "last_name": "Khan",
                "phone": "+923001234567",
                "photo_file_id": str(pending_photo.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_creating_a_guardian_with_a_wrong_purpose_photo_is_rejected(self) -> None:
        self.allow("students.guardian.create")
        with tenant_context(self.tenant.id):
            student_photo = FileFactory(
                tenant=self.tenant, purpose="student.photo", status=FileStatus.READY
            )

        response = self.client.post(
            "/api/v1/guardians",
            {
                "first_name": "Amina",
                "last_name": "Khan",
                "phone": "+923001234567",
                "photo_file_id": str(student_photo.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)


class GuardianCrossTenantTests(StudentManagementAPITestCase):
    def test_retrieving_a_foreign_guardian_is_404(self) -> None:
        self.allow("students.guardian.view")
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign_guardian = GuardianFactory(tenant=other_tenant)

        response = self.client.get(f"/api/v1/guardians/{foreign_guardian.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_retrieving_an_own_guardian_succeeds(self) -> None:
        """Positive control: the 404 above is tenant isolation, not a broken route."""
        self.allow("students.guardian.view")
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant)

        response = self.client.get(f"/api/v1/guardians/{guardian.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["id"], str(guardian.pk))
