"""Row-lock acquisition shared by every notice lifecycle transition."""

from __future__ import annotations

from apps.communication.models import Notice


def locked_notice(notice: Notice) -> Notice:
    """Re-fetch ``notice`` under a row lock for a status transition."""
    return Notice.objects.select_for_update().get(pk=notice.pk)
