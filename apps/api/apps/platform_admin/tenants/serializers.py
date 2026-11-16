"""Request and response shapes of `/platform/tenants` (platform-admin.md §16)."""

from __future__ import annotations

from rest_framework import serializers

from core.tenancy.models import Tenant


class TenantSerializer(serializers.ModelSerializer):
    """A school as the console shows it: identity, contact and lifecycle columns."""

    class Meta:
        model = Tenant
        fields = [
            "id",
            "name",
            "slug",
            "status",
            "contact_name",
            "contact_email",
            "contact_phone",
            "timezone",
            "locale",
            "currency",
            "trial_ends_at",
            "provisioned_at",
            "suspended_at",
            "deprovision_after",
            "current_plan",
            "subscription_status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class TenantCreateSerializer(serializers.Serializer):
    """The slug's rules (format, reserved, unique) are the service's, `services.slug_errors`."""

    name = serializers.CharField(max_length=200)
    slug = serializers.CharField(
        max_length=63, help_text="The subdomain label. Fixed once the school is provisioned."
    )
    contact_name = serializers.CharField(max_length=200)
    contact_email = serializers.EmailField(
        max_length=254, help_text="Where `:provision` invites the school's owner."
    )
    contact_phone = serializers.CharField(max_length=30, required=False, allow_blank=True)


class TenantUpdateSerializer(serializers.Serializer):
    """`PATCH`: any subset. The service refuses a slug change after `:provision`."""

    name = serializers.CharField(max_length=200, required=False)
    slug = serializers.CharField(max_length=63, required=False)
    contact_name = serializers.CharField(max_length=200, required=False)
    contact_email = serializers.EmailField(max_length=254, required=False)
    contact_phone = serializers.CharField(max_length=30, required=False, allow_blank=True)


class ProvisionSerializer(serializers.Serializer):
    plan_code = serializers.CharField(
        required=False,
        allow_null=True,
        default=None,
        help_text="Refused (422) until plans exist; provision without one.",
    )


class ReasonSerializer(serializers.Serializer):
    """`:suspend` and `:restore`: a reason is required (§11), and audited."""

    reason = serializers.CharField(max_length=500)


class DeleteSerializer(ReasonSerializer):
    waive_export = serializers.BooleanField(
        default=False,
        help_text="Delete a school that went live without a succeeded export of its data.",
    )


class ReinstateSerializer(serializers.Serializer):
    trial_ends_at = serializers.DateTimeField(
        required=False,
        allow_null=True,
        default=None,
        help_text="Required to reinstate on a trial: when there is no live subscription, or "
        "it is trialing. Must be in the future.",
    )
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
