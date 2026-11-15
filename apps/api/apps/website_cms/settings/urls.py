"""Routes for `/website-settings` and `/themes` (module doc §16)."""

from django.urls import path

from apps.website_cms.settings.view import ThemeViewSet, WebsiteSettingsView

urlpatterns = [
    path("website-settings", WebsiteSettingsView.as_view(), name="website-settings"),
    path("themes", ThemeViewSet.as_view({"get": "list"}), name="themes-list"),
]
