"""`close_session` — active → closed (module doc §7.2).

Takes a row lock and runs inside an explicit transaction for the same reason
`activate_session` does: "exactly one current session per tenant" is a
partial unique index, and without the lock two simultaneous transitions
would race to an IntegrityError instead of an orderly 409.
"""

from __future__ import annotations

import uuid

from django.db import transaction

from apps.school_organization.models import AcademicSession, SessionStatus
from core.api.exceptions import Conflict


@transaction.atomic
def close_session(session: AcademicSession, *, actor_id: uuid.UUID) -> AcademicSession:
    """Close an active session, locking it against further transactional writes (§7.2)."""
    session = AcademicSession.objects.select_for_update().get(pk=session.pk)

    if session.status != SessionStatus.ACTIVE:
        raise Conflict(f"Only an active session can be closed; this one is {session.status}.")

    session.status = SessionStatus.CLOSED
    session.is_current = False
    session.updated_by = actor_id
    session.save(update_fields=["status", "is_current", "updated_by", "updated_at"])
    return session
