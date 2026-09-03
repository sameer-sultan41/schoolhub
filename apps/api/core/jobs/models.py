"""Tracked long-running operations (docs/05-database/entities/tenancy.md,

api-architecture.md §2.7). A module kicks off a Celery task (built on
``core.tenancy.tasks.TenantAwareTask``) and returns this row's id as
``job_id`` in a `202` response; the client polls `GET /api/v1/jobs/{id}`.

Deliberate deviation from the entity doc, matching ``core.files.File``'s own
precedent exactly: ``tenant`` is NOT NULL here (``TenantOwnedModel``), where
the doc allows a nullable tenant for platform-scope jobs. A nullable tenant_id
would make this table invisible to
``core.tenancy.rls.tenant_owned_tables()`` (it walks ``TenantOwnedModel``
subclasses), so it would ship with no RLS policy and no failing test to catch
that. Platform-scope jobs get their own home when that need actually arrives.

The entity doc also says "no soft delete — pruned by retention policy"; this
inherits ``deleted_at`` anyway via ``TenantOwnedModel`` (it is simply never
set) — no pruning job exists yet, the same gap as
``core.idempotency.IdempotencyRecord``'s un-pruned 24h window.

Nullable string columns below (``error``, ``idempotency_key``,
``celery_task_id``) are NULL-not-blank by design — see
school_organization/models.py's header for why — hence the blanket DJ001
suppression.
"""
# ruff: noqa: DJ001

from __future__ import annotations

from django.db import models

from core.tenancy.models import TenantOwnedModel


class JobStatus(models.TextChoices):
    QUEUED = "queued", "Queued"
    RUNNING = "running", "Running"
    SUCCEEDED = "succeeded", "Succeeded"
    FAILED = "failed", "Failed"


class BackgroundJob(TenantOwnedModel):
    job_type = models.CharField(
        max_length=60, help_text="e.g. 'import.students', 'export.students', 'id-cards.generate'."
    )
    status = models.CharField(max_length=20, choices=JobStatus.choices, default=JobStatus.QUEUED)
    progress = models.PositiveSmallIntegerField(default=0)
    payload = models.JSONField(
        default=dict, blank=True, help_text="Input parameters (PII-minimized)."
    )
    result = models.JSONField(
        null=True, blank=True, help_text="Result summary, e.g. result_file_id."
    )
    error = models.TextField(null=True, blank=True)
    idempotency_key = models.CharField(max_length=64, null=True, blank=True)
    celery_task_id = models.CharField(max_length=64, null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "background_jobs"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "idempotency_key"],
                name="background_jobs_unique_idempotency_key",
                condition=models.Q(deleted_at__isnull=True, idempotency_key__isnull=False),
            ),
            models.CheckConstraint(
                condition=models.Q(progress__gte=0, progress__lte=100),
                name="background_jobs_progress_range",
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "status", "created_at"], name="background_jobs_status_idx"
            ),
            models.Index(fields=["tenant", "job_type"], name="background_jobs_type_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.job_type} ({self.status})"
