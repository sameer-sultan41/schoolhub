"""Audit recording.

Kept as a function rather than a signal so the audit entry carries request context
(actor, ip, request id) that signals cannot see, and so it is obvious at the call
site that a mutation is audited.
"""

from __future__ import annotations

import logging
from typing import Any

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

        return AuditLog.objects.create(
            tenant=tenant,
            actor=user if user and user.is_authenticated else None,
            impersonated_by=getattr(request, "impersonated_by", None),
            action=action,
            resource_type=instance._meta.label_lower,
            resource_id=getattr(instance, "pk", None),
            before=_redact(before) if before is not None else None,
            after=_redact(after) if after is not None else None,
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
        AuditLog.objects.create(
            tenant=getattr(request, "tenant", None),
            actor=user if user and getattr(user, "is_authenticated", False) else None,
            action=action,
            resource_type="security.event",
            after=_redact(context) or None,
            request_id=getattr(request, "request_id", "") or "",
            ip_address=_client_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:400],
        )
    except Exception:
        logger.exception("failed to write security event", extra={"action": action})
