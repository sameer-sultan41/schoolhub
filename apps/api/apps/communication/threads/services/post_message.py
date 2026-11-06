"""Append one message to a thread — the core every post goes through.

`create_thread` posts a thread's first message here, so the participant,
closed-thread, internal-note and attachment rules — and the reply
notification — hold for that message too.
"""

from __future__ import annotations

import uuid

from django.db import transaction
from django.http import Http404
from django.utils import timezone
from django.utils.text import Truncator

from apps.communication import uploads
from apps.communication.models import Message, MessageThread, ThreadStatus
from apps.communication.notifications import THREAD_REPLY
from apps.communication.threads.routing import thread_staff_users
from apps.communication.threads.services.access import (
    assert_thread_participant,
    owns_thread_student,
)
from apps.communication.threads.services.locking import locked_thread
from core.api.exceptions import Conflict, DomainRuleViolation
from core.files.models import File
from core.files.services import assert_file_usable
from core.notifications.services import Recipient, notify
from core.rbac.permissions import is_restricted_principal, live_restricted_role_assignments

# How much of the body a push or inbox row shows; the thread holds the rest.
MESSAGE_PREVIEW_LENGTH = 140

THREAD_SOURCE_TYPE = "message_thread"


def post_message(
    *,
    thread: MessageThread,
    sender,
    body: str,
    attachments: list | None,
    is_internal_note: bool,
) -> Message:
    """A non-participant gets 404, not 403 — the thread's existence is not theirs to learn.

    A guardian or student must also still own the thread's student, the same
    narrowing the inbox applies: a revoked guardian cannot post into a thread
    they can no longer open.
    """
    restricted = is_restricted_principal(sender)
    if restricted and is_internal_note:
        raise DomainRuleViolation(
            {"is_internal_note": "Guardians and students cannot post internal notes."}
        )
    _assert_attachments_usable(attachments, uploaded_by=sender.pk if restricted else None)

    with transaction.atomic():
        locked = locked_thread(thread)
        assert_thread_participant(locked, sender, restricted=restricted)
        if locked.status == ThreadStatus.CLOSED:
            raise Conflict("Reopen the thread to reply.")

        message = Message.objects.create(
            tenant_id=locked.tenant_id,
            thread=locked,
            sender_id=sender.pk,
            body=body,
            attachments=attachments or None,
            is_internal_note=is_internal_note,
            sent_at=timezone.now(),
            created_by=sender.pk,
        )
        # An internal note leaves the thread's activity time alone: a guardian
        # reads `last_message_at` in their inbox, and a jump with no new message
        # they can see would tell them staff wrote something about them.
        if not is_internal_note:
            locked.last_message_at = message.sent_at
            locked.updated_by = sender.pk
            locked.save(update_fields=["last_message_at", "updated_by", "updated_at"])

        _notify_participants(thread=locked, message=message, sender=sender)

    thread.last_message_at = locked.last_message_at
    return message


def _assert_attachments_usable(attachments: list | None, *, uploaded_by) -> None:
    """Every id names a ready thread-attachment upload of this tenant.

    An id the tenant-scoped manager cannot see is a 404, like any other miss:
    whether that file exists in another school is not the caller's to learn.
    ``uploaded_by`` is the sender when a guardian or student, who may attach only
    their own uploads.
    """
    if not attachments:
        return
    wanted = set(map(str, attachments))
    files = list(File.objects.alive().filter(pk__in=wanted))
    if {str(file.pk) for file in files} != wanted:
        raise Http404("No such file.")
    for file in files:
        assert_file_usable(
            file=file,
            purpose=uploads.THREAD_ATTACHMENT.key,
            uploaded_by=uploaded_by,
            field="attachments",
        )


def _notify_participants(*, thread: MessageThread, message: Message, sender) -> None:
    """One `THREAD_REPLY` fan-out to everyone who can read the new message.

    An allowlist, since a notification carries the preview and must not reach
    anyone the message list would refuse:

    - staff: participants in `thread_staff_users` (a live staff role and no live
      restricted one), who see every message, internal notes included;
    - guardians and students: participants holding a live restricted role who
      still own the thread's child, and only for a message that is not an
      internal note.

    Anyone else, such as a participant whose only role was removed, is skipped.
    The ownership loop is bounded by one thread's restricted participants (a
    child's guardians), and reuses `Student.filter_owned_by_user` so "owns" keeps
    one definition.
    """
    from core.rbac.models import User

    others = [uid for uid in thread.participant_user_ids if uid != str(sender.pk)]
    staff = thread_staff_users(tenant_id=thread.tenant_id).filter(pk__in=others)
    allowed = {str(pk) for pk in staff.values_list("pk", flat=True)}
    if not message.is_internal_note:
        restricted_users = User.objects.filter(pk__in=others).filter(
            pk__in=live_restricted_role_assignments().values("user_id")
        )
        allowed |= {str(user.pk) for user in restricted_users if owns_thread_student(thread, user)}
    # The JSON column holds strings; `notify` keys addresses by `uuid.UUID`.
    recipients = [Recipient(user_id=uuid.UUID(uid)) for uid in others if uid in allowed]
    if not recipients:
        return

    notify(
        THREAD_REPLY,
        tenant_id=thread.tenant_id,
        recipients=recipients,
        context={
            "thread.subject": thread.subject,
            "message.sender_name": sender.get_full_name(),
            "message.preview": Truncator(message.body).chars(MESSAGE_PREVIEW_LENGTH),
        },
        source_type=THREAD_SOURCE_TYPE,
        source_id=thread.pk,
    )
