"""Retention for stored `Idempotency-Key` responses.

`replay_or_execute` only ever reads rows younger than its 24h window, so an
expired row is dead weight that still holds a full response body — and the
partial unique index on (tenant, key, endpoint) keeps it there forever,
eventually rejecting a client that legitimately reuses a key months later.
Nothing pruned them until now because there was no scheduler running anything;
`CELERY_BEAT_SCHEDULE` in config/settings/base.py is where this is wired.
"""

from __future__ import annotations

import datetime
import uuid

from celery import shared_task
from django.utils import timezone

from core.idempotency.models import IdempotencyRecord
from core.tenancy.maintenance import for_each_tenant

# Deliberately longer than services._TTL's 24h: a row inside the replay window
# must never be pruned, and a margin means a delayed or skipped tick cannot eat
# into it. Everything older is unreachable by definition.
RETENTION = datetime.timedelta(days=2)


def prune_tenant(tenant_id: uuid.UUID) -> int:
    """Hard-delete this tenant's unreachable records. Retention, not an API action.

    A soft delete would leave the row occupying its slot in the partial unique
    index (which excludes only `deleted_at IS NOT NULL`… and so would exclude it
    — but the row itself, and its response body, would still be stored forever).
    """
    cutoff = timezone.now() - RETENTION
    deleted, _ = IdempotencyRecord.objects.filter(created_at__lt=cutoff).delete()
    return deleted


@shared_task
def prune_idempotency_records() -> dict[str, int]:
    return for_each_tenant(prune_tenant, job="idempotency-prune")
