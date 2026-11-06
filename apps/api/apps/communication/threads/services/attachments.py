"""Sign a download link for a file attached to a thread's message.

Thread attachments are module-gated (`apps/communication/uploads.py`): the
generic `/files` routes never list or sign them, so this is the only way to
fetch one. The caller's view resolves the thread first — `visible_threads` for a
participant, every alive thread for an overseer — and this checks the file
against that thread's messages.
"""

from __future__ import annotations

import uuid

from django.http import Http404

from apps.communication import uploads
from apps.communication.models import Message, MessageThread
from core.files.models import File, FileStatus
from core.files.services import get_download_url


def attachment_download_url(
    *, thread: MessageThread, file_id: uuid.UUID, include_internal_notes: bool
) -> str:
    """404 unless ``file_id`` is attached to a message in ``thread`` the caller can read.

    ``include_internal_notes`` is false for a guardian or student: a file that only
    an internal note carries is as hidden from them as the note itself. A file of
    another thread, another tenant or another purpose is the same 404 as no file.
    """
    messages = Message.objects.filter(thread=thread, attachments__contains=[str(file_id)])
    if not include_internal_notes:
        messages = messages.filter(is_internal_note=False)
    if not messages.exists():
        raise Http404("No such attachment.")

    file = (
        File.objects.alive()
        .filter(pk=file_id, purpose=uploads.THREAD_ATTACHMENT.key, status=FileStatus.READY)
        .first()
    )
    if file is None:
        raise Http404("No such attachment.")
    return get_download_url(file)
