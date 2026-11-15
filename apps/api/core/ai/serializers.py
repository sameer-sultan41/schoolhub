"""Request and response shapes for `/ai/usage` and `/ai/requests/{id}:feedback`."""

from __future__ import annotations

from rest_framework import serializers

from core.ai.models import FEEDBACK_VALUES, AIRequestFeedback


class AIFeatureUsageSerializer(serializers.Serializer):
    feature_key = serializers.CharField()
    tokens = serializers.IntegerField()
    requests = serializers.IntegerField()


class AIUsageSerializer(serializers.Serializer):
    month_tokens = serializers.IntegerField(help_text="Tokens used this month, tenant timezone.")
    monthly_limit = serializers.IntegerField()
    by_feature = AIFeatureUsageSerializer(many=True)


class AIFeedbackRequestSerializer(serializers.Serializer):
    value = serializers.ChoiceField(choices=FEEDBACK_VALUES)
    comment = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class AIFeedbackSerializer(serializers.ModelSerializer):
    ai_request_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = AIRequestFeedback
        fields = ["id", "ai_request_id", "value", "comment", "created_at"]
        read_only_fields = fields
