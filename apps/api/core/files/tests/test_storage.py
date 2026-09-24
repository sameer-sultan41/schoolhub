"""S3Presigner's endpoint split: the API reaches storage on one host, the browser on another."""

from __future__ import annotations

from urllib.parse import urlsplit

from django.test import SimpleTestCase, override_settings

from core.files.storage import S3Presigner

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
        upload = S3Presigner().presign_upload(storage_key="tenants/t/photo.png", mime_type="image/png")

        self.assertEqual(urlsplit(upload.upload_url).netloc, "minio:9000")
