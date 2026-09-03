"""The two-step upload flow (api-architecture.md §2.8).

    POST /api/v1/files            -> {file_id, upload_url, ...}, row is `pending`
    (client PUTs the bytes directly to upload_url)
    POST /api/v1/files/{id}:confirm -> row flips to `ready` (or `quarantined`)

Kept as services, not inline in the view, so a Celery import job (a later PR)
can drive the same flow without going through HTTP.
"""

from __future__ import annotations

import uuid
from typing import cast

from django.conf import settings
from django.db import transaction

from core.api.exceptions import Conflict, DomainRuleViolation
from core.files.models import File, FileStatus
from core.files.storage import NullPresigner, get_presigner, storage_key_for


def assert_upload_allowed(*, purpose: str, mime_type: str, size_bytes: int) -> None:
    rules = settings.FILE_UPLOAD_RULES.get(purpose)
    if rules is None:
        raise DomainRuleViolation({"purpose": f"Unknown upload purpose '{purpose}'."})

    # settings.FILE_UPLOAD_RULES is a plain dict (heterogeneous per-key value
    # types), so mypy sees each value as `object` — narrow explicitly rather
    # than silencing the checks.
    mime_types = cast("set[str]", rules["mime_types"])
    max_size_bytes = cast("int", rules["max_size_bytes"])

    if mime_type not in mime_types:
        raise DomainRuleViolation(
            {"mime_type": f"'{mime_type}' is not allowed for '{purpose}' uploads."}
        )
    if size_bytes > max_size_bytes:
        raise DomainRuleViolation(
            {"size_bytes": f"File exceeds the {max_size_bytes}-byte limit for '{purpose}'."}
        )


@transaction.atomic
def create_upload(
    *,
    tenant_id: uuid.UUID,
    purpose: str,
    original_name: str,
    mime_type: str,
    size_bytes: int,
    actor_id: uuid.UUID,
) -> tuple[File, dict]:
    """Create the pending File row and return it with the presigned upload details."""
    assert_upload_allowed(purpose=purpose, mime_type=mime_type, size_bytes=size_bytes)

    storage_key = storage_key_for(tenant_id=tenant_id, purpose=purpose, original_name=original_name)
    file = File.objects.create(
        tenant_id=tenant_id,
        storage_key=storage_key,
        original_name=original_name,
        mime_type=mime_type,
        size_bytes=size_bytes,
        purpose=purpose,
        status=FileStatus.PENDING,
        created_by=actor_id,
        updated_by=actor_id,
    )

    presigned = get_presigner().presign_upload(storage_key=storage_key, mime_type=mime_type)
    return file, {
        "upload_url": presigned.upload_url,
        "upload_method": presigned.upload_method,
        "headers": presigned.headers,
        "expires_at": presigned.expires_at,
    }


@transaction.atomic
def confirm_upload(*, file: File, actor_id: uuid.UUID) -> File:
    """Verify the object actually landed in storage, then flip pending -> ready.

    AV scanning is not wired up (no scanner in the stack yet — see the model's
    ``av_scanned_at`` docstring), so ``quarantined`` is unreachable today; this
    is the honest state of api-architecture.md §11's "type/size whitelist, AV
    scan" requirement, not a silent skip.
    """
    if file.status != FileStatus.PENDING:
        raise Conflict(f"File is already {file.status}.")

    presigner = get_presigner()
    found = presigner.head(storage_key=file.storage_key)
    if found is None:
        raise DomainRuleViolation(
            {"non_field": "The upload has not completed — nothing found at that storage key yet."}
        )
    # NullPresigner never talks to real storage — see its docstring, it always
    # reports {"size_bytes": 0} regardless of what (if anything) was uploaded — so
    # the mismatch check below is meaningless against it and must be skipped
    # explicitly, by presigner identity, not by treating every reported 0 as "no
    # real check happened": a real S3-backed zero-byte upload has to fail this check
    # like any other mismatch, not be waved through.
    if not isinstance(presigner, NullPresigner) and found["size_bytes"] != file.size_bytes:
        raise DomainRuleViolation(
            {
                "non_field": (
                    f"Uploaded size ({found['size_bytes']}) does not match the declared "
                    f"size ({file.size_bytes})."
                )
            }
        )

    file.status = FileStatus.READY
    file.updated_by = actor_id
    file.save(update_fields=["status", "updated_by", "updated_at"])
    return file


def get_download_url(file: File) -> str:
    return get_presigner().presign_download(storage_key=file.storage_key)
