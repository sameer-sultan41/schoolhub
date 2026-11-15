"""Serializers for `/gallery-albums` and its items."""

from __future__ import annotations

from rest_framework import serializers

from apps.website_cms.models import GalleryAlbum, GalleryItem


class GalleryAlbumSerializer(serializers.ModelSerializer):
    school_event_id = serializers.UUIDField(allow_null=True, read_only=True)

    class Meta:
        model = GalleryAlbum
        fields = [
            "id",
            "title",
            "slug",
            "description",
            "cover_image_file_id",
            "school_event_id",
            "status",
            "published_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class GalleryAlbumWriteSerializer(serializers.ModelSerializer):
    """Input for create and PATCH; slug and event-link rules live in the service (422s)."""

    school_event_id = serializers.UUIDField(allow_null=True, required=False)

    class Meta:
        model = GalleryAlbum
        fields = ["title", "slug", "description", "cover_image_file_id", "school_event_id"]
        extra_kwargs = {
            "slug": {"max_length": None},
            "description": {"required": False},
            "cover_image_file_id": {"required": False},
        }


class GalleryItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = GalleryItem
        fields = [
            "id",
            "media_type",
            "file_id",
            "embed_url",
            "caption",
            "alt_text",
            "position",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class GalleryItemWriteSerializer(serializers.ModelSerializer):
    """Input for create and PATCH; the media rules live in the service (422s)."""

    class Meta:
        model = GalleryItem
        fields = ["media_type", "file_id", "embed_url", "caption", "alt_text"]
        extra_kwargs = {
            "file_id": {"required": False},
            "embed_url": {"required": False, "max_length": None},
            "caption": {"required": False},
            "alt_text": {"required": False},
        }


class ReorderItemsSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=True)
