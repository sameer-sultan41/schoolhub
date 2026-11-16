"""Whitelisted filters for `/gallery-albums` (module doc §16)."""

from __future__ import annotations

import django_filters

from apps.website_cms.models import ContentStatus, GalleryAlbum


class GalleryAlbumFilterSet(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(choices=ContentStatus.choices)
    school_event_id = django_filters.UUIDFilter(field_name="school_event_id")

    class Meta:
        model = GalleryAlbum
        fields = ["status", "school_event_id"]
