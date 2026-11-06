from __future__ import annotations

from rest_framework import serializers

from core.notifications.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = (
            "id",
            "event_key",
            "category",
            "title",
            "body",
            "data",
            "source_type",
            "source_id",
            "priority",
            "read_at",
            "created_at",
        )
        read_only_fields = fields


class UnreadCountSerializer(serializers.Serializer):
    unread = serializers.IntegerField()


class NotificationMarkReadResultSerializer(serializers.Serializer):
    read_at = serializers.DateTimeField()


class MarkAllReadRequestSerializer(serializers.Serializer):
    before = serializers.DateTimeField(
        required=False,
        help_text="Only rows created at or before this moment are marked. Defaults to now.",
    )


class MarkAllReadResultSerializer(serializers.Serializer):
    marked = serializers.IntegerField()
