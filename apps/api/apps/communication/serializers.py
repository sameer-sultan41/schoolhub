"""Shape validation for the communication module. `validate_*` delegates to `services.assert_*`."""

from __future__ import annotations

from rest_framework import serializers

from apps.communication.models import NotificationPreference
from apps.communication.services import assert_preference_may_be_saved
from core.notifications.models import DeliveryLog


class NotificationPreferenceRowSerializer(serializers.Serializer):
    """One cell of the materialized category x channel matrix."""

    event_category = serializers.CharField()
    channel = serializers.CharField()
    is_enabled = serializers.BooleanField()


class NotificationPreferenceUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = ["event_category", "channel", "is_enabled"]

    def validate(self, attrs: dict) -> dict:
        assert_preference_may_be_saved(
            event_category=attrs["event_category"], is_enabled=attrs["is_enabled"]
        )
        return attrs


class DeliveryLogSerializer(serializers.ModelSerializer):
    """Read-only. `DeliveryLog` rows are written only by `core.notifications`."""

    class Meta:
        model = DeliveryLog
        fields = [
            "id",
            "notification",
            "channel",
            "template_code",
            "subject",
            "body",
            "provider",
            "provider_message_id",
            "recipient_address",
            "status",
            "attempts",
            "error_message",
            "last_attempt_at",
            "delivered_at",
            "created_at",
        ]
        read_only_fields = fields


class DeliveryReportRowSerializer(serializers.Serializer):
    """One grouped count from `reports.delivery_report`."""

    group = serializers.CharField()
    count = serializers.IntegerField()


class DeliveryReportResponseSerializer(serializers.Serializer):
    """`GET /delivery-logs:summary`'s real response shape — see views.py's `summary`."""

    data = DeliveryReportRowSerializer(many=True)
