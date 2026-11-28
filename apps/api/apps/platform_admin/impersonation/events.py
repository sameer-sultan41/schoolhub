"""What each step of a grant's life records: a security event, and the owners' notice.

Every start, exchange, release, revocation and expiry is audited (SEC-06; auth-and-rbac §4),
attributed to the grant's school. A start and an end tell the school's owners in-app (§12).
"""

from __future__ import annotations

from apps.platform_admin import notifications
from apps.platform_admin.models import ImpersonationEnd, ImpersonationGrant
from core.audit.services import record_security_event, record_task_security_event

GRANTED = "platform.impersonation.granted"
EXCHANGED = "platform.impersonation.exchanged"
EXCHANGE_REFUSED = "platform.impersonation.exchange_refused"
# How a grant ended, by `ImpersonationEnd`.
ENDED = {
    ImpersonationEnd.RELEASED: "platform.impersonation.released",
    ImpersonationEnd.REVOKED: "platform.impersonation.revoked",
    ImpersonationEnd.SUPERSEDED: "platform.impersonation.superseded",
    ImpersonationEnd.EXPIRED: "platform.impersonation.expired",
}


def _context(grant: ImpersonationGrant) -> dict[str, object]:
    return {
        "grant_id": str(grant.pk),
        "target_user_id": str(grant.target_user_id),
        "granted_to": str(grant.granted_to_id),
        "expires_at": grant.expires_at.isoformat(),
    }


def granted(request, grant: ImpersonationGrant) -> None:
    record_security_event(
        request, GRANTED, tenant=grant.tenant, reason=grant.reason, **_context(grant)
    )
    _notify(grant, "started")


def exchanged(request, grant: ImpersonationGrant) -> None:
    record_security_event(request, EXCHANGED, tenant=grant.tenant, **_context(grant))


def exchange_refused(request, grant: ImpersonationGrant | None) -> None:
    """A refused code. The row names the grant it matched, if any; the response never does."""
    if grant is None:
        record_security_event(request, EXCHANGE_REFUSED)
    else:
        record_security_event(request, EXCHANGE_REFUSED, tenant=grant.tenant, **_context(grant))


def ended(grant: ImpersonationGrant, *, request=None) -> None:
    """A grant's end: by a person (with the request) or by the expiry sweep (without)."""
    action = ENDED[ImpersonationEnd(grant.end_reason)]
    if request is not None:
        record_security_event(request, action, tenant=grant.tenant, **_context(grant))
    else:
        record_task_security_event(
            action, tenant_id=grant.tenant_id, resource_id=grant.pk, **_context(grant)
        )
    # A superseded grant is followed at once by the new grant's own notice.
    if grant.end_reason != ImpersonationEnd.SUPERSEDED:
        _notify(grant, "ended")


# Named to the school without any of the operator's contact details.
SUPPORT_NAME = "SchoolHub support"
_WHEN = "%Y-%m-%d %H:%M UTC"


def _notify(grant: ImpersonationGrant, event: str) -> None:
    if event == "started":
        timing = f"It ends by {grant.expires_at.strftime(_WHEN)} at the latest."
    else:
        timing = f"It ended at {(grant.released_at or grant.expires_at).strftime(_WHEN)}."
    operator = grant.granted_to.get_full_name()
    notifications.notify_owners(
        grant.tenant,
        notifications.IMPERSONATION,
        context={
            "impersonation.event": event,
            "impersonation.operator": f"{SUPPORT_NAME} ({operator})" if operator else SUPPORT_NAME,
            "impersonation.target": grant.target_user.get_full_name() or grant.target_user.email,
            "impersonation.reason": grant.reason,
            "impersonation.timing": timing,
        },
        source_type="impersonation_grant",
        source_id=grant.pk,
    )
