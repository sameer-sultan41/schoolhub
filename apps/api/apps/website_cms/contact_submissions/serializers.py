"""Serializers for `/contact-submissions`. `ip` is deliberately absent (privacy)."""

from __future__ import annotations

from rest_framework import serializers

from apps.website_cms.models import ContactStatus, ContactSubmission


class ContactSubmissionSerializer(serializers.ModelSerializer):
    source_page_id = serializers.UUIDField(read_only=True)
    handled_by_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = ContactSubmission
        fields = [
            "id",
            "name",
            "email",
            "phone",
            "subject",
            "message",
            "source_page_id",
            "status",
            "handled_by_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class ContactSubmissionTriageSerializer(serializers.Serializer):
    """PATCH input: `status` is the only writable field."""

    status = serializers.ChoiceField(choices=ContactStatus.choices)
