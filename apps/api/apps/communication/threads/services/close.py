"""open -> closed."""

from __future__ import annotations

from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from apps.communication.models import MessageThread, ThreadStatus
from apps.communication.threads.services.locking import locked_thread
from core.api.exceptions import Conflict
from core.rbac.permissions import is_restricted_principal


def assert_may_change_status(thread: MessageThread, *, actor) -> None:
    """Only a staff participant opens or closes a thread.

    Checked here as well as by `communication.thread.close` (which no guardian or
    student role holds), so a custom role granting that key cannot hand a
    guardian the power to close a conversation on the school.
    """
    if not thread.is_participant(actor.pk):
        raise Http404("No such thread.")
    if is_restricted_principal(actor):
        raise PermissionDenied("Only staff can close or reopen a thread.")


def close_thread(*, thread: MessageThread, actor) -> MessageThread:
    locked = locked_thread(thread)
    assert_may_change_status(locked, actor=actor)
    if locked.status == ThreadStatus.CLOSED:
        raise Conflict("This thread is already closed.")
    locked.status = ThreadStatus.CLOSED
    locked.closed_at = timezone.now()
    locked.updated_by = actor.pk
    locked.save(update_fields=["status", "closed_at", "updated_by", "updated_at"])
    return locked
