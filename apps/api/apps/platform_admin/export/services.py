"""A full export of one school (platform-admin.md §5, §7.9): one CSV per tenant-owned table,
its settings, its users and their roles, and its stored files, zipped into storage under the
school's prefix.

Every read runs with that one school bound (`tenant_atomic`), so RLS holds as it does for
the school's own requests; each query also filters on the school's id. `users`,
`user_roles` and `tenant_settings` are filtered on it explicitly.

Rows stream from a server-side cursor (`iterator()`), one table per transaction, and the
archive is written to a temporary file, then streamed to storage: no table and no archive is
held in memory whole.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import shutil
import tempfile
import uuid
import zipfile
from collections.abc import Iterable
from datetime import date, datetime, time
from typing import IO

from django.apps import apps
from django.db import models
from django.utils import timezone

from apps.platform_admin.constants import TENANT_EXPORT_JOB_TYPE
from apps.platform_admin.uploads import TENANT_EXPORT
from core.audit.services import _REDACTED_FIELDS
from core.exports.tabular import spreadsheet_safe
from core.files.models import File, FileStatus
from core.files.services import create_ready_file
from core.files.storage import get_presigner
from core.jobs.models import BackgroundJob, JobStatus
from core.jobs.services import create_job
from core.rbac.models import User, UserRole
from core.tenancy.context import tenant_atomic
from core.tenancy.models import Tenant, TenantScopedModel, TenantSettings

logger = logging.getLogger(__name__)

#: Columns no export carries: the audit trail's redactions, credentials and their hashes, and
#: the encrypted integration credentials. Any `BinaryField` is left out as well (ciphertext).
EXPORT_DENIED_FIELDS = _REDACTED_FIELDS | frozenset(
    {
        "password",
        "token_hash",
        "mfa_secret",
        "code_hash",
        "credentials_ciphertext",
        "callback_token",
    }
)

ARCHIVE_MIME_TYPE = "application/zip"
_CHUNK_SIZE = 2000
_IN_FLIGHT = (JobStatus.QUEUED, JobStatus.RUNNING)


def start_export(tenant: Tenant, *, actor_id: uuid.UUID) -> tuple[BackgroundJob, bool]:
    """The school's export job: the one in flight if there is one, else a new one.

    Runs with the school bound. Returns ``(job, created)``; only a created job is queued.
    """
    running = (
        BackgroundJob.objects.filter(job_type=TENANT_EXPORT_JOB_TYPE, status__in=_IN_FLIGHT)
        .order_by("-created_at")
        .first()
    )
    if running is not None:
        return running, False
    job = create_job(
        tenant_id=tenant.pk, job_type=TENANT_EXPORT_JOB_TYPE, payload={}, actor_id=actor_id
    )
    return job, True


def export_columns(model: type[models.Model]) -> list[str]:
    """The model's exported columns: every concrete one, minus the denied and the binary."""
    return [
        field.attname
        for field in model._meta.concrete_fields
        if field.attname not in EXPORT_DENIED_FIELDS
        and field.name not in EXPORT_DENIED_FIELDS
        and not isinstance(field, models.BinaryField)
    ]


def exported_models() -> list[type[models.Model]]:
    """Every tenant-owned model (`core.tenancy.rls.tenant_owned_tables`'s predicate), by table."""
    return sorted(
        (
            model
            for model in apps.get_models()
            if issubclass(model, TenantScopedModel) and not model._meta.abstract
        ),
        key=lambda model: model._meta.db_table,
    )


def _cell(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    if isinstance(value, dict | list):
        return json.dumps(value, sort_keys=True, default=str)
    return str(value)


def _write_csv(
    archive: zipfile.ZipFile, name: str, columns: list[str], rows: Iterable[tuple]
) -> int:
    """Stream ``rows`` into ``name`` in the archive; returns the row count."""
    count = 0
    with archive.open(name, "w", force_zip64=True) as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8", newline="")
        writer = csv.writer(text)
        writer.writerow(columns)
        for row in rows:
            # Free text a school typed must not run as a formula when the file is opened.
            writer.writerow([spreadsheet_safe(_cell(value)) for value in row])
            count += 1
        text.flush()
        text.detach()
    return count


def _table(
    archive: zipfile.ZipFile, tenant_id: uuid.UUID, table: str, queryset: models.QuerySet
) -> int:
    columns = export_columns(queryset.model)
    with tenant_atomic(tenant_id):
        rows = queryset.order_by("pk").values_list(*columns).iterator(chunk_size=_CHUNK_SIZE)
        return _write_csv(archive, f"data/{table}.csv", columns, rows)


def _stored_files(tenant_id: uuid.UUID) -> list[tuple[uuid.UUID, str, str]]:
    """The school's ready files, earlier export archives aside."""
    with tenant_atomic(tenant_id):
        return list(
            File.objects.filter(
                tenant_id=tenant_id, status=FileStatus.READY, deleted_at__isnull=True
            )
            .exclude(purpose=TENANT_EXPORT.key)
            .order_by("pk")
            .values_list("pk", "storage_key", "original_name")
        )


def _files(archive: zipfile.ZipFile, tenant_id: uuid.UUID) -> int:
    presigner = get_presigner()
    stored = _stored_files(tenant_id)
    for file_id, storage_key, original_name in stored:
        source = presigner.open(storage_key=storage_key)
        try:
            safe_name = original_name.replace("/", "_")
            with archive.open(f"files/{file_id}-{safe_name}", "w", force_zip64=True) as target:
                shutil.copyfileobj(source, target)
        finally:
            source.close()
    return len(stored)


def write_archive(tenant_id: uuid.UUID, target: IO[bytes]) -> dict[str, int]:
    """Write the school's export into ``target`` as a zip; returns what it holds."""
    rows = 0
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for model in exported_models():
            manager = model._base_manager
            rows += _table(
                archive, tenant_id, model._meta.db_table, manager.filter(tenant_id=tenant_id)
            )
        # The school's settings row (branding, academic setup) is 1:1 with it, not tenant-owned.
        rows += _table(
            archive,
            tenant_id,
            "tenant_settings",
            TenantSettings.objects.filter(tenant_id=tenant_id),
        )
        rows += _table(archive, tenant_id, "users", User.objects.filter(tenant_id=tenant_id))
        rows += _table(
            archive,
            tenant_id,
            "user_roles",
            UserRole.objects.filter(user__tenant_id=tenant_id),
        )
        files = _files(archive, tenant_id)
    return {"tables": len(exported_models()) + 3, "rows": rows, "files": files}


def run_export(*, tenant_id: uuid.UUID, actor_id: uuid.UUID) -> dict:
    """Build the archive, store it as the school's file, and return the job's result."""
    tenant = Tenant.objects.get(pk=tenant_id)
    with tempfile.TemporaryFile() as archive:
        summary = write_archive(tenant_id, archive)
        stamp = timezone.now().strftime("%Y%m%d-%H%M%S")
        file = create_ready_file(
            tenant_id=tenant_id,
            purpose=TENANT_EXPORT.key,
            original_name=f"{tenant.slug}-export-{stamp}.zip",
            mime_type=ARCHIVE_MIME_TYPE,
            data=archive,
            actor_id=actor_id,
        )
    logger.info("Tenant export of %s: %s", tenant_id, summary)
    return {"result_file_id": str(file.pk), **summary}
