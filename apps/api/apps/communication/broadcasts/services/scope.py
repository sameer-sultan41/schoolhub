"""`assert_sender_may_target` — a broadcast sender's record scope, applied to the audience.

`BroadcastViewSet` has no table to narrow, so `scope_queryset` never runs for it.
Without this check a campus-scoped holder of `communication.broadcast.send`
could broadcast to the whole school or to another campus. The scope is read the
way `scope_queryset` reads it: `all` is unrestricted; otherwise only the
campuses of the sender's `campus`-scoped roles are reachable. An `own` or
`assigned` scope has no campus, so it reaches nothing and fails closed.
"""

from __future__ import annotations

import uuid

from rest_framework.exceptions import NotFound

from apps.communication.audience import resolve_audience
from apps.communication.models import AudienceType
from core.api.exceptions import DomainRuleViolation
from core.rbac.models import RecordScope
from core.rbac.permissions import user_scopes

CAMPUS_REQUIRED_MESSAGE = (
    "Your access is limited to particular campuses: choose one of them as campus_id."
)


def sender_campus_ids(user) -> frozenset[uuid.UUID] | None:
    """`None` when the sender is unrestricted, else the campuses they may broadcast to."""
    scopes = user_scopes(user)
    if RecordScope.ALL in scopes:
        return None
    return frozenset(uuid.UUID(str(ref)) for ref in scopes.get(RecordScope.CAMPUS, []) if ref)


def assert_sender_may_target(
    *,
    user,
    tenant_id: uuid.UUID,
    audience_type: str,
    audience_filter: dict,
    campus_id: uuid.UUID | None,
) -> None:
    """422 if a restricted sender names no campus; 404 if it is not one of theirs.

    `campus_id` narrows every audience branch except `custom`, which is never
    narrowed by campus (`resolve_audience`). So for a restricted sender, each
    named user must also be someone the campus's own audience contains.
    """
    allowed = sender_campus_ids(user)
    if allowed is None:
        return
    if campus_id is None:
        raise DomainRuleViolation({"campus_id": CAMPUS_REQUIRED_MESSAGE})
    if campus_id not in allowed:
        raise NotFound()
    if audience_type == AudienceType.CUSTOM:
        named = {uuid.UUID(pk) for pk in audience_filter.get("user_ids") or []}
        on_campus = set(
            resolve_audience(
                audience_type=AudienceType.ALL,
                audience_filter=None,
                tenant_id=tenant_id,
                campus_id=campus_id,
            )
        )
        if not named <= on_campus:
            raise NotFound()
