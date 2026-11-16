"""Whitelisted filters for `/news-posts` (module doc §16)."""

from __future__ import annotations

import django_filters

from apps.website_cms.models import ContentStatus, NewsPost


class NewsPostFilterSet(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(choices=ContentStatus.choices)

    class Meta:
        model = NewsPost
        fields = ["status"]
