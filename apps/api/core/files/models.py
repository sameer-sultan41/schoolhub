"""The tenant-wide file registry (docs/05-database/entities/tenancy.md, api-architecture.md §2.8).

Every module that needs an upload (student photos, student/staff documents,
ID-card assets, later ones) references a row here by ``file_id`` rather than
storing its own copy of storage metadata — one registry, one AV-scan/status
lifecycle, one signed-URL path.

Deliberate deviation from the entity doc: ``tenant`` is NOT NULL here
(``TenantOwnedModel``), where the doc allows a nullable tenant for platform-scope
assets. A nullable tenant_id would make this table invisible to
``core.tenancy.rls.tenant_owned_tables()`` (it walks ``TenantOwnedModel``
subclasses), so it would ship with no RLS policy and no failing test to catch
that — the same reasoning ``BackgroundJob`` will use in a later PR. Platform-scope
assets (theme previews, etc.) get their own home when that need actually arrives.

``checksum`` is nullable-not-blank by design: NULL means "not computed yet",
never "empty string" — hence the DJ001 suppression rather than a per-field one.
"""
# ruff: noqa: DJ001

from django.db import models

from core.tenancy.models import TenantOwnedModel


class FileStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    READY = "ready", "Ready"
    QUARANTINED = "quarantined", "Quarantined"


class FileVisibility(models.TextChoices):
    PRIVATE = "private", "Private"
    PUBLIC = "public", "Public"


class File(TenantOwnedModel):
    """One uploaded object. See ``core.files.services`` for the two-step upload flow."""

    storage_key = models.CharField(
        max_length=512,
        unique=True,
        help_text="Object-storage key, prefixed tenants/{tenant_id}/… (multi-tenancy.md §3).",
    )
    original_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=120)
    size_bytes = models.PositiveBigIntegerField()
    checksum = models.CharField(max_length=64, null=True, blank=True)
    purpose = models.CharField(
        max_length=40, help_text="What this file is for, e.g. 'student.photo', 'student.document'."
    )
    status = models.CharField(max_length=20, choices=FileStatus.choices, default=FileStatus.PENDING)
    visibility = models.CharField(
        max_length=20, choices=FileVisibility.choices, default=FileVisibility.PRIVATE
    )
    av_scanned_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Set once an AV scan has run. No scanner is wired up yet (see "
        "core.files.tasks docstring) — this column exists so the contract is "
        "in place before the scanner is, not because scanning happens today.",
    )

    class Meta:
        db_table = "files"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "purpose"], name="files_tenant_purpose_idx"),
            models.Index(fields=["tenant", "status"], name="files_tenant_status_idx"),
        ]

    def __str__(self) -> str:
        return self.original_name
