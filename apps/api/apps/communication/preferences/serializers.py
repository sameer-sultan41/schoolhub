"""`NotificationPreferenceRowSerializer`/`NotificationPreferenceUpdateSerializer`."""

from __future__ import annotations

from rest_framework import serializers

from apps.communication.models import NotificationPreference
from apps.communication.preferences.services.save import assert_preference_may_be_saved


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
