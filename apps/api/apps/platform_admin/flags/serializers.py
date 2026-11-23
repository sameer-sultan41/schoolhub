"""Request and response shapes of the feature-flag console (platform-admin.md §16)."""

from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from core.tenancy.features import registry
from core.tenancy.models import FeatureFlag, TenantFeatureOverride

UNREGISTERED = "This flag is no longer declared in code."
PAST_EXPIRY = "An override must expire in the future, or never."


class FeatureFlagSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeatureFlag
        fields = ["id", "key", "description", "default_enabled", "is_kill_switch", "updated_at"]
        read_only_fields = fields


class FeatureFlagUpdateSerializer(serializers.Serializer):
    """`PATCH`: the platform default and the kill switch only; the key and text are code."""

    default_enabled = serializers.BooleanField(required=False)
    is_kill_switch = serializers.BooleanField(required=False)


class TenantFeatureOverrideSerializer(serializers.ModelSerializer):
    flag = serializers.CharField(source="feature_flag.key", read_only=True)

    class Meta:
        model = TenantFeatureOverride
        fields = ["id", "flag", "enabled", "reason", "expires_at", "created_at", "created_by"]
        read_only_fields = fields


class TenantFeatureOverrideCreateSerializer(serializers.Serializer):
    flag = serializers.SlugRelatedField(slug_field="key", queryset=FeatureFlag.objects.all())
    enabled = serializers.BooleanField()
    reason = serializers.CharField(help_text="Why the school gets it: pilot, support, commercial.")
    expires_at = serializers.DateTimeField(
        required=False, allow_null=True, help_text="Null or absent: the override never lapses."
    )

    def validate_flag(self, flag: FeatureFlag) -> FeatureFlag:
        # A stale row (its key gone from code) is kept for its overrides, never given new ones.
        if flag.key not in {spec.key for spec in registry.all()}:
            raise serializers.ValidationError(UNREGISTERED)
        return flag

    def validate_expires_at(self, value):
        if value is not None and value <= timezone.now():
            raise serializers.ValidationError(PAST_EXPIRY)
        return value
