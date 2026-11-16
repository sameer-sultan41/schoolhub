"""Output shapes of the public content feeds. Class names fix the generated type names
(`PublicNewsPost`, `PublicNewsPostDetail`, `PublicSchoolEvent`, `PublicSchoolEventDetail`,
`PublicGalleryAlbum`, `PublicGalleryAlbumDetail`, `PublicGalleryItem`, `PublicGalleryImage`,
`PublicTeacher`, `PublicDepartment`, `PublicClass`, `PublicNotice`).

Read-only: they serialize the plain data `public.content_services` builds.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.website_cms.models import MediaType

RICH_TEXT_HELP = "A rich-text block document; image ids become `*_url`."


class PublicNewsPostSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    slug = serializers.CharField()
    title = serializers.CharField()
    excerpt = serializers.CharField()
    cover_image_url = serializers.CharField(allow_null=True)
    published_at = serializers.DateTimeField(allow_null=True)


class PublicNewsPostDetailSerializer(PublicNewsPostSerializer):
    body = serializers.DictField(help_text=RICH_TEXT_HELP)
    updated_at = serializers.DateTimeField()


class PublicSchoolEventSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    slug = serializers.CharField()
    title = serializers.CharField()
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField(allow_null=True)
    is_all_day = serializers.BooleanField()
    location = serializers.CharField()
    cover_image_url = serializers.CharField(allow_null=True)


class PublicSchoolEventDetailSerializer(PublicSchoolEventSerializer):
    description = serializers.DictField(help_text=RICH_TEXT_HELP)
    updated_at = serializers.DateTimeField()


class PublicGalleryAlbumSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    slug = serializers.CharField()
    title = serializers.CharField()
    description = serializers.CharField()
    cover_image_url = serializers.CharField(allow_null=True)
    published_at = serializers.DateTimeField(allow_null=True)
    item_count = serializers.IntegerField()


class PublicGalleryItemSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    media_type = serializers.ChoiceField(choices=MediaType.choices)
    image_url = serializers.CharField(allow_null=True, help_text="Null for a video embed.")
    embed_url = serializers.CharField(allow_null=True, help_text="Null for an image.")
    caption = serializers.CharField()
    alt_text = serializers.CharField()
    position = serializers.IntegerField()


class PublicGalleryAlbumDetailSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    slug = serializers.CharField()
    title = serializers.CharField()
    description = serializers.CharField()
    cover_image_url = serializers.CharField(allow_null=True)
    published_at = serializers.DateTimeField(allow_null=True)
    item_count = serializers.IntegerField(help_text="All live items; `items` is capped.")
    items = PublicGalleryItemSerializer(many=True)


class PublicGalleryImageSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    image_url = serializers.CharField()
    caption = serializers.CharField()
    alt_text = serializers.CharField()
    album_slug = serializers.CharField()
    album_title = serializers.CharField()


class PublicTeacherSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    full_name = serializers.CharField()
    designation = serializers.CharField()
    photo_url = serializers.CharField(allow_null=True, help_text="Null unless the photo is public.")
    bio = serializers.CharField()


class PublicDepartmentSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    description = serializers.CharField()


class PublicClassSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    level = serializers.IntegerField()


class PublicNoticeSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    kind = serializers.CharField(help_text="`announcement` or `notice`.")
    title = serializers.CharField()
    body = serializers.CharField(help_text="Plain text.")
    published_at = serializers.DateTimeField()
