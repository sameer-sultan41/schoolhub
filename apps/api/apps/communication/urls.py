"""Routes for the communication module — communication.md §16.

Each resource owns its own routes; this file only aggregates them, the
Django/DRF equivalent of the reference's `core/base.py` mounting every
resource's router onto one API instance.
"""

from __future__ import annotations

from django.urls import include, path

urlpatterns = [
    path("", include("apps.communication.template_overrides.urls")),
    path("", include("apps.communication.preferences.urls")),
    path("", include("apps.communication.delivery.urls")),
    path("", include("apps.communication.announcements.urls")),
    path("", include("apps.communication.notices.urls")),
]
