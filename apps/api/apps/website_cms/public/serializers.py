"""Output shapes of the public content API. Class names fix the generated type names
(`PublicTenant`, `PublicSite`, `PublicPage`, `PublicSection`, `PublicSitemapEntry`), which the
renderer reads instead of hand-written types (plan alternative 10).

Read-only: they serialize the plain data `public.services` builds, and never validate input.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.website_cms.constants import SectionType, TextDirection, WebsiteStatus
from apps.website_cms.models import ContentStatus, PageType
from core.tenancy.models import TenantStatus


class PublicTenantLocaleSerializer(serializers.Serializer):
    default_locale = serializers.CharField()
    enabled_locales = serializers.ListField(child=serializers.CharField())
    timezone = serializers.CharField()
    direction = serializers.ChoiceField(choices=TextDirection.choices)


class PublicTenantContactSerializer(serializers.Serializer):
    campus_name = serializers.CharField()
    address = serializers.CharField()
    phone = serializers.CharField()
    email = serializers.CharField()


class PublicTenantSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    slug = serializers.CharField()
    name = serializers.CharField()
    status = serializers.ChoiceField(choices=TenantStatus.choices)
    website_status = serializers.ChoiceField(choices=WebsiteStatus.choices)
    branding = serializers.DictField(help_text="`TenantSettings.branding`, as stored.")
    locale = PublicTenantLocaleSerializer()
    contact = PublicTenantContactSerializer(allow_null=True, help_text="The primary campus.")
    custom_domain = serializers.CharField(
        allow_null=True, help_text="The primary active custom domain, else null."
    )
    enabled_modules = serializers.ListField(child=serializers.CharField())


class PublicSeoSerializer(serializers.Serializer):
    title = serializers.CharField(allow_null=True)
    description = serializers.CharField(allow_null=True)
    canonical_url = serializers.CharField(allow_null=True)
    og_image_url = serializers.CharField(allow_null=True)
    robots = serializers.CharField(allow_null=True)
    noindex = serializers.BooleanField()


class PublicNavLinkSerializer(serializers.Serializer):
    label = serializers.CharField()
    href = serializers.CharField(help_text="A site path (`/about`) or an https URL.")


class PublicNavItemSerializer(PublicNavLinkSerializer):
    children = PublicNavLinkSerializer(many=True)


class PublicNavigationSerializer(serializers.Serializer):
    header = PublicNavItemSerializer(many=True)
    footer_primary = PublicNavItemSerializer(many=True)
    footer_secondary = PublicNavItemSerializer(many=True)


class PublicSiteThemeSerializer(serializers.Serializer):
    code = serializers.CharField()
    version = serializers.CharField()
    config = serializers.DictField()


class PublicSocialLinkSerializer(serializers.Serializer):
    platform = serializers.CharField()
    url = serializers.CharField()


class PublicSiteSerializer(serializers.Serializer):
    theme = PublicSiteThemeSerializer()
    navigation = PublicNavigationSerializer()
    header_config = serializers.DictField()
    footer_config = serializers.DictField()
    social_links = PublicSocialLinkSerializer(many=True)
    seo = PublicSeoSerializer()


class PublicSectionSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    type = serializers.ChoiceField(choices=SectionType.choices)
    position = serializers.IntegerField()
    props = serializers.DictField(help_text="The section's content; image ids become `*_url`.")


class PublicPageSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    slug = serializers.CharField()
    path = serializers.CharField(help_text="`/` for the homepage, else `/<slug>`.")
    title = serializers.CharField()
    page_type = serializers.ChoiceField(choices=PageType.choices)
    status = serializers.ChoiceField(
        choices=ContentStatus.choices, help_text="`published`, unless read under a preview token."
    )
    is_homepage = serializers.BooleanField()
    published_at = serializers.DateTimeField(allow_null=True)
    updated_at = serializers.DateTimeField()
    sections = PublicSectionSerializer(many=True)
    seo = PublicSeoSerializer()


class PublicSitemapEntrySerializer(serializers.Serializer):
    path = serializers.CharField()
    updated_at = serializers.DateTimeField()
