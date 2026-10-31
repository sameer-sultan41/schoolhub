"""Serializers for `/message-threads`."""

from __future__ import annotations

from rest_framework import serializers

from apps.communication.models import Message, MessageThread, ThreadType


class MessageThreadSerializer(serializers.ModelSerializer):
    """One inbox row. `unread_count` is the viewset's per-caller annotation."""

    student_id = serializers.UUIDField(read_only=True, allow_null=True)
    # Typed explicitly: the model column is a bare JSONField, which the contract
    # would otherwise publish as an untyped value.
    participant_user_ids = serializers.ListField(child=serializers.UUIDField(), read_only=True)
    unread_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = MessageThread
        fields = [
            "id",
            "subject",
            "thread_type",
            "student_id",
            "participant_user_ids",
            "assigned_to_id",
            "status",
            "last_message_at",
            "closed_at",
            "unread_count",
            "created_by",
            "created_at",
        ]
        read_only_fields = fields


class MessageThreadCreateSerializer(serializers.Serializer):
    """Shape only. Who may start which thread, with whom, is `services.create`'s rule.

    `student_id` and `participant_user_ids` are plain UUIDs, not related fields:
    a related field answers an unknown id with a 400 naming it, and whether a
    student or user exists outside the caller's reach must stay a 404.
    """

    subject = serializers.CharField(max_length=200)
    thread_type = serializers.ChoiceField(choices=ThreadType.choices)
    student_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    participant_user_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list
    )
    body = serializers.CharField()
    attachments = serializers.ListField(
        child=serializers.UUIDField(), required=False, allow_null=True, default=None
    )


class MessageSerializer(serializers.ModelSerializer):
    """One message in a thread, as its participants read it."""

    thread_id = serializers.UUIDField(read_only=True)
    # Typed explicitly, for the same reason as `participant_user_ids` above.
    attachments = serializers.ListField(
        child=serializers.UUIDField(), read_only=True, allow_null=True
    )
    read_by = serializers.DictField(
        child=serializers.CharField(),
        read_only=True,
        allow_null=True,
        help_text="User id -> ISO 8601 time that participant read the message.",
    )

    class Meta:
        model = Message
        fields = [
            "id",
            "thread_id",
            "sender_id",
            "body",
            "attachments",
            "is_internal_note",
            "read_by",
            "sent_at",
        ]
        read_only_fields = fields


class MessageCreateSerializer(serializers.Serializer):
    """Shape only. Who may post, and what, is `services.post_message`'s rule."""

    body = serializers.CharField()
    attachments = serializers.ListField(
        child=serializers.UUIDField(), required=False, allow_null=True, default=None
    )
    is_internal_note = serializers.BooleanField(required=False, default=False)


class MarkReadResultSerializer(serializers.Serializer):
    """`:mark-read`'s result — how many messages it stamped."""

    marked = serializers.IntegerField()


class ThreadRecipientSerializer(serializers.Serializer):
    """A staff member a caller can add to an internal or group thread."""

    user_id = serializers.UUIDField(source="pk")
    name = serializers.CharField(source="get_full_name")
    role = serializers.CharField(source="role_name", allow_null=True)


class ThreadRecipientListResponseSerializer(serializers.Serializer):
    """`GET /message-threads/recipients`'s real response shape — a capped, unpaginated list."""

    data = ThreadRecipientSerializer(many=True)
