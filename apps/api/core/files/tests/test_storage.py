"""S3Presigner and get_presigner: which host links are signed for, how they are signed, what
download links carry, and one shared signer per process."""

from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

from django.test import SimpleTestCase, override_settings

from core.files.models import File
from core.files.services import get_download_url
from core.files.storage import S3Presigner, get_presigner

STORAGE = {
    "S3_ENDPOINT_URL": "http://minio:9000",
    "S3_BUCKET_NAME": "schoolhub-test",
    "S3_REGION_NAME": "us-east-1",
    "AWS_ACCESS_KEY_ID": "test-access-key",
    "AWS_SECRET_ACCESS_KEY": "test-secret-key",
}


class S3PresignerEndpointTests(SimpleTestCase):
    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="http://localhost:9000")
    def test_presigned_urls_use_the_public_endpoint(self):
        presigner = S3Presigner()

        upload = presigner.presign_upload(storage_key="tenants/t/photo.png", mime_type="image/png")
        download = presigner.presign_download(storage_key="tenants/t/photo.png")

        # `minio:9000` only resolves inside the Docker network; a browser given it can't PUT.
        self.assertEqual(urlsplit(upload.upload_url).netloc, "localhost:9000")
        self.assertEqual(urlsplit(download).netloc, "localhost:9000")

    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="")
    def test_presigned_urls_fall_back_to_the_storage_endpoint(self):
        upload = S3Presigner().presign_upload(
            storage_key="tenants/t/photo.png", mime_type="image/png"
        )

        self.assertEqual(urlsplit(upload.upload_url).netloc, "minio:9000")


class S3PresignerSignatureTests(SimpleTestCase):
    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="http://localhost:9000")
    def test_links_are_signed_with_sigv4(self):
        url = S3Presigner().presign_download(storage_key="tenants/t/photo.png")

        query = parse_qs(urlsplit(url).query)
        # AWS S3 buckets created since 2020 reject the legacy V2 `Signature` parameter.
        self.assertEqual(query.get("X-Amz-Algorithm"), ["AWS4-HMAC-SHA256"])
        self.assertNotIn("Signature", query)

    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="")
    def test_download_links_default_to_five_minutes(self):
        url = S3Presigner().presign_download(storage_key="tenants/t/photo.png")

        self.assertEqual(parse_qs(urlsplit(url).query).get("X-Amz-Expires"), ["300"])

    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="")
    def test_download_links_take_an_expiry_and_a_cache_control(self):
        url = S3Presigner().presign_download(
            storage_key="tenants/t/photo.png",
            expires_in=3600,
            cache_control="private, max-age=3600",
        )

        query = parse_qs(urlsplit(url).query)
        self.assertEqual(query.get("X-Amz-Expires"), ["3600"])
        self.assertEqual(query.get("response-cache-control"), ["private, max-age=3600"])

    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="")
    def test_download_links_take_a_content_disposition(self):
        url = S3Presigner().presign_download(
            storage_key="tenants/t/report.pdf",
            content_disposition='attachment; filename="report.pdf"',
        )

        query = parse_qs(urlsplit(url).query)
        self.assertEqual(
            query.get("response-content-disposition"), ['attachment; filename="report.pdf"']
        )


class GetDownloadUrlTests(SimpleTestCase):
    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="")
    def test_sets_a_content_disposition_header_from_the_files_own_name(self):
        # Unsaved instance — SimpleTestCase forbids DB access, but constructing a model
        # in memory without .save() never touches the database.
        file = File(storage_key="tenants/t/report.pdf", original_name="Report Card.pdf")

        url = get_download_url(file)

        query = parse_qs(urlsplit(url).query)
        self.assertIn("response-content-disposition", query)
        self.assertIn("Report Card.pdf", query["response-content-disposition"][0])


class GetPresignerTests(SimpleTestCase):
    def test_returns_one_shared_instance(self):
        # Building boto3 clients costs ~6 ms warm (443 ms cold); signing costs ~0.1 ms.
        self.assertIs(get_presigner(), get_presigner())

    def test_a_storage_setting_change_rebuilds_it(self):
        before = get_presigner()

        with override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL=""):
            during = get_presigner()
            self.assertIsInstance(during, S3Presigner)

        self.assertIsNot(during, before)
        self.assertIsNot(get_presigner(), during)
