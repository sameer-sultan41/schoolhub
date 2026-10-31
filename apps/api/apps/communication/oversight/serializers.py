"""Serializers for `/message-thread-oversight`."""

from __future__ import annotations

from apps.communication.threads.serializers import MessageThreadSerializer


class ThreadOversightSerializer(MessageThreadSerializer):
    """A thread as an overseer reads it.

    The inbox row minus `unread_count`: an overseer is never a participant, so
    there is no per-caller unread state to report. Messages reuse
    `MessageSerializer` — an overseer sees the same fields, internal notes
    included.
    """

    class Meta(MessageThreadSerializer.Meta):
        fields = [name for name in MessageThreadSerializer.Meta.fields if name != "unread_count"]
        read_only_fields = fields

    unread_count = None  # type: ignore[assignment]
