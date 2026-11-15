"""Routes for `/seo-settings` (module doc §16)."""

from django.urls import path

from apps.website_cms.seo.view import SeoSettingView

urlpatterns = [path("seo-settings", SeoSettingView.as_view(), name="seo-settings")]
