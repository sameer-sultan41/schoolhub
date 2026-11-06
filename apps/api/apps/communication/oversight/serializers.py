"""Serializers for `/message-thread-oversight`."""

from __future__ import annotations

from apps.communication.threads.serializers import ThreadBaseSerializer


class ThreadOversightSerializer(ThreadBaseSerializer):
    """A thread as an overseer reads it: the inbox row minus `unread_count`.

    An overseer is never a participant, so there is no per-caller unread state.
    Messages reuse `MessageSerializer` — the same fields, internal notes included.
    """
