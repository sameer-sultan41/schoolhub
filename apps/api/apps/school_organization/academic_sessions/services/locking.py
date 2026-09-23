"""Row-lock acquisition shared by `activate.py` and `close.py`.

"Exactly one current session per tenant" is a partial unique index — without
the lock two simultaneous lifecycle transitions would race to an
IntegrityError instead of an orderly 409.
"""

from __future__ import annotations

from apps.school_organization.models import AcademicSession


def locked_session(session: AcademicSession) -> AcademicSession:
    """Re-fetch ``session`` under a row lock for a lifecycle transition."""
    return AcademicSession.objects.select_for_update().get(pk=session.pk)
