"""`NoticeSerializer` — the one shape every notice action shares."""

from __future__ import annotations

from rest_framework import serializers

from apps.communication.models import Notice, NoticeStatus


class NoticeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notice
        fields = [
            "id",
            "notice_no",
            "title",
            "body",
            "notice_type",
            "audience_type",
            "audience_filter",
            "status",
            "requires_acknowledgment",
            "publish_at",
            "valid_until",
            "show_on_website",
            "attachments",
            "approved_by",
            "published_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "notice_no",
            "status",
            "approved_by",
            "published_at",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs: dict) -> dict:
        # Once submitted, a notice's content is what the approver is reviewing
        # (or has already published) — editing it out from under them defeats
        # the segregation-of-duties intent of the approval gate.
        if self.instance is not None and self.instance.status != NoticeStatus.DRAFT:
            raise serializers.ValidationError({"status": "Only a draft notice can be edited."})
        return attrs
