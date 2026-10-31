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
from apps.communication.threads.services.locking import locked_thread
from apps.student_management.models import Student
from core.api.exceptions import Conflict, DomainRuleViolation
from core.files.models import File
from core.files.services import assert_file_usable
from core.notifications.services import Recipient, notify
from core.rbac.permissions import is_restricted_principal

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
    _assert_attachments_usable(attachments)

    with transaction.atomic():
        locked = locked_thread(thread)
        if not locked.is_participant(sender.pk) or (
            restricted and not _owns_thread_student(locked, sender)
        ):
            raise Http404("No such thread.")
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
        locked.last_message_at = message.sent_at
        locked.updated_by = sender.pk
        locked.save(update_fields=["last_message_at", "updated_by", "updated_at"])

        _notify_participants(thread=locked, message=message, sender=sender)

    thread.last_message_at = locked.last_message_at
    return message


def _assert_attachments_usable(attachments: list | None) -> None:
    """Every id names a ready thread-attachment upload of this tenant.

    An id the tenant-scoped manager cannot see is a 404, like any other miss:
    whether that file exists in another school is not the caller's to learn.
    """
    if not attachments:
        return
    wanted = set(map(str, attachments))
    files = list(File.objects.alive().filter(pk__in=wanted))
    if {str(file.pk) for file in files} != wanted:
        raise Http404("No such file.")
    for file in files:
        assert_file_usable(file=file, purpose=uploads.THREAD_ATTACHMENT.key)


def _owns_thread_student(thread: MessageThread, user) -> bool:
    """Whether a guardian or student still owns the child the thread is about."""
    if thread.student_id is None:
        return False
    owned = Student.filter_owned_by_user(Student.objects.alive(), user)
    return owned.filter(pk=thread.student_id).exists()


def _notify_participants(*, thread: MessageThread, message: Message, sender) -> None:
    """One `THREAD_REPLY` fan-out to everyone who can read the new message.

    Guardians and students are left out of an internal note, which they never
    see, and out of a thread about a child they no longer own, which they can no
    longer open — a notification carries the preview, so it must not reach
    anyone the message list would refuse. The ownership loop is bounded by one
    thread's restricted participants (a child's guardians), and reuses
    `Student.filter_owned_by_user` so "owns" keeps one definition.
    """
    from core.rbac.models import User

    others = [uid for uid in thread.participant_user_ids if uid != str(sender.pk)]
    restricted_users = list(
        User.objects.filter(
            pk__in=others, user_roles__role__is_restricted_principal=True
        ).distinct()
    )
    excluded = {
        str(user.pk)
        for user in restricted_users
        if message.is_internal_note or not _owns_thread_student(thread, user)
    }
    # The JSON column holds strings; `notify` keys addresses by `uuid.UUID`.
    recipients = [Recipient(user_id=uuid.UUID(uid)) for uid in others if uid not in excluded]
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
