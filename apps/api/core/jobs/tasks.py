"""Retention for finished background jobs.

`BackgroundJob` rows are a client-facing progress resource (`GET /jobs/{id}`),
not a permanent record: once a job has finished and its poller has read the
outcome, the row is only holding a payload. `payload` in particular can carry
the base64 of an uploaded import file (see apps/*/views.py's import actions), so
these rows are the largest thing in the table and the most worth reclaiming.

Queued and running jobs are never pruned regardless of age — a job stuck in
`running` is an incident to investigate, and deleting the evidence would hide it.
"""

from __future__ import annotations

import datetime
import uuid

from celery import shared_task
from django.utils import timezone

from core.jobs.models import BackgroundJob, JobStatus
from core.tenancy.maintenance import for_each_tenant

# Long enough that a user who kicked off an export on Friday can still fetch it
# on Monday; the result File it points at has its own lifecycle and is untouched.
RETENTION = datetime.timedelta(days=30)

TERMINAL_STATUSES = (JobStatus.SUCCEEDED, JobStatus.FAILED)


def prune_tenant(tenant_id: uuid.UUID) -> int:
    cutoff = timezone.now() - RETENTION
    deleted, _ = BackgroundJob.objects.filter(
        status__in=TERMINAL_STATUSES, finished_at__lt=cutoff
    ).delete()
    return deleted


@shared_task
def prune_background_jobs() -> dict[str, int]:
    return for_each_tenant(prune_tenant, job="background-job-prune")
