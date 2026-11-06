"""Row-lock acquisition shared by every thread state change."""

from __future__ import annotations

from apps.communication.models import MessageThread


def locked_thread(thread: MessageThread) -> MessageThread:
    """Re-fetch ``thread`` under a row lock, so a reply and a close cannot interleave."""
    return MessageThread.objects.select_for_update().get(pk=thread.pk)
