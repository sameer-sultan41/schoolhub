"""Append one message to a thread — the core every post goes through.

`create_thread` posts a thread's first message here, so the participant and
closed-thread rules hold for that message too.
"""

from __future__ import annotations

from django.db import transaction
from django.http import Http404
from django.utils import timezone

from apps.communication.models import Message, MessageThread, ThreadStatus
from apps.communication.threads.services.locking import locked_thread
from core.api.exceptions import Conflict


def post_message(
    *,
    thread: MessageThread,
    sender,
    body: str,
    attachments: list | None,
    is_internal_note: bool,
) -> Message:
    """A non-participant gets 404, not 403 — the thread's existence is not theirs to learn."""
    with transaction.atomic():
        locked = locked_thread(thread)
        if not locked.is_participant(sender.pk):
            raise Http404("No such thread.")
        if locked.status == ThreadStatus.CLOSED:
            raise Conflict("Reopen the thread to reply.")

        message = Message.objects.create(
            tenant_id=locked.tenant_id,
            thread=locked,
            sender_id=sender.pk,
            body=body,
            attachments=attachments,
            is_internal_note=is_internal_note,
            sent_at=timezone.now(),
            created_by=sender.pk,
        )
        locked.last_message_at = message.sent_at
        locked.updated_by = sender.pk
        locked.save(update_fields=["last_message_at", "updated_by", "updated_at"])

    thread.last_message_at = locked.last_message_at
    return message
