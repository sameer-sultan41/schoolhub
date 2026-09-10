"""Routes for `/notification-preferences`."""

from __future__ import annotations

from django.urls import path

from apps.communication.preferences.view import NotificationPreferenceView

urlpatterns = [
    path(
        "notification-preferences",
        NotificationPreferenceView.as_view(),
        name="notification-preferences",
    ),
]
