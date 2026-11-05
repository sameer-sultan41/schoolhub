"""Request and response bodies for the unauthenticated invitation endpoints."""

from __future__ import annotations

from rest_framework import serializers


class InvitationLinkSerializer(serializers.Serializer):
    school = serializers.SlugField(help_text="Tenant slug, from the link's `school` fragment.")
    token = serializers.CharField(max_length=128, help_text="From the link's `token` fragment.")


class InvitationAcceptSerializer(InvitationLinkSerializer):
    password = serializers.CharField(write_only=True, style={"input_type": "password"})


class InvitationPreviewSerializer(serializers.Serializer):
    email = serializers.EmailField()
    school_name = serializers.CharField()
    expires_at = serializers.DateTimeField()
