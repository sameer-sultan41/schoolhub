"""Tests for the two-step upload flow."""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import TenantFactory, UserFactory, authenticate, grant
from core.files.models import File, FileStatus
from core.tenancy.context import tenant_context


class FileUploadFlowTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        grant(self.user, "platform.file.create", "platform.file.view")

    def test_create_returns_a_presigned_upload_and_a_pending_row(self) -> None:
        response = self.client.post(
            "/api/v1/files",
            {
                "original_name": "birth-certificate.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 2048,
                "purpose": "student.document",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        data = response.json()["data"]
        self.assertEqual(data["status"], "pending")
        self.assertIn("upload_url", data)
        self.assertEqual(data["upload_method"], "PUT")

        with tenant_context(self.tenant.id):
            file = File.objects.get(pk=data["id"])
        self.assertEqual(file.tenant_id, self.tenant.id)
        self.assertEqual(file.status, FileStatus.PENDING)

    def test_create_rejects_a_disallowed_mime_type(self) -> None:
        response = self.client.post(
            "/api/v1/files",
            {
                "original_name": "malware.exe",
                "mime_type": "application/x-msdownload",
                "size_bytes": 2048,
                "purpose": "student.document",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_create_rejects_a_file_over_the_size_limit(self) -> None:
        response = self.client.post(
            "/api/v1/files",
            {
                "original_name": "huge.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 999_999_999,
                "purpose": "student.document",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_confirm_flips_pending_to_ready(self) -> None:
        create_response = self.client.post(
            "/api/v1/files",
            {
                "original_name": "photo.jpg",
                "mime_type": "image/jpeg",
                "size_bytes": 1024,
                "purpose": "student.photo",
            },
            format="json",
        )
        file_id = create_response.json()["data"]["id"]

        confirm_response = self.client.post(f"/api/v1/files/{file_id}:confirm")

        self.assertEqual(confirm_response.status_code, status.HTTP_200_OK)
        self.assertEqual(confirm_response.json()["data"]["status"], "ready")

    def test_confirming_twice_is_a_conflict(self) -> None:
        create_response = self.client.post(
            "/api/v1/files",
            {
                "original_name": "photo.jpg",
                "mime_type": "image/jpeg",
                "size_bytes": 1024,
                "purpose": "student.photo",
            },
            format="json",
        )
        file_id = create_response.json()["data"]["id"]
        self.client.post(f"/api/v1/files/{file_id}:confirm")

        second = self.client.post(f"/api/v1/files/{file_id}:confirm")

        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)

    def test_download_returns_a_signed_url(self) -> None:
        with tenant_context(self.tenant.id):
            from core.files.tests.factories import FileFactory

            file = FileFactory(tenant=self.tenant)

        response = self.client.post(f"/api/v1/files/{file.pk}:download")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("download_url", response.json()["data"])
