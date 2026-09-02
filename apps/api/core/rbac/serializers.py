"""Authentication and identity serializers."""

from __future__ import annotations

from django.contrib.auth import authenticate
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from core.rbac.backends import AmbiguousPrincipal
from core.rbac.models import User
from core.rbac.permissions import effective_permission_keys


class LoginSerializer(TokenObtainPairSerializer):
    """Email/username + password login.

    Deliberately returns the same generic error for unknown accounts and wrong
    passwords so the endpoint cannot be used to enumerate who has an account at
    a school.
    """

    username_field = "identifier"

    identifier = serializers.CharField(write_only=True)
    password = serializers.CharField(write_only=True, style={"input_type": "password"})
    school = serializers.SlugField(
        write_only=True,
        required=False,
        help_text="Tenant slug. Required only when the identifier exists at more than one school.",
    )

    default_error_messages = {
        "invalid_credentials": _("Incorrect credentials."),
        "inactive": _("This account is not active."),
        "school_required": _("Specify which school to sign in to."),
    }

    def validate(self, attrs):
        request = self.context.get("request")
        identifier = attrs.get("identifier", "").strip()
        password = attrs.get("password", "")

        try:
            user = authenticate(
                request=request,
                username=identifier,
                password=password,
                tenant_slug=attrs.get("school"),
            )
        except AmbiguousPrincipal:
            # The password already matched, so naming the ambiguity leaks nothing
            # and is the only way the client can complete the sign-in.
            self.fail("school_required")

        if user is None:
            self.fail("invalid_credentials")
        if not user.is_active or user.deleted_at is not None:
            self.fail("inactive")

        refresh = self.get_token(user)
        return {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": UserSerializer(user).data,
        }

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        # Claims the clients need on every request; permissions stay server-side.
        token["tenant_id"] = str(user.tenant_id) if user.tenant_id else None
        token["is_platform"] = user.is_platform
        return token


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="get_full_name", read_only=True)
    permissions = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "username",
            "first_name",
            "last_name",
            "full_name",
            "phone",
            "tenant",
            "is_platform",
            "mfa_enabled",
            "permissions",
            "roles",
        )
        read_only_fields = fields

    def get_permissions(self, obj) -> list[str]:
        return sorted(effective_permission_keys(obj))

    def get_roles(self, obj) -> list[str]:
        return list(
            obj.user_roles.filter(deleted_at__isnull=True).values_list("role__slug", flat=True)
        )


class RefreshResponseSerializer(serializers.Serializer):
    """Documents ``RefreshView``'s actual response body for the OpenAPI schema.

    Read-only and never instantiated to validate input — ``RefreshView`` builds this
    shape itself from a rotated token, this exists purely so ``@extend_schema`` can
    describe the real response instead of claiming an empty body.
    """

    access_token = serializers.CharField()
    expires_in = serializers.IntegerField()


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=10)

    def validate_current_password(self, value: str) -> str:
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value: str) -> str:
        from django.contrib.auth.password_validation import validate_password

        validate_password(value, self.context["request"].user)
        return value

    def save(self, **kwargs) -> User:
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password", "updated_at"])
        return user
