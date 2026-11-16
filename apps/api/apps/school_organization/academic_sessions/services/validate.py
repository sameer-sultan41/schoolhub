"""Validation helpers for academic sessions.

`assert_no_session_overlap` and `session_completeness_errors` are consumed
only inside this package (`activate.py`, `clone.py`, and this package's own
`serializers.py`). `term_coverage_errors` is re-exported from
`apps.school_organization.services` for the onboarding checklist
(`apps/platform_admin/onboarding/services.py`), whose session step reuses the
activation check's term rule. `assert_session_writable` stays in the module
root because attendance, academics, student_management and timetable all
import it directly (see that file's docstring).
"""

from __future__ import annotations

import uuid
from datetime import date

from apps.school_organization.models import AcademicSession, Campus, Class
from core.api.exceptions import DomainRuleViolation


def assert_no_session_overlap(
    *, start_date: date, end_date: date, exclude_id: uuid.UUID | None = None
) -> None:
    """Sessions may not overlap: two live school years would make enrollment ambiguous."""
    if end_date <= start_date:
        raise DomainRuleViolation("end_date must be after start_date.")

    clashes = AcademicSession.objects.alive().filter(
        start_date__lte=end_date, end_date__gte=start_date
    )
    if exclude_id is not None:
        clashes = clashes.exclude(pk=exclude_id)
    clash = clashes.first()
    if clash is not None:
        raise DomainRuleViolation(
            f"Dates overlap academic session '{clash.name}' "
            f"({clash.start_date} – {clash.end_date})."
        )


def session_completeness_errors(session: AcademicSession) -> list[str]:
    """Everything that blocks activation, as one list — an operator fixes it in one pass.

    The checks are the activation gate from §7.1: somewhere to teach, something to
    teach, and a term calendar that actually covers the year.
    """
    errors: list[str] = []

    if not Campus.objects.alive().filter(is_active=True).exists():
        errors.append("At least one active campus is required.")

    sectioned_classes = (
        Class.objects.alive()
        .filter(is_active=True, sections__deleted_at__isnull=True, sections__is_active=True)
        .distinct()
    )
    if not sectioned_classes.exists():
        errors.append("At least one active class with an active section is required.")

    errors.extend(term_coverage_errors(session))
    return errors


def term_coverage_errors(session: AcademicSession) -> list[str]:
    """What stops ``session``'s terms covering it: no live term, or a gap at either end.

    The activation check's term rule on its own, so the onboarding wizard can tell
    whether a session's terms are done before any campus or class exists.
    """
    terms = list(session.terms.filter(deleted_at__isnull=True).order_by("start_date"))
    if not terms:
        return ["At least one term is required."]
    if terms[0].start_date > session.start_date or terms[-1].end_date < session.end_date:
        return ["Term dates must cover the whole session window."]
    return []
