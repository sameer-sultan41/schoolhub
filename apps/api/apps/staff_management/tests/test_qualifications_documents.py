"""Tests for staff qualifications and documents — nested-resource create/list,
verification, and file-purpose/status checks.

Mirrors student_management/tests/test_guardians_documents.py's document
pattern (that file's ``StudentDocumentTests``).
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.staff_management.tests.factories import FileFactory, StaffFactory, enable_feature
from core.files.models import FileStatus
from core.tenancy.context import tenant_context


class StaffManagementAPITestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        enable_feature(self.tenant, "module.staff")
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.staff = StaffFactory(tenant=self.tenant, campus=self.campus)

    def allow(self, *keys: str) -> None:
        grant(self.user, *keys)


class QualificationTests(StaffManagementAPITestCase):
    def test_add_a_qualification_and_list_it(self) -> None:
        self.allow("staff.qualification.create", "staff.qualification.view")

        create_response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/qualifications",
            {"qualification_type": "degree", "title": "B.Ed", "year_awarded": 2020},
            format="json",
        )
        self.assertEqual(
            create_response.status_code, status.HTTP_201_CREATED, create_response.json()
        )

        list_response = self.client.get(f"/api/v1/staff/{self.staff.pk}/qualifications")
        ids = {row["id"] for row in list_response.json()["data"]}
        self.assertIn(create_response.json()["data"]["id"], ids)

    def test_a_year_awarded_in_the_future_is_rejected(self) -> None:
        self.allow("staff.qualification.create")

        response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/qualifications",
            {"qualification_type": "degree", "title": "B.Ed", "year_awarded": 2999},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(response.json()["error"]["code"], "domain_rule_violation")

    def test_a_year_awarded_in_the_past_is_accepted(self) -> None:
        """Positive control: the rejection above is about the future, not about the field."""
        self.allow("staff.qualification.create")

        response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/qualifications",
            {"qualification_type": "degree", "title": "B.Ed", "year_awarded": 2020},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_verify_a_qualification(self) -> None:
        self.allow("staff.qualification.create", "staff.qualification.verify")
        create_response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/qualifications",
            {"qualification_type": "degree", "title": "B.Ed"},
            format="json",
        )
        qualification_id = create_response.json()["data"]["id"]

        verify_response = self.client.post(
            f"/api/v1/staff-qualifications/{qualification_id}:verify",
            {"decision": "verified"},
            format="json",
        )

        self.assertEqual(verify_response.status_code, status.HTTP_200_OK)
        self.assertEqual(verify_response.json()["data"]["verification_status"], "verified")
        self.assertEqual(verify_response.json()["data"]["verified_by"], str(self.user.pk))

    def test_verifying_a_qualification_twice_is_a_conflict(self) -> None:
        self.allow("staff.qualification.create", "staff.qualification.verify")
        create_response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/qualifications",
            {"qualification_type": "degree", "title": "B.Ed"},
            format="json",
        )
        qualification_id = create_response.json()["data"]["id"]
        verify_url = f"/api/v1/staff-qualifications/{qualification_id}:verify"
        self.client.post(verify_url, {"decision": "verified"}, format="json")

        second = self.client.post(verify_url, {"decision": "verified"}, format="json")

        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)

    def test_attaching_a_qualification_document_with_a_wrong_purpose_file_is_rejected(self) -> None:
        self.allow("staff.qualification.create")
        with tenant_context(self.tenant.id):
            wrong_purpose_file = FileFactory(
                tenant=self.tenant, purpose="staff.document", status=FileStatus.READY
            )

        response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/qualifications",
            {
                "qualification_type": "degree",
                "title": "B.Ed",
                "document_file_id": str(wrong_purpose_file.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_attaching_a_qualification_document_with_an_unconfirmed_file_is_rejected(self) -> None:
        self.allow("staff.qualification.create")
        with tenant_context(self.tenant.id):
            pending_file = FileFactory(
                tenant=self.tenant, purpose="staff.qualification", status=FileStatus.PENDING
            )

        response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/qualifications",
            {
                "qualification_type": "degree",
                "title": "B.Ed",
                "document_file_id": str(pending_file.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_attaching_a_qualification_document_with_a_ready_matching_file_is_accepted(
        self,
    ) -> None:
        """Positive control: the rejections above are about purpose/status, not the field."""
        self.allow("staff.qualification.create")
        with tenant_context(self.tenant.id):
            ready_file = FileFactory(
                tenant=self.tenant, purpose="staff.qualification", status=FileStatus.READY
            )

        response = self.client.post(
            f"/api/v1/staff/{self.staff.pk}/qualifications",
            {
                "qualification_type": "degree",
                "title": "B.Ed",
                "document_file_id": str(ready_file.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())


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
