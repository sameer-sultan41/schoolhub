"""Request and response shapes of a school's subscription (platform-admin.md §16).

The console's `tenants/{id}/subscription` and the school's own `/subscription` answer the
same `SubscriptionStateSerializer`: the school's status and trial end, its live subscription
(or null) and its effective limits.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.platform_admin.models import Plan, Subscription
from apps.platform_admin.plans.serializers import LimitsField
from core.tenancy.models import TenantStatus


def _limits(**kwargs) -> serializers.DictField:
    return serializers.DictField(child=serializers.IntegerField(allow_null=True), **kwargs)


class PlanSummarySerializer(serializers.ModelSerializer):
    """The plan a subscription is on: what it costs and which modules it enables."""

    enabled_modules = serializers.ListField(child=serializers.CharField(), read_only=True)

    class Meta:
        model = Plan
        fields = [
            "id",
            "code",
            "name",
            "price_amount",
            "currency",
            "billing_period",
            "enabled_modules",
        ]
        read_only_fields = fields


class SubscriptionSerializer(serializers.ModelSerializer):
    plan = PlanSummarySerializer(read_only=True)
    limits_override = _limits(allow_null=True, read_only=True)

    class Meta:
        model = Subscription
        fields = [
            "id",
            "plan",
            "status",
            "current_period_start",
            "current_period_end",
            "canceled_at",
            "billing_provider",
            "billing_provider_ref",
            "limits_override",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class SubscriptionStateSerializer(serializers.Serializer):
    """A school's billing state: its lifecycle, its live subscription and its limits."""

    tenant_status = serializers.ChoiceField(choices=TenantStatus.choices, read_only=True)
    trial_ends_at = serializers.DateTimeField(allow_null=True, read_only=True)
    subscription = SubscriptionSerializer(
        allow_null=True, read_only=True, help_text="The live subscription; null without one."
    )
    limits = _limits(
        read_only=True,
        help_text="Every quota metric: the plan's limit, or the negotiated override; "
        "null is unlimited.",
    )


class SubscriptionUpdateSerializer(serializers.Serializer):
    """`PATCH`: any subset. The billing reference is mirrored on the tenant, unique when set."""

    billing_provider = serializers.CharField(max_length=30, required=False, allow_blank=True)
    billing_provider_ref = serializers.CharField(max_length=120, required=False, allow_blank=True)
    limits_override = LimitsField(required=False, allow_null=True)


class SubscriptionActivateSerializer(serializers.Serializer):
    plan_code = serializers.CharField(
        max_length=50,
        required=False,
        allow_null=True,
        default=None,
        help_text="Required when the school has no live subscription (a paid sign-up); "
        "refused when it has one (use `:change-plan`).",
    )
    current_period_start = serializers.DateTimeField()
    current_period_end = serializers.DateTimeField(help_text="After the start.")


class SubscriptionPaymentSerializer(serializers.Serializer):
    paid_through = serializers.DateTimeField(
        help_text="The end of the period this payment covers; after now and the current end."
    )


class SubscriptionChangePlanSerializer(serializers.Serializer):
    plan_code = serializers.CharField(max_length=50)
