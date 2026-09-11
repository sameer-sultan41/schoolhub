"""Routes for `/school-settings` (module doc §16)."""

from __future__ import annotations

from django.urls import path

from apps.school_organization.school_settings.view import SchoolSettingsView

urlpatterns = [
    path("school-settings", SchoolSettingsView.as_view(), name="school-settings"),
]
