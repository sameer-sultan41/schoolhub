"""Serializers for `/custom-domains`. The token is shown only as the TXT record to create."""

from __future__ import annotations

from django.conf import settings
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.website_cms.custom_domains.adapters import txt_record_name
from apps.website_cms.models import CustomDomain


class DnsRecordSerializer(serializers.Serializer):
    """One DNS record the school must create: `TXT` (the token) or `CNAME` (the target)."""

    type = serializers.CharField()
    name = serializers.CharField()
    value = serializers.CharField()


class CustomDomainSerializer(serializers.ModelSerializer):
    dns_records = serializers.SerializerMethodField()

    class Meta:
        model = CustomDomain
        fields = [
            "id",
            "domain",
            "status",
            "tls_status",
            "is_primary",
            "verified_at",
            "last_error",
            "dns_records",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    @extend_schema_field(DnsRecordSerializer(many=True))
    def get_dns_records(self, obj: CustomDomain) -> list[dict[str, str]]:
        """The guided DNS instructions (§6): the verification TXT record and the CNAME."""
        return [
            {"type": "TXT", "name": txt_record_name(obj.domain), "value": obj.verification_token},
            {"type": "CNAME", "name": obj.domain, "value": settings.WEBSITE_CNAME_TARGET},
        ]


class CustomDomainCreateSerializer(serializers.Serializer):
    """POST input. Shape only; the service normalises and validates the name (422)."""

    domain = serializers.CharField(trim_whitespace=True)


class CustomDomainUpdateSerializer(serializers.Serializer):
    """PATCH input: `is_primary` is the only writable field."""

    is_primary = serializers.BooleanField()
