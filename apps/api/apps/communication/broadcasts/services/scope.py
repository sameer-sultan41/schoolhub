"""`assert_sender_may_target` — a broadcast sender's record scope, applied to the audience.

`BroadcastViewSet` has no table to narrow, so `scope_queryset` never runs for it.
Without this check a campus-scoped holder of `communication.broadcast.send`
could broadcast to the whole school or to another campus. Only the roles that
grant `broadcast.send` count (`user_scopes_for_key`): `all` is unrestricted;
otherwise only the campuses of those roles' `campus` scopes are reachable. An
`own` or `assigned` scope has no campus, so it reaches nothing and fails closed
with a 404.
"""

from __future__ import annotations

import uuid

from rest_framework.exceptions import NotFound

from apps.communication.audience import resolve_audience
from apps.communication.models import AudienceType
from apps.communication.permissions import BROADCAST_SEND
from core.api.exceptions import DomainRuleViolation
from core.rbac.models import RecordScope
from core.rbac.permissions import user_scopes_for_key

CAMPUS_REQUIRED_MESSAGE = (
    "Your access is limited to particular campuses: choose one of them as campus_id."
)


def sender_campus_ids(user) -> frozenset[uuid.UUID] | None:
    """`None` when the sender is unrestricted, else the campuses they may broadcast to.

    Read from the roles that grant `communication.broadcast.send` only: a scope
    belongs to its role (auth-and-rbac.md §2.3), so an `all`-scoped role for some
    other module must not widen a campus-scoped right to broadcast.
    """
    scopes = user_scopes_for_key(user, BROADCAST_SEND)
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
    """404 if the sender's scope reaches no campus at all, or ``campus_id`` is not
    one of theirs; 422 if a campus-scoped sender names no campus.

    An `own`- or `assigned`-only sender has no campus to choose, so telling them
    to choose one would be a dead end: nothing is reachable, which is a 404.

    `campus_id` narrows every audience branch except `custom`, which is never
    narrowed by campus (`resolve_audience`). So for a restricted sender, each
    named user must also be someone the campus's own audience contains.
    """
    allowed = sender_campus_ids(user)
    if allowed is None:
        return
    if not allowed:
        raise NotFound()
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
