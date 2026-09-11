"""Tests for the StaffDocument resource — nested-resource create/list,
verification, and file-purpose/status checks.

Mirrors student_management/tests/test_guardians_documents.py's document
pattern (that file's ``StudentDocumentTests``).
"""

from __future__ import annotations

from rest_framework import status

from apps.staff_management.tests.base import StaffManagementAPITestCase as _BaseAPITestCase
from apps.staff_management.tests.factories import FileFactory, StaffFactory
from core.files.models import FileStatus
from core.tenancy.context import tenant_context


class StaffManagementAPITestCase(_BaseAPITestCase):
    """Adds a staff member to the shared base — every test here operates on

    one nested under a staff record, unlike the Staff/Designation resources'
    own tests, which need the base's roster left empty.
    """

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.staff = StaffFactory(tenant=self.tenant, campus=self.campus)


class DocumentTests(StaffManagementAPITestCase):
    def _ready_file(self):
        with tenant_context(self.tenant.id):
            return FileFactory(
                tenant=self.tenant, purpose="staff.document", status=FileStatus.READY
            )

    def test_add_a_document_and_list_it(self) -> None:
        self.allow("staff.document.create", "staff.document.view")
        file = self._ready_file()

        create_response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/documents",
            {"file_id": str(file.pk), "document_type": "contract", "title": "Employment contract"},
            format="json",
        )
        self.assertEqual(
            create_response.status_code, status.HTTP_201_CREATED, create_response.json()
        )

        list_response = self.client.get(f"/api/v1/staff/{self.staff.pk}/documents")
        ids = {row["id"] for row in list_response.json()["data"]}
        self.assertIn(create_response.json()["data"]["id"], ids)

    def test_verify_a_document(self) -> None:
        self.allow("staff.document.create", "staff.document.verify")
        file = self._ready_file()
        create_response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/documents",
            {"file_id": str(file.pk), "document_type": "contract", "title": "Employment contract"},
            format="json",
        )
        document_id = create_response.json()["data"]["id"]

        verify_response = self.client.post(
            f"/api/v1/staff-documents/{document_id}:verify", {"decision": "rejected"}, format="json"
        )

        self.assertEqual(verify_response.status_code, status.HTTP_200_OK)
        self.assertEqual(verify_response.json()["data"]["verification_status"], "rejected")
        self.assertEqual(verify_response.json()["data"]["verified_by"], str(self.user.pk))

    def test_verifying_a_document_twice_is_a_conflict(self) -> None:
        self.allow("staff.document.create", "staff.document.verify")
        file = self._ready_file()
        create_response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/documents",
            {"file_id": str(file.pk), "document_type": "contract", "title": "Employment contract"},
            format="json",
        )
        document_id = create_response.json()["data"]["id"]
        verify_url = f"/api/v1/staff-documents/{document_id}:verify"
        self.client.post(verify_url, {"decision": "verified"}, format="json")

        second = self.client.post(verify_url, {"decision": "verified"}, format="json")

        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)

    def test_uploading_a_document_with_an_unconfirmed_file_is_rejected(self) -> None:
        self.allow("staff.document.create")
        with tenant_context(self.tenant.id):
            pending_file = FileFactory(
                tenant=self.tenant, purpose="staff.document", status=FileStatus.PENDING
            )

        response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/documents",
            {"file_id": str(pending_file.pk), "document_type": "contract", "title": "x"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_uploading_a_wrong_purpose_file_as_a_document_is_rejected(self) -> None:
        self.allow("staff.document.create")
        with tenant_context(self.tenant.id):
            wrong_purpose_file = FileFactory(
                tenant=self.tenant, purpose="staff.qualification", status=FileStatus.READY
            )

        response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/documents",
            {"file_id": str(wrong_purpose_file.pk), "document_type": "contract", "title": "x"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_an_unrecognized_document_type_is_rejected(self) -> None:
        self.allow("staff.document.create")
        file = self._ready_file()

        response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/documents",
            {"file_id": str(file.pk), "document_type": "not_a_real_type", "title": "x"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_a_seeded_document_type_is_accepted(self) -> None:
        """Positive control: the rejection above is about the type name, not the field."""
        self.allow("staff.document.create")
        file = self._ready_file()

        response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/documents",
            {"file_id": str(file.pk), "document_type": "contract", "title": "x"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
