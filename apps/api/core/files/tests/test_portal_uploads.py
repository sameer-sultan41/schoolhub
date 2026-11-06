"""A guardian's upload slots: only portal-open purposes, and only their own files to confirm."""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import TenantFactory, UserFactory, authenticate, grant
from core.files.models import File
from core.files.tests.factories import FileFactory
from core.rbac.models import RecordScope
from core.rbac.registry import registry as permission_registry
from core.tenancy.context import tenant_context

FILES = "/api/v1/files"


class PortalUploadGrantTests(APITestCase):
    def test_file_create_defaults_include_the_portal_roles(self) -> None:
        roles = set(permission_registry.get("platform.file.create").default_roles)

        self.assertTrue({"guardian", "student"} <= roles)
        # Viewing stays staff-only: the portal reads a file through its module's route.
        view_roles = set(permission_registry.get("platform.file.view").default_roles)
        self.assertFalse({"guardian", "student"} & view_roles)


class PortalUploadTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.guardian = UserFactory(tenant=self.tenant)
        grant(
            self.guardian,
            "platform.file.create",
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )
        authenticate(self.client, self.guardian)

    def request_slot(self, purpose: str):
        return self.client.post(
            FILES,
            {
                "original_name": "note.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 2048,
                "purpose": purpose,
            },
            format="json",
        )

    def test_guardian_creates_leave_attachment_upload(self) -> None:
        response = self.request_slot("attendance.leave-attachment")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        with tenant_context(self.tenant.id):
            file = File.objects.get(pk=response.json()["data"]["id"])
        self.assertEqual(file.created_by, self.guardian.pk)

        confirm = self.client.post(f"{FILES}/{file.pk}:confirm")
        self.assertEqual(confirm.status_code, status.HTTP_200_OK, confirm.json())

    def test_guardian_cannot_upload_other_purpose(self) -> None:
        response = self.request_slot("student.document")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        fields = {d["field"] for d in response.json()["error"]["details"]}
        self.assertEqual(fields, {"purpose"})

    def test_guardian_cannot_confirm_others_file(self) -> None:
        other = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            theirs = FileFactory(
                tenant=self.tenant,
                purpose="attendance.leave-attachment",
                status="pending",
                created_by=other.pk,
            )

        response = self.client.post(f"{FILES}/{theirs.pk}:confirm")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
