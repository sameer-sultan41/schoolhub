"""Stamp a thread's messages as read by one participant."""

from __future__ import annotations

from django.db import connection

from apps.communication.models import MessageThread
from core.rbac.permissions import is_restricted_principal


def mark_thread_read(*, thread: MessageThread, user) -> int:
    """Add ``user``'s read stamp to every message they neither sent nor have read yet.

    Returns how many messages it stamped; a second call stamps none.

    One raw statement, named after `fees_finance.ledger.reverse_transaction`'s:
    `Message` is append-only, so `AppendOnlyQuerySet.update()` refuses, and a
    `save(update_fields=["read_by"])` per message is a round trip each. This
    statement writes only `read_by` — the one column migration 0007 grants
    UPDATE on — and RLS still scopes it, since it runs on the request's
    tenant-bound connection; the `tenant_id` term is the application half of
    that, and leads the `(tenant_id, thread_id, sent_at)` index.

    A guardian or student never sees an internal note, so they never stamp one:
    that keeps the receipt honest and matches the inbox's `unread_count`.
    """
    user_key = str(user.pk)
    sql = (
        "UPDATE messages"
        " SET read_by = jsonb_set(COALESCE(read_by, '{}'::jsonb), ARRAY[%s::text],"
        " to_jsonb(now()))"
        " WHERE tenant_id = %s::uuid AND thread_id = %s::uuid AND sender_id <> %s::uuid"
        " AND NOT (COALESCE(read_by, '{}'::jsonb) ? %s)"
    )
    # All text: the path is built in SQL (`ARRAY[%s]`) so no param is a nested list.
    params: list[str] = [
        user_key,
        str(thread.tenant_id),
        str(thread.pk),
        user_key,
        user_key,
    ]
    if is_restricted_principal(user):
        sql += " AND is_internal_note = false"
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.rowcount
