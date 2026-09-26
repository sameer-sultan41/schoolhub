"""Which files get an inline display link, and what that link carries."""

from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import serializers

from apps.school_organization.tests.factories import TenantFactory
from core.files.models import FileStatus
from core.files.serializers import SignedFileURLField
from core.files.services import get_display_url
from core.files.tests.factories import FileFactory
from core.tenancy.context import tenant_context


class _PhotoHolder:
    """Anything with a file relation — stands in for Staff, Student, Guardian."""

    def __init__(self, photo_file):
        self.photo_file = photo_file


class _PhotoSerializer(serializers.Serializer):
    photo_url = SignedFileURLField(source="photo_file")


class DisplayUrlTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()

    def _file(self, **overrides):
        with tenant_context(self.tenant.id):
            return FileFactory(
                tenant=self.tenant, purpose="staff.photo", mime_type="image/png", **overrides
            )

    def test_a_ready_file_gets_a_link(self) -> None:
        file = self._file(status=FileStatus.READY)

        self.assertIn(file.storage_key, get_display_url(file))

    def test_pending_quarantined_and_deleted_files_get_none(self) -> None:
        # select_related still joins a soft-deleted row, so the service has to check.
        cases = {
            "pending": self._file(status=FileStatus.PENDING),
            "quarantined": self._file(status=FileStatus.QUARANTINED),
            "deleted": self._file(status=FileStatus.READY, deleted_at=timezone.now()),
        }
        for case, file in cases.items():
            with self.subTest(case):
                self.assertIsNone(get_display_url(file))

    def test_the_field_emits_the_link_or_null(self) -> None:
        file = self._file(status=FileStatus.READY)

        self.assertIn(file.storage_key, _PhotoSerializer(_PhotoHolder(file)).data["photo_url"])
        self.assertIsNone(_PhotoSerializer(_PhotoHolder(None)).data["photo_url"])

    @override_settings(
        S3_ENDPOINT_URL="http://minio:9000",
        S3_PUBLIC_ENDPOINT_URL="http://localhost:9000",
        S3_BUCKET_NAME="schoolhub-test",
        AWS_ACCESS_KEY_ID="test-access-key",
        AWS_SECRET_ACCESS_KEY="test-secret-key",
        FILE_DISPLAY_URL_TTL_SECONDS=3600,
    )
    def test_links_last_the_display_ttl_and_are_privately_cacheable(self) -> None:
        url = get_display_url(self._file(status=FileStatus.READY))

        query = parse_qs(urlsplit(url).query)
        self.assertEqual(query.get("X-Amz-Expires"), ["3600"])
        self.assertEqual(query.get("response-cache-control"), ["private, max-age=3600"])
