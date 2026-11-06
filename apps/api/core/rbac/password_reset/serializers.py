"""Request bodies for the unauthenticated password-reset endpoints."""

from __future__ import annotations

from rest_framework import serializers


class PasswordResetRequestSerializer(serializers.Serializer):
    school = serializers.SlugField(
        help_text="Tenant slug. Required: one email can hold accounts at two schools."
    )
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    school = serializers.SlugField(help_text="Tenant slug, from the link's `school` fragment.")
    uid = serializers.CharField(max_length=64, help_text="From the link's `uid` fragment.")
    token = serializers.CharField(max_length=128, help_text="From the link's `token` fragment.")
    new_password = serializers.CharField(write_only=True, style={"input_type": "password"})
