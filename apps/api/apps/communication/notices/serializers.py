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


class PortalNoticeSerializer(serializers.ModelSerializer):
    """A notice as a student or guardian sees it: explicit fields only.

    The staff shape also carries `audience_filter` (a custom audience's user ids),
    `approved_by`, `status` and `show_on_website`, none of which a recipient may read.
    `acknowledged_at` is the caller's own, annotated by `NoticeViewSet.get_queryset`
    so a page costs one query rather than one per row.
    """

    acknowledged_at = serializers.DateTimeField(read_only=True, allow_null=True)

    class Meta:
        model = Notice
        fields = [
            "id",
            "notice_no",
            "title",
            "body",
            "notice_type",
            "published_at",
            "requires_acknowledgment",
            "acknowledged_at",
        ]
        read_only_fields = fields
