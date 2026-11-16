"""Serializers for `/custom-domains`. The token is shown only as the TXT record to create."""

from __future__ import annotations

from django.conf import settings
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.website_cms.constants import DOMAIN_INPUT_MAX_LENGTH
from apps.website_cms.custom_domains.adapters import txt_record_name
from apps.website_cms.models import CustomDomain


class DnsRecordSerializer(serializers.Serializer):
    """One DNS record the school must create: `TXT` (the token) or `CNAME` (the target).

    The CNAME must point directly at the target (chains are not followed) and stay: the
    daily re-check reads it. The TXT record proves ownership at verification and may then be
    removed (`keep_after_verification: false`); if it is kept, it must keep this token, or
    the daily re-check counts a failure (a new owner of the domain evicts a stale holder).
    """

    type = serializers.CharField()
    name = serializers.CharField()
    value = serializers.CharField()
    keep_after_verification = serializers.BooleanField()


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
            "last_error_code",
            "dns_records",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    @extend_schema_field(DnsRecordSerializer(many=True))
    def get_dns_records(self, obj: CustomDomain) -> list[dict[str, str | bool]]:
        """The guided DNS instructions (§6): the verification TXT record and the CNAME."""
        return [
            {
                "type": "TXT",
                "name": txt_record_name(obj.domain),
                "value": obj.verification_token,
                "keep_after_verification": False,
            },
            {
                "type": "CNAME",
                "name": obj.domain,
                "value": settings.WEBSITE_CNAME_TARGET,
                "keep_after_verification": True,
            },
        ]


class CustomDomainCreateSerializer(serializers.Serializer):
    """POST input. Shape only; the service normalises and validates the name (422)."""

    domain = serializers.CharField(trim_whitespace=True, max_length=DOMAIN_INPUT_MAX_LENGTH)


class CustomDomainUpdateSerializer(serializers.Serializer):
    """PATCH input: `is_primary` is the only writable field."""

    is_primary = serializers.BooleanField()
