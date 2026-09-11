"""`AnnouncementSerializer` — the one shape every announcement action shares."""

from __future__ import annotations

from rest_framework import serializers

from apps.communication.models import Announcement


class AnnouncementSerializer(serializers.ModelSerializer):
    class Meta:
        model = Announcement
        fields = [
            "id",
            "title",
            "body",
            "audience_type",
            "audience_filter",
            "campus_id",
            "status",
            "is_emergency",
            "publish_at",
            "expires_at",
            "show_on_website",
            "attachments",
            "published_by",
            "published_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "published_by",
            "published_at",
            "created_at",
            "updated_at",
        ]
