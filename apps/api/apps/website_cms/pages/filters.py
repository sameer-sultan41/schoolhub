"""Whitelisted filters for `/website-pages` (module doc §16)."""

from __future__ import annotations

import django_filters

from apps.website_cms.models import ContentStatus, PageType, WebsitePage


class WebsitePageFilterSet(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(choices=ContentStatus.choices)
    page_type = django_filters.ChoiceFilter(choices=PageType.choices)

    class Meta:
        model = WebsitePage
        fields = ["status", "page_type"]
