"""Audit recording.

Kept as a function rather than a signal so the audit entry carries request context
(actor, ip, request id) that signals cannot see, and so it is obvious at the call
site that a mutation is audited.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction

from core.audit.models import AuditLog

logger = logging.getLogger(__name__)

# Never persist these into the audit trail, even if a serializer exposes them.
_REDACTED_FIELDS = frozenset(
    {
        "password",
        "new_password",
        "old_password",
        "token",
        "refresh",
        "access",
        "secret",
        "api_key",
        "otp",
        "national_id",
        "bank_account",
        "iban",
        "cvv",
    }
)

_REDACTED = "[redacted]"


def _redact(payload: Any) -> Any:
    if isinstance(payload, dict):
        return {
            key: (_REDACTED if key.lower() in _REDACTED_FIELDS else _redact(value))
            for key, value in payload.items()
        }
    if isinstance(payload, list):
        return [_redact(item) for item in payload]
    return payload


def _json_safe(payload: Any) -> Any:
    """Coerce a serializer payload into the types ``json.dumps`` accepts.

    DRF returns native objects — ``uuid.UUID`` from a ``PrimaryKeyRelatedField``,
    ``Decimal`` from a money field, ``date`` where a serializer declares one — and
    only stringifies them when it *renders* a response. A ``JSONField`` gets no
    such step: psycopg dumps the value with the plain stdlib encoder, so a single
    UUID raises ``TypeError`` from inside ``Model.save_base``, which marks the
    surrounding ATOMIC_REQUESTS transaction for rollback. Django then discards
    that transaction without raising, so the client keeps its 201 for a row that
    no longer exists. This conversion is load-bearing, not cosmetic.
    """
    return json.loads(json.dumps(payload, cls=DjangoJSONEncoder))


def _client_ip(request) -> str | None:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        # Left-most entry is the originating client.
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def record_audit(
    request,
    action: str,
    instance,
    *,
    before: dict | None = None,
    after: dict | None = None,
) -> AuditLog | None:
    """Write one audit row. Never raises — a logging failure must not fail the request."""
    try:
        user = getattr(request, "user", None)
        tenant = getattr(request, "tenant", None)

        # The savepoint is what makes the promise above true. Swallowing the
        # exception is not enough: a failed write marks the caller's transaction
        # for rollback, and under ATOMIC_REQUESTS Django then throws the whole
        # request away at exit *silently* — the mutation vanishes while the view
        # still answers 2xx. Rolling back to a savepoint confines the loss to
        # this row, which is the trade the docstring intends.
        with transaction.atomic():
            return AuditLog.objects.create(
                tenant=tenant,
                actor=user if user and user.is_authenticated else None,
                impersonated_by=getattr(request, "impersonated_by", None),
                action=action,
                resource_type=instance._meta.label_lower,
                resource_id=getattr(instance, "pk", None),
                before=_json_safe(_redact(before)) if before is not None else None,
                after=_json_safe(_redact(after)) if after is not None else None,
                request_id=getattr(request, "request_id", "") or "",
                ip_address=_client_ip(request),
                user_agent=request.META.get("HTTP_USER_AGENT", "")[:400],
            )
    except Exception:
        logger.exception("failed to write audit log", extra={"action": action})
        return None


def record_security_event(request, action: str, **context) -> None:
    """Auth-related events (login, MFA change, role change, export, impersonation)."""
    try:
        user = getattr(request, "user", None)
        # Savepointed for the same reason as record_audit: a failed security-event
        # write must not silently undo the password change that prompted it.
        with transaction.atomic():
            AuditLog.objects.create(
                tenant=getattr(request, "tenant", None),
                actor=user if user and getattr(user, "is_authenticated", False) else None,
                action=action,
                resource_type="security.event",
                after=_json_safe(_redact(context)) or None,
                request_id=getattr(request, "request_id", "") or "",
                ip_address=_client_ip(request),
                user_agent=request.META.get("HTTP_USER_AGENT", "")[:400],
            )
    except Exception:
        logger.exception("failed to write security event", extra={"action": action})
