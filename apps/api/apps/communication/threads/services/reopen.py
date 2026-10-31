"""closed -> open."""

from __future__ import annotations

from apps.communication.models import MessageThread, ThreadStatus
from apps.communication.threads.services.close import assert_may_change_status
from apps.communication.threads.services.locking import locked_thread
from core.api.exceptions import Conflict


def reopen_thread(*, thread: MessageThread, actor) -> MessageThread:
    locked = locked_thread(thread)
    assert_may_change_status(locked, actor=actor)
    if locked.status == ThreadStatus.OPEN:
        raise Conflict("This thread is already open.")
    locked.status = ThreadStatus.OPEN
    locked.closed_at = None
    locked.updated_by = actor.pk
    locked.save(update_fields=["status", "closed_at", "updated_by", "updated_at"])
    return locked
