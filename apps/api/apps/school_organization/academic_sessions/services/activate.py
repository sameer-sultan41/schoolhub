"""`activate_session` — draft/planned → active (module doc §7.1).

Takes a row lock and runs inside an explicit transaction because "exactly one
current session per tenant" is a partial unique index — without the lock two
simultaneous activations would race to an IntegrityError instead of an
orderly 409.
"""

from __future__ import annotations

import uuid

from django.db import transaction

from apps.school_organization.academic_sessions.services.locking import locked_session
from apps.school_organization.academic_sessions.services.validate import (
    session_completeness_errors,
)
from apps.school_organization.models import AcademicSession, SessionStatus
from apps.school_organization.services import LOCKED_SESSION_STATES
from core.api.exceptions import Conflict, DomainRuleViolation


@transaction.atomic
def activate_session(session: AcademicSession, *, actor_id: uuid.UUID) -> AcademicSession:
    """Make ``session`` the tenant's current session after the §7.1 completeness check."""
    session = locked_session(session)

    if session.status in LOCKED_SESSION_STATES:
        raise Conflict(f"A {session.status} session cannot be activated.")
    if session.status == SessionStatus.ACTIVE and session.is_current:
        raise Conflict(f"Session '{session.name}' is already active.")

    errors = session_completeness_errors(session)
    if errors:
        raise DomainRuleViolation({"structure": errors})

    # Demote the incumbent first: the partial unique index allows only one current row.
    AcademicSession.objects.filter(is_current=True).exclude(pk=session.pk).update(
        is_current=False, updated_by=actor_id
    )

    session.status = SessionStatus.ACTIVE
    session.is_current = True
    session.updated_by = actor_id
    session.save(update_fields=["status", "is_current", "updated_by", "updated_at"])
    return session
