"""Authentication and identity serializers."""

from __future__ import annotations

from collections.abc import Sequence

from django.contrib.auth import authenticate
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from core.rbac import mfa
from core.rbac.backends import AmbiguousPrincipal
from core.rbac.models import User
from core.rbac.permissions import (
    FIRST_FACTOR_AMR,
    effective_permission_keys,
    is_restricted_principal,
)
from core.tenancy.access import operational_tenant
from core.tenancy.models import Tenant


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
        if user.tenant_id is not None:
            # The rule every entry point applies (core.tenancy.access); refresh applies it
            # through simplejwt's USER_AUTHENTICATION_RULE. LoginView answers every refusal
            # with the same 401, so a suspended school is not told apart from a bad password.
            _, refusal = operational_tenant(user.tenant_id)
            if refusal is not None:
                self.fail("inactive")

        if user.mfa_enabled:
            # The `second_factor` step (auth-and-rbac §1): no token until /auth/mfa:verify.
            return {"mfa_required": True, "mfa_token": mfa.issue_challenge(user)}

        refresh = issue_token_pair(user, amr=[FIRST_FACTOR_AMR])
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


def issue_token_pair(user: User, *, amr: Sequence[str]) -> RefreshToken:
    """The refresh token of a new sign-in; ``.access_token`` derives the access token.

    ``amr`` (RFC 8176) names the factors the user passed: ``["pwd"]`` after the password,
    ``["pwd", "otp"]`` after the second factor. SimpleJWT copies every claim of the refresh
    token into each access token it derives, on refresh and rotation too, so the claim lasts
    the whole session. The platform console requires ``"otp"`` (``IsPlatformPrincipal``).
    """
    refresh = LoginSerializer.get_token(user)
    refresh["amr"] = list(amr)
    return refresh


class TenantSummarySerializer(serializers.ModelSerializer):
    """The caller's school, as a client shows it: its name and subdomain label."""

    class Meta:
        model = Tenant
        fields = ("name", "slug")
        read_only_fields = fields


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="get_full_name", read_only=True)
    permissions = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()
    is_restricted_principal = serializers.SerializerMethodField()
    # Beside `tenant` (the UUID), never in place of it: clients already read that field.
    # Null for a platform user, who belongs to no school.
    tenant_summary = TenantSummarySerializer(source="tenant", read_only=True, allow_null=True)

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
            "tenant_summary",
            "is_platform",
            "mfa_enabled",
            "permissions",
            "roles",
            "is_restricted_principal",
        )
        read_only_fields = fields

    def get_permissions(self, obj) -> list[str]:
        return sorted(effective_permission_keys(obj))

    def get_is_restricted_principal(self, obj) -> bool:
        """A student or guardian, so a client routes them to the portal rather than guessing."""
        return is_restricted_principal(obj)

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


class SignedInResponseSerializer(RefreshResponseSerializer):
    """A completed sign-in (login without MFA, or ``/auth/mfa:verify``); schema only."""

    user = UserSerializer()


class MfaChallengeResponseSerializer(serializers.Serializer):
    """Login's answer for a user with MFA on: no token yet, a challenge to verify; schema only."""

    mfa_required = serializers.BooleanField()
    mfa_token = serializers.CharField(
        help_text="Signed and short-lived; send it to /auth/mfa:verify with a code."
    )


# A six-digit TOTP code (RFC 6238 with pyotp's defaults).
_TOTP_CODE = r"^\d{6}$"


class MfaVerifySerializer(serializers.Serializer):
    mfa_token = serializers.CharField()
    code = serializers.RegexField(_TOTP_CODE, required=False)
    recovery_code = serializers.CharField(required=False, max_length=64)

    def validate(self, attrs: dict) -> dict:
        if ("code" in attrs) == ("recovery_code" in attrs):
            raise serializers.ValidationError("Send either code or recovery_code.")
        return attrs


class MfaEnrollResponseSerializer(serializers.Serializer):
    """Schema only: the new secret, shown once, and the URI an authenticator app scans."""

    secret = serializers.CharField()
    otpauth_uri = serializers.CharField()


class MfaConfirmSerializer(serializers.Serializer):
    code = serializers.RegexField(_TOTP_CODE)


class MfaConfirmResponseSerializer(SignedInResponseSerializer):
    """Schema only: MFA is on; the recovery codes are shown this once."""

    recovery_codes = serializers.ListField(child=serializers.CharField())


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
