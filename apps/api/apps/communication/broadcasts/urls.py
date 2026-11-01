"""Routes for `/broadcasts:scope`, `/broadcasts:preview` and `/broadcasts:emergency`.

Explicit `path()`s: there is no `broadcasts` collection to register on a router,
only the colon actions.
"""

from __future__ import annotations

from django.urls import path

from apps.communication.broadcasts.viewset import BroadcastViewSet

urlpatterns = [
    path(
        "broadcasts:scope",
        BroadcastViewSet.as_view({"get": "scope"}),
        name="broadcasts-scope",
    ),
    path(
        "broadcasts:preview",
        BroadcastViewSet.as_view({"post": "preview"}),
        name="broadcasts-preview",
    ),
    path(
        "broadcasts:emergency",
        BroadcastViewSet.as_view({"post": "emergency"}),
        name="broadcasts-emergency",
    ),
]
