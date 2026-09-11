"""Shape validation for the delivery-log dashboard."""

from __future__ import annotations

from rest_framework import serializers

from core.notifications.models import DeliveryLog


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
    """One grouped count from `services.report.delivery_report`."""

    group = serializers.CharField()
    count = serializers.IntegerField()


class DeliveryReportResponseSerializer(serializers.Serializer):
    """`GET /delivery-logs:summary`'s real response shape — see `viewset.py`'s `summary`."""

    data = DeliveryReportRowSerializer(many=True)
