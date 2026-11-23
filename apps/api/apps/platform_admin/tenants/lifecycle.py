"""The tenant lifecycle state machine (multi-tenancy.md §7, platform-admin.md §7).

`transition` is the only writer of ``Tenant.status`` after creation. It moves a tenant along
the edges of `ALLOWED_TRANSITIONS` and no others, stamps the lifecycle timestamps, and tells
the school's owner when it is suspended or reinstated.

Who audits: a person's transition is audited by the view, which has the request
(``record_audit``, with the actor, IP and request id). A system caller (a sweep or a billing
webhook) passes ``actor_id=None``, and the transition audits itself through
``record_system_audit``.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.platform_admin import notifications
from core.api.exceptions import CodedAPIException
from core.audit.services import record_system_audit
from core.tenancy.models import Tenant, TenantStatus

S = TenantStatus

# The plan's lifecycle table, edge for edge. Each comment names what drives the edge.
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    # `:provision`; `:delete` of a tenant created by mistake.
    S.PROVISIONING: frozenset({S.TRIAL, S.DEPROVISIONED}),
    # Subscription activated; trial-expiry sweep or `:suspend`.
    S.TRIAL: frozenset({S.ACTIVE, S.SUSPENDED}),
    # Payment failed; `:suspend`; `:delete`.
    S.ACTIVE: frozenset({S.PAST_DUE, S.SUSPENDED, S.DEPROVISIONED}),
    # Payment recorded; grace sweep or `:suspend`.
    S.PAST_DUE: frozenset({S.ACTIVE, S.SUSPENDED}),
    # `:reinstate`, to the status the live subscription implies; `:delete`.
    S.SUSPENDED: frozenset({S.ACTIVE, S.PAST_DUE, S.TRIAL, S.DEPROVISIONED}),
    # `:restore`, only inside the retention window.
    S.DEPROVISIONED: frozenset({S.SUSPENDED}),
}

OPERATIONAL = frozenset({S.TRIAL, S.ACTIVE, S.PAST_DUE})


class InvalidTransition(CodedAPIException):
    status_code = 409
    default_detail = "This tenant cannot move to that status from its current one."
    default_code = "invalid_transition"


class RetentionExpired(CodedAPIException):
    status_code = 409
    default_detail = "This tenant's retention window has ended; it can no longer be restored."
    default_code = "retention_expired"


def assert_can_transition(tenant: Tenant, to: str) -> None:
    """Raise `InvalidTransition` unless ``tenant`` may move to ``to`` now."""
    if to not in ALLOWED_TRANSITIONS.get(tenant.status, frozenset()):
        raise InvalidTransition(meta={"from": tenant.status, "to": to})
    if tenant.status == S.DEPROVISIONED and not (
        tenant.deprovision_after is not None and timezone.now() < tenant.deprovision_after
    ):
        raise RetentionExpired()


@transaction.atomic
def transition(tenant: Tenant, to: str, *, actor_id: uuid.UUID | None, reason: str = "") -> Tenant:
    """Move ``tenant`` to ``to`` and return it, or raise; nothing changes on a refusal.

    The row is re-read under a lock, so two concurrent actions on one tenant run one after
    the other and the second is judged on the first's result. ``tenant`` itself is updated
    in place as well, for a caller that goes on using it.
    """
    locked = Tenant.objects.select_for_update().get(pk=tenant.pk)
    source = locked.status
    assert_can_transition(locked, to)

    now = timezone.now()
    locked.status = to
    fields = ["status", "updated_at"]
    if to == S.SUSPENDED:
        # A restored school keeps its suspension time; one deleted without a suspension
        # (from provisioning or active) gets one now.
        if source != S.DEPROVISIONED or locked.suspended_at is None:
            locked.suspended_at = now
        # Restoring ends the retention countdown; the school is suspended again.
        locked.deprovision_after = None
        fields += ["suspended_at", "deprovision_after"]
    elif to == S.DEPROVISIONED:
        locked.deprovision_after = now + timedelta(days=settings.PLATFORM_RETENTION_DAYS)
        fields.append("deprovision_after")
    elif source == S.SUSPENDED:
        locked.suspended_at = None
        fields.append("suspended_at")
    if actor_id is not None:
        locked.updated_by = actor_id
        fields.append("updated_by")
    locked.save(update_fields=fields)

    for field in fields:
        setattr(tenant, field, getattr(locked, field))

    if actor_id is None:
        record_system_audit(
            locked.pk,
            _AUDIT_ACTIONS[(source, to)],
            locked,
            context={"from": source, "to": to, "reason": reason},
        )

    if to == S.SUSPENDED and source in OPERATIONAL:
        notifications.notify_owners(locked, notifications.TENANT_SUSPENDED)
    elif source == S.SUSPENDED and to in OPERATIONAL:
        notifications.notify_owners(locked, notifications.TENANT_REINSTATED)
    return locked


# The audit action of a system transition: the same verbs the views record.
_AUDIT_ACTIONS: dict[tuple[str, str], str] = {
    (S.PROVISIONING, S.TRIAL): "provision",
    (S.PROVISIONING, S.DEPROVISIONED): "delete",
    (S.TRIAL, S.ACTIVE): "activate",
    (S.TRIAL, S.SUSPENDED): "suspend",
    (S.ACTIVE, S.PAST_DUE): "mark_past_due",
    (S.ACTIVE, S.SUSPENDED): "suspend",
    (S.ACTIVE, S.DEPROVISIONED): "delete",
    (S.PAST_DUE, S.ACTIVE): "activate",
    (S.PAST_DUE, S.SUSPENDED): "suspend",
    (S.SUSPENDED, S.ACTIVE): "reinstate",
    (S.SUSPENDED, S.PAST_DUE): "reinstate",
    (S.SUSPENDED, S.TRIAL): "reinstate",
    (S.SUSPENDED, S.DEPROVISIONED): "delete",
    (S.DEPROVISIONED, S.SUSPENDED): "restore",
}
