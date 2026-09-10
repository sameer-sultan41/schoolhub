"""Service logic exclusive to the campuses resource.

Shared, cross-package or cross-app logic (the deletion guard, staff-id
resolution, timezone validation) stays in the module root's
`apps.school_organization.services` — see that file's docstring for why.
"""

from __future__ import annotations

import uuid

from apps.school_organization.models import Campus


def clear_primary_campus(*, keep_id: uuid.UUID | None, actor_id: uuid.UUID) -> None:
    """Demote the incumbent primary campus so a new one can take the flag.

    Promoting a new primary is the operator's stated intent, so we demote rather
    than reject. Must run *before* the promotion is written: the partial unique
    index is checked per statement, so writing two primaries and fixing it up
    afterwards would raise instead of succeeding.
    """
    demoted = Campus.objects.filter(is_primary=True)
    if keep_id is not None:
        demoted = demoted.exclude(pk=keep_id)
    demoted.update(is_primary=False, updated_by=actor_id)
