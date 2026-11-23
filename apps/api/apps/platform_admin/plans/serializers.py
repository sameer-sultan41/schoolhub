"""Request and response shapes of `/platform/plans` (platform-admin.md §16, entities `plans`)."""

from __future__ import annotations

import re

from rest_framework import serializers

from apps.platform_admin.constants import QUOTA_METRICS
from apps.platform_admin.models import Plan
from apps.platform_admin.plans.services import CODE_FROZEN
from core.tenancy.features import registry as feature_registry

_CURRENCY = re.compile(r"^[A-Z]{3}$")


class LimitsField(serializers.DictField):
    """Quotas by metric: each a non-negative integer, or null for unlimited (§11).

    Shared by a plan's ``limits`` and a subscription's ``limits_override``. A metric left out
    is unlimited.
    """

    child = serializers.IntegerField(min_value=0, allow_null=True)

    def to_internal_value(self, data):
        limits = super().to_internal_value(data)
        unknown = sorted(set(limits) - set(QUOTA_METRICS))
        if unknown:
            raise serializers.ValidationError(
                f"Unknown metrics: {', '.join(unknown)}. Use {', '.join(QUOTA_METRICS)}."
            )
        return limits


class EnabledModulesField(serializers.ListField):
    """The registered ``module.*`` feature keys a plan enables, each once."""

    child = serializers.CharField(max_length=100)

    def to_internal_value(self, data):
        modules = list(dict.fromkeys(super().to_internal_value(data)))
        known = {spec.key for spec in feature_registry.all() if spec.key.startswith("module.")}
        unknown = [key for key in modules if key not in known]
        if unknown:
            raise serializers.ValidationError(
                f"Not a registered module flag: {', '.join(unknown)}."
            )
        return modules


class PlanSerializer(serializers.ModelSerializer):
    """A plan as the catalog shows it."""

    enabled_modules = serializers.ListField(child=serializers.CharField(), read_only=True)
    limits = serializers.DictField(child=serializers.IntegerField(allow_null=True), read_only=True)

    class Meta:
        model = Plan
        fields = [
            "id",
            "name",
            "code",
            "description",
            "price_amount",
            "currency",
            "billing_period",
            "trial_days",
            "enabled_modules",
            "limits",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class PlanWriteSerializer(serializers.ModelSerializer):
    """`POST` (every field but the optional ones) and `PATCH` (any subset; ``code`` fixed)."""

    enabled_modules = EnabledModulesField(required=False)
    limits = LimitsField(required=False)
    price_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    acknowledge_over_usage = serializers.BooleanField(
        required=False,
        write_only=True,
        help_text="Lower a limit below a school's current usage anyway (checked from PR C).",
    )

    class Meta:
        model = Plan
        fields = [
            "name",
            "code",
            "description",
            "price_amount",
            "currency",
            "billing_period",
            "trial_days",
            "enabled_modules",
            "limits",
            "is_active",
            "acknowledge_over_usage",
        ]

    def validate_code(self, value: str) -> str:
        # Uniqueness is the model's `unique=True` validator; retired plans keep their code.
        if self.instance is not None and value != self.instance.code:
            raise serializers.ValidationError(CODE_FROZEN)
        return value

    def validate_currency(self, value: str) -> str:
        if not _CURRENCY.match(value):
            raise serializers.ValidationError("Use a three-letter ISO 4217 code, e.g. PKR.")
        return value

    def validate(self, attrs: dict) -> dict:
        # Accepted and not yet acted on: the check against a school's usage, and its 409
        # `limit_below_usage`, need the usage snapshots that arrive in PR C (ruling C3).
        attrs.pop("acknowledge_over_usage", None)
        return attrs
