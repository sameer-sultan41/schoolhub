"""Whitelisted filters for `/contact-submissions` (module doc §16)."""

from __future__ import annotations

import django_filters

from apps.website_cms.models import ContactStatus, ContactSubmission


class ContactSubmissionFilterSet(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(choices=ContactStatus.choices)
    created_at__gte = django_filters.IsoDateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.IsoDateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = ContactSubmission
        fields = ["status"]
