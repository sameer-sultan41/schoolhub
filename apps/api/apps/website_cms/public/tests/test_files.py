"""The anonymous public file redirect: only a ready, public, live file of a live school."""

from __future__ import annotations

import uuid
from datetime import timedelta
from unittest import mock

from django.conf import settings
from django.core.cache import cache
from django.urls import resolve
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from apps.school_organization.tests.factories import TenantFactory
from apps.website_cms.constants import PUBLIC_FILE_CACHE_SECONDS
from apps.website_cms.media import public_file_url
from apps.website_cms.models import ContentStatus
from apps.website_cms.public.file_views import PublicFileView
from apps.website_cms.tests.factories import NewsPostFactory
from core.api.throttling import PublicFileThrottle
from core.files.models import FileStatus, FileVisibility
from core.files.tests.factories import FileFactory
from core.files.visibility import sync_file_visibility
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantStatus


class PublicFileCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        cache.clear()
        self.tenant = TenantFactory()
        self.client = APIClient()  # anonymous: no machine token, no session

    def make_file(self, tenant=None, **overrides):
        tenant = tenant or self.tenant
        fields = {
            "visibility": FileVisibility.PUBLIC,
            "purpose": "website.image",
            "mime_type": "image/png",
            **overrides,
        }
        with tenant_context(tenant.id):
            return FileFactory(tenant=tenant, **fields)

    def fetch(self, file, tenant=None, **meta):
        tenant = tenant or self.tenant
        return self.client.get(f"/api/v1/public/files/{tenant.id}/{file.id}", **meta)


class PublicFileTests(PublicFileCase):
    def test_public_ready_file_redirects(self) -> None:
        file = self.make_file()

        response = self.fetch(file)

        self.assertEqual(response.status_code, 302)
        self.assertIn(file.storage_key, response["Location"])

    def test_cache_control_header(self) -> None:
        response = self.fetch(self.make_file())

        self.assertEqual(response["Cache-Control"], f"public, max-age={PUBLIC_FILE_CACHE_SECONDS}")

    def test_presign_outlives_the_cache_max_age(self) -> None:
        ttl = settings.FILE_DISPLAY_URL_TTL_SECONDS
        self.assertGreaterEqual(ttl, 2 * PUBLIC_FILE_CACHE_SECONDS)

    def test_the_url_helper_resolves_to_this_view(self) -> None:
        tenant_id, file_id = uuid.uuid4(), uuid.uuid4()
        url = public_file_url(tenant_id, file_id)

        match = resolve(url.removeprefix(settings.API_PUBLIC_URL.rstrip("/")))

        self.assertIs(match.func.view_class, PublicFileView)
        self.assertEqual(match.kwargs, {"tenant_id": tenant_id, "file_id": file_id})

    def test_private_file_404(self) -> None:
        self.assertEqual(
            self.fetch(self.make_file(visibility=FileVisibility.PRIVATE)).status_code, 404
        )

    def test_pending_file_404(self) -> None:
        self.assertEqual(self.fetch(self.make_file(status=FileStatus.PENDING)).status_code, 404)

    def test_deleted_file_404(self) -> None:
        file = self.make_file(deleted_at=timezone.now())

        self.assertEqual(self.fetch(file).status_code, 404)

    def test_file_404_after_last_reference_unpublished(self) -> None:
        file = self.make_file(visibility=FileVisibility.PRIVATE)
        with tenant_context(self.tenant.id):
            post = NewsPostFactory(
                tenant=self.tenant,
                status=ContentStatus.PUBLISHED,
                published_at=timezone.now() - timedelta(days=1),
                cover_image_file_id=file.id,
            )
            sync_file_visibility({file.id})
        self.assertEqual(self.fetch(file).status_code, 302)

        with tenant_context(self.tenant.id):
            post.status = ContentStatus.DRAFT
            post.save()
            sync_file_visibility({file.id})

        self.assertEqual(self.fetch(file).status_code, 404)

    def test_other_tenant_file_404(self) -> None:
        other = TenantFactory()
        file = self.make_file(tenant=other)

        # The file's own school serves it; asking under another school's id does not.
        self.assertEqual(self.fetch(file, tenant=other).status_code, 302)
        self.assertEqual(self.fetch(file).status_code, 404)

    def test_suspended_tenant_404(self) -> None:
        file = self.make_file()
        self.tenant.status = TenantStatus.SUSPENDED
        self.tenant.save(update_fields=["status"])

        self.assertEqual(self.fetch(file).status_code, 404)

    def test_deleted_tenant_404(self) -> None:
        file = self.make_file()
        self.tenant.deleted_at = timezone.now()
        self.tenant.save(update_fields=["deleted_at"])

        self.assertEqual(self.fetch(file).status_code, 404)

    def test_every_miss_has_the_same_body(self) -> None:
        file = self.make_file()
        misses = [
            self.client.get(f"/api/v1/public/files/{uuid.uuid4()}/{file.id}"),
            self.fetch(self.make_file(visibility=FileVisibility.PRIVATE)),
            self.fetch(self.make_file(status=FileStatus.PENDING)),
            self.client.get(f"/api/v1/public/files/{self.tenant.id}/{uuid.uuid4()}"),
        ]

        self.assertEqual({response.status_code for response in misses}, {404})
        bodies = []
        for response in misses:
            body = response.json()
            body["error"].pop("request_id", None)  # unique per request by design
            bodies.append(body)
        self.assertTrue(all(body == bodies[0] for body in bodies), bodies)

    def test_ignores_any_credentials(self) -> None:
        response = self.fetch(self.make_file(), HTTP_AUTHORIZATION="Bearer not-a-token")

        self.assertEqual(response.status_code, 302)


class PublicFileThrottleTests(PublicFileCase):
    """Each (IP, file) pair has its own bucket, so an optimiser walking many files is fine."""

    def setUp(self) -> None:
        super().setUp()
        rates = PublicFileThrottle.THROTTLE_RATES
        patcher = mock.patch.dict(rates, {"public_file": "3/min"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_one_ip_fetching_one_file_is_throttled(self) -> None:
        file = self.make_file()

        statuses = [self.fetch(file).status_code for _ in range(4)]

        self.assertEqual(statuses, [302, 302, 302, 429])

    def test_one_ip_fetching_many_distinct_files_not_throttled(self) -> None:
        files = [self.make_file() for _ in range(8)]

        statuses = {self.fetch(file).status_code for file in files}

        self.assertEqual(statuses, {302})

    def test_another_ip_is_not_throttled_by_the_first(self) -> None:
        file = self.make_file()
        for _ in range(4):
            self.fetch(file)

        self.assertEqual(self.fetch(file, REMOTE_ADDR="203.0.113.9").status_code, 302)
