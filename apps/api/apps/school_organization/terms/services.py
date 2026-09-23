"""Service logic exclusive to the terms resource.

`assert_session_writable` (the session-lock check a term's own writes must
also respect) is imported from the module root's `apps.school_organization.
services` rather than duplicated — see that file's docstring for why it
stays there.
"""

from __future__ import annotations

import uuid
from datetime import date

from apps.school_organization.models import AcademicSession, Term
from core.api.exceptions import DomainRuleViolation


def assert_term_window(
    *,
    session: AcademicSession,
    start_date: date,
    end_date: date,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Terms must nest inside their session and not overlap their siblings (§11)."""
    if end_date <= start_date:
        raise DomainRuleViolation("end_date must be after start_date.")
    if start_date < session.start_date or end_date > session.end_date:
        raise DomainRuleViolation(
            f"Term dates must fall inside the session window "
            f"({session.start_date} – {session.end_date})."
        )

    siblings = Term.objects.alive().filter(
        academic_session=session, start_date__lte=end_date, end_date__gte=start_date
    )
    if exclude_id is not None:
        siblings = siblings.exclude(pk=exclude_id)
    sibling = siblings.first()
    if sibling is not None:
        raise DomainRuleViolation(f"Term dates overlap term '{sibling.name}'.")
