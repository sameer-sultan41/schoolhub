"""Response shape of `/platform/tenants/{tenant_pk}/usage` and `:refresh-usage` (§16)."""

from __future__ import annotations

from rest_framework import serializers

from apps.platform_admin.models import TenantUsageSnapshot


class TenantUsageSnapshotSerializer(serializers.ModelSerializer):
    modules_enabled = serializers.ListField(child=serializers.CharField(), read_only=True)

    class Meta:
        model = TenantUsageSnapshot
        fields = [
            "id",
            "taken_at",
            "status",
            "plan_code",
            "mrr_amount",
            "currency",
            "students",
            "staff",
            "storage_bytes",
            "impersonations_30d",
            "modules_enabled",
        ]
        read_only_fields = fields


class TenantUsageSerializer(serializers.Serializer):
    """The school's latest snapshot (null before its first) and its effective limits."""

    snapshot = TenantUsageSnapshotSerializer(allow_null=True, read_only=True)
    limits = serializers.DictField(
        child=serializers.IntegerField(allow_null=True),
        read_only=True,
        help_text="Every quota metric's effective limit; null is unlimited. `storage_gb` is GiB.",
    )
