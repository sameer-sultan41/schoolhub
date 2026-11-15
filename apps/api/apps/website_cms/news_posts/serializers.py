"""Serializers for `/news-posts`."""

from __future__ import annotations

from rest_framework import serializers

from apps.website_cms.models import NewsPost


class NewsPostListSerializer(serializers.ModelSerializer):
    class Meta:
        model = NewsPost
        fields = [
            "id",
            "title",
            "slug",
            "excerpt",
            "cover_image_file_id",
            "status",
            "published_at",
            "locale",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class NewsPostDetailSerializer(NewsPostListSerializer):
    class Meta(NewsPostListSerializer.Meta):
        fields = [*NewsPostListSerializer.Meta.fields, "body"]
        read_only_fields = fields


class NewsPostWriteSerializer(serializers.ModelSerializer):
    """Input for create and PATCH; slug and body rules live in the service (422s)."""

    body = serializers.JSONField(required=False)

    class Meta:
        model = NewsPost
        fields = ["title", "slug", "excerpt", "body", "cover_image_file_id", "locale"]
        # No serializer max_length on the slug: the service decides every slug rule, as a 422.
        extra_kwargs = {
            "slug": {"max_length": None},
            "excerpt": {"required": False},
            "locale": {"required": False},
            "cover_image_file_id": {"required": False},
        }
