"""Request and response shapes of the impersonation routes (§16)."""

from __future__ import annotations

from rest_framework import serializers

from core.rbac.models import User


class ImpersonateRequestSerializer(serializers.Serializer):
    user_id = serializers.UUIDField()
    reason = serializers.CharField(
        max_length=1000,
        help_text="Why. Kept in the audit log, and shown to the school's owners in their notice.",
    )
    duration_minutes = serializers.IntegerField(
        help_text="1 to PLATFORM_IMPERSONATION_MAX_MINUTES; outside it, a 422."
    )


class ImpersonationGrantStartedSerializer(serializers.Serializer):
    """Schema only: the grant, and the link that opens the school's dashboard as the user."""

    grant_id = serializers.UUIDField()
    expires_at = serializers.DateTimeField()
    handoff_url = serializers.CharField(
        help_text="Single use, within PLATFORM_HANDOFF_CODE_TTL_SECONDS; the code is its fragment."
    )


class ImpersonationExchangeSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=200)


class ImpersonationExchangeResponseSerializer(serializers.Serializer):
    """Schema only: an access token with no refresh token, valid until the grant expires."""

    access = serializers.CharField()
    expires_in = serializers.IntegerField()


class PlatformTenantUserSerializer(serializers.ModelSerializer):
    """A school user the console may impersonate: who, and their roles' slugs."""

    name = serializers.CharField(source="get_full_name", read_only=True)
    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "name", "email", "roles")
        read_only_fields = fields

    def get_roles(self, obj) -> list[str]:
        # Prefetched by the viewset: live assignments of live roles.
        return sorted(assignment.role.slug for assignment in obj.live_roles)
