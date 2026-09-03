"""Replay logic for `Idempotency-Key` (api-architecture.md §2.5)."""

from __future__ import annotations

import datetime
import uuid
from collections.abc import Callable

from django.utils import timezone
from rest_framework.response import Response

from core.idempotency.models import IdempotencyRecord

_TTL = datetime.timedelta(hours=24)


def replay_or_execute(
    *, tenant_id: uuid.UUID, key: str | None, endpoint: str, execute: Callable[[], Response]
) -> Response:
    """Replay a stored response for a repeated ``key`` within the 24h window,

    otherwise run ``execute()`` once and store its response for next time.

    Check-then-store, not reserve-then-execute: a genuine concurrent double
    submit (two requests carrying the same key arriving within milliseconds of
    each other) is not fully guarded against here — each action's own service
    already enforces the uniqueness that actually matters (one enrollment per
    student per session, one primary guardian, …), which is the real safety
    net for that rare race. This layer turns an ordinary client
    retry-after-timeout into a replay; it is not distributed-lock-grade
    exactly-once semantics.
    """
    if not key:
        return execute()

    cutoff = timezone.now() - _TTL
    existing = IdempotencyRecord.objects.filter(
        tenant_id=tenant_id, key=key, endpoint=endpoint, created_at__gte=cutoff
    ).first()
    if existing is not None:
        return Response(existing.response_body, status=existing.response_status)

    response = execute()
    IdempotencyRecord.objects.get_or_create(
        tenant_id=tenant_id,
        key=key,
        endpoint=endpoint,
        defaults={"response_status": response.status_code, "response_body": response.data},
    )
    return response
