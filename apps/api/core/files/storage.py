"""Object-storage presigning, abstracted behind a small protocol.

Two implementations: ``S3Presigner`` (real, boto3-backed — talks to MinIO in
local/CI compose and to S3 in prod, same API) and ``NullPresigner`` (returns
fake-but-well-shaped URLs, no network). ``get_presigner()`` picks one from
settings so the test suite and CI never need a real object store — see
``config/settings/test.py``.
"""

from __future__ import annotations

import datetime
import uuid
from dataclasses import dataclass
from typing import Protocol

from django.conf import settings

_UPLOAD_EXPIRY_SECONDS = 900
_DOWNLOAD_EXPIRY_SECONDS = 300


@dataclass(frozen=True)
class PresignedUpload:
    upload_url: str
    upload_method: str
    headers: dict[str, str]
    expires_at: datetime.datetime


class Presigner(Protocol):
    def presign_upload(self, *, storage_key: str, mime_type: str) -> PresignedUpload: ...
    def presign_download(self, *, storage_key: str) -> str: ...
    def head(self, *, storage_key: str) -> dict | None:
        """Return {"size_bytes": int} if the object exists, else None."""
        ...


def storage_key_for(*, tenant_id: uuid.UUID, purpose: str, original_name: str) -> str:
    """tenants/{tenant_id}/… prefix per multi-tenancy.md §3 — the tenant boundary

    for object storage, independent of and in addition to RLS on this table.
    """
    unique = uuid.uuid4().hex
    safe_name = original_name.replace("/", "_")
    return f"tenants/{tenant_id}/{purpose}/{unique}-{safe_name}"


class NullPresigner:
    """No network calls — used whenever ``S3_ENDPOINT_URL`` is unset (tests, CI)."""

    def presign_upload(self, *, storage_key: str, mime_type: str) -> PresignedUpload:
        now = datetime.datetime.now(datetime.UTC)
        return PresignedUpload(
            upload_url=f"https://null-presigner.invalid/{storage_key}",
            upload_method="PUT",
            headers={"Content-Type": mime_type},
            expires_at=now + datetime.timedelta(seconds=_UPLOAD_EXPIRY_SECONDS),
        )

    def presign_download(self, *, storage_key: str) -> str:
        return f"https://null-presigner.invalid/{storage_key}"

    def head(self, *, storage_key: str) -> dict | None:
        # Nothing was ever really uploaded — services.confirm_upload has to be
        # able to run in tests regardless, so this always reports "found" at a
        # size the caller cannot have violated.
        return {"size_bytes": 0}


class S3Presigner:
    """boto3-backed. Same behaviour against real S3 or a MinIO-compatible endpoint."""

    def __init__(self) -> None:
        import boto3

        self._client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=settings.S3_REGION_NAME,
        )
        self._bucket = settings.S3_BUCKET_NAME

    def presign_upload(self, *, storage_key: str, mime_type: str) -> PresignedUpload:
        now = datetime.datetime.now(datetime.UTC)
        url = self._client.generate_presigned_url(
            "put_object",
            Params={"Bucket": self._bucket, "Key": storage_key, "ContentType": mime_type},
            ExpiresIn=_UPLOAD_EXPIRY_SECONDS,
        )
        return PresignedUpload(
            upload_url=url,
            upload_method="PUT",
            headers={"Content-Type": mime_type},
            expires_at=now + datetime.timedelta(seconds=_UPLOAD_EXPIRY_SECONDS),
        )

    def presign_download(self, *, storage_key: str) -> str:
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": storage_key},
            ExpiresIn=_DOWNLOAD_EXPIRY_SECONDS,
        )

    def head(self, *, storage_key: str) -> dict | None:
        from botocore.exceptions import ClientError

        try:
            response = self._client.head_object(Bucket=self._bucket, Key=storage_key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey"}:
                return None
            raise
        return {"size_bytes": response["ContentLength"]}


def get_presigner() -> Presigner:
    if settings.S3_ENDPOINT_URL:
        return S3Presigner()
    return NullPresigner()
