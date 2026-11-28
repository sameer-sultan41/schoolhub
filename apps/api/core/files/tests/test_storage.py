"""S3Presigner and get_presigner: which host links are signed for, how they are signed, what
download links carry, and one shared signer per process."""

from __future__ import annotations

import io
from unittest import mock
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


class S3PresignerTransferTests(SimpleTestCase):
    """The server-side writes and reads a tenant export makes (boto3's documented calls)."""

    def presigner(self) -> S3Presigner:
        presigner = S3Presigner()
        presigner._client = mock.Mock()
        return presigner

    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="")
    def test_put_sends_bytes_in_one_request(self):
        presigner = self.presigner()

        presigner.put(storage_key="tenants/t/a.csv", data=b"x", content_type="text/csv")

        presigner._client.put_object.assert_called_once_with(
            Bucket="schoolhub-test", Key="tenants/t/a.csv", Body=b"x", ContentType="text/csv"
        )
        presigner._client.upload_fileobj.assert_not_called()

    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="")
    def test_put_streams_a_file_object_as_a_managed_upload(self):
        presigner = self.presigner()
        stream = io.BytesIO(b"zip")

        presigner.put(storage_key="tenants/t/a.zip", data=stream, content_type="application/zip")

        presigner._client.upload_fileobj.assert_called_once_with(
            stream,
            "schoolhub-test",
            "tenants/t/a.zip",
            ExtraArgs={"ContentType": "application/zip"},
        )
        presigner._client.put_object.assert_not_called()

    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="")
    def test_open_returns_the_object_s_body_stream(self):
        presigner = self.presigner()
        body = io.BytesIO(b"stored")
        presigner._client.get_object.return_value = {"Body": body}

        self.assertIs(presigner.open(storage_key="tenants/t/a.pdf"), body)
        presigner._client.get_object.assert_called_once_with(
            Bucket="schoolhub-test", Key="tenants/t/a.pdf"
        )

    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="")
    def test_open_of_a_missing_object_is_file_not_found(self):
        from botocore.exceptions import ClientError

        presigner = self.presigner()
        presigner._client.get_object.side_effect = ClientError(
            {"Error": {"Code": "NoSuchKey", "Message": "gone"}}, "GetObject"
        )

        with self.assertRaises(FileNotFoundError):
            presigner.open(storage_key="tenants/t/gone.pdf")


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
