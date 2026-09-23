"""Routes for `/announcements`."""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.communication.announcements.viewset import AnnouncementViewSet

router = SimpleRouter(trailing_slash=False)
router.register("announcements", AnnouncementViewSet, basename="announcements")

urlpatterns = [
    path(
        "announcements/<uuid:pk>:publish",
        AnnouncementViewSet.as_view({"post": "publish"}),
        name="announcements-publish",
    ),
    *router.urls,
]
