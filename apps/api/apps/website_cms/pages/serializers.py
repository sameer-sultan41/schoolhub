"""Serializers for `/website-pages` and its sections."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.website_cms.constants import MAX_SECTIONS_PER_PAGE, SectionType
from apps.website_cms.models import PageSection, PageType, WebsitePage


class PageSectionSerializer(serializers.ModelSerializer):
    section_type = serializers.ChoiceField(choices=SectionType.choices, read_only=True)

    class Meta:
        model = PageSection
        fields = ["id", "section_type", "position", "content", "is_visible"]
        read_only_fields = fields


class WebsitePageListSerializer(serializers.ModelSerializer):
    class Meta:
        model = WebsitePage
        fields = [
            "id",
            "title",
            "slug",
            "page_type",
            "status",
            "published_at",
            "locale",
            "show_in_search",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class WebsitePageDetailSerializer(WebsitePageListSerializer):
    sections = serializers.SerializerMethodField()

    class Meta(WebsitePageListSerializer.Meta):
        fields = [*WebsitePageListSerializer.Meta.fields, "sections"]
        read_only_fields = fields

    @extend_schema_field(PageSectionSerializer(many=True))
    def get_sections(self, obj: WebsitePage) -> list[dict]:
        rows = sorted(
            (s for s in obj.sections.all() if s.deleted_at is None),
            key=lambda s: (s.position, s.id),
        )
        return PageSectionSerializer(rows, many=True).data


class WebsitePageWriteSerializer(serializers.ModelSerializer):
    """Input for create and PATCH; slug rules live in the service (422s)."""

    page_type = serializers.ChoiceField(choices=PageType.choices, required=False)

    class Meta:
        model = WebsitePage
        fields = ["title", "slug", "page_type", "locale", "show_in_search"]
        extra_kwargs = {"locale": {"required": False}}


class WebsitePageUpdateSerializer(WebsitePageWriteSerializer):
    """PATCH cannot change `page_type`: a page's type fixes its role on the site."""

    class Meta(WebsitePageWriteSerializer.Meta):
        fields = ["title", "slug", "locale", "show_in_search"]


class SectionInputSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    section_type = serializers.ChoiceField(choices=SectionType.choices)
    content = serializers.DictField()
    is_visible = serializers.BooleanField(default=True)


class ReplaceSectionsSerializer(serializers.Serializer):
    sections = SectionInputSerializer(many=True, max_length=MAX_SECTIONS_PER_PAGE)


class PagePreviewSerializer(serializers.Serializer):
    url = serializers.CharField()
    expires_in = serializers.IntegerField()
