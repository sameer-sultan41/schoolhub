"""Replay logic for `Idempotency-Key` (api-architecture.md §2.5)."""

from __future__ import annotations

import datetime
import hashlib
import json
import uuid
from collections.abc import Callable

from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone
from rest_framework.response import Response

from core.api.exceptions import DomainRuleViolation
from core.idempotency.models import IdempotencyRecord

_TTL = datetime.timedelta(hours=24)


class IdempotencyKeyReused(DomainRuleViolation):
    """A key already used, inside the replay window, with a different request body.

    422, as the IETF `Idempotency-Key` header draft (§2.7) and Stripe answer it:
    replaying the first body's response would tell the client its *second* request
    succeeded when it never ran.
    """

    default_detail = (
        "This Idempotency-Key was already used with a different request. "
        "Use a new key for a new request."
    )
    default_code = "idempotency_key_reused"


def request_fingerprint(request_data: object) -> str:
    """sha256 hex of ``request_data`` as canonical JSON (sorted keys, no whitespace).

    Canonical so that two bodies a client would call "the same" — keys in another
    order, other spacing — fingerprint alike. `DjangoJSONEncoder` because a
    caller may pass validated data still holding `uuid.UUID`/`date` values.
    """
    canonical = json.dumps(
        request_data, sort_keys=True, separators=(",", ":"), cls=DjangoJSONEncoder
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def replay_or_execute(
    *,
    tenant_id: uuid.UUID,
    key: str | None,
    endpoint: str,
    request_data: object,
    execute: Callable[[], Response],
) -> Response:
    """Replay a stored response for a repeated ``key`` within the 24h window,

    otherwise run ``execute()`` once and store its response for next time.

    ``request_data`` is the body the key is bound to — usually `request.data`; a
    multipart caller passes the fields it reads plus a digest of the file. A hit
    whose stored fingerprint differs raises `IdempotencyKeyReused` (422) instead of
    replaying. A row stored before fingerprints existed (empty) still replays.

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

    fingerprint = request_fingerprint(request_data)
    cutoff = timezone.now() - _TTL
    existing = IdempotencyRecord.objects.filter(
        tenant_id=tenant_id, key=key, endpoint=endpoint, created_at__gte=cutoff
    ).first()
    if existing is not None:
        if existing.request_fingerprint and existing.request_fingerprint != fingerprint:
            raise IdempotencyKeyReused()
        return Response(existing.response_body, status=existing.response_status)

    response = execute()
    IdempotencyRecord.objects.get_or_create(
        tenant_id=tenant_id,
        key=key,
        endpoint=endpoint,
        defaults={
            "request_fingerprint": fingerprint,
            "response_status": response.status_code,
            "response_body": response.data,
        },
    )
    return response
