"""Routes for the communication module — communication.md §16.

Explicit `path()` entries come before `*router.urls`, matching every other
module: a colon-action would otherwise be swallowed by the router's detail
pattern.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.communication.views import (
    AnnouncementViewSet,
    DeliveryLogViewSet,
    NoticeViewSet,
    NotificationPreferenceView,
    NotificationTemplateOverrideViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register(
    "notification-templates", NotificationTemplateOverrideViewSet, basename="notification-templates"
)
router.register("delivery-logs", DeliveryLogViewSet, basename="delivery-logs")
router.register("announcements", AnnouncementViewSet, basename="announcements")
router.register("notices", NoticeViewSet, basename="notices")

urlpatterns = [
    path(
        "notification-templates/<uuid:pk>:preview",
        NotificationTemplateOverrideViewSet.as_view({"post": "preview"}),
        name="notification-templates-preview",
    ),
    path(
        "delivery-logs:summary",
        DeliveryLogViewSet.as_view({"get": "summary"}),
        name="delivery-logs-summary",
    ),
    path(
        "notification-preferences",
        NotificationPreferenceView.as_view(),
        name="notification-preferences",
    ),
    path(
        "announcements/<uuid:pk>:publish",
        AnnouncementViewSet.as_view({"post": "publish"}),
        name="announcements-publish",
    ),
    path(
        "notices/<uuid:pk>/download",
        NoticeViewSet.as_view({"get": "download"}),
        name="notices-download",
    ),
    path(
        "notices/<uuid:pk>:submit",
        NoticeViewSet.as_view({"post": "submit"}),
        name="notices-submit",
    ),
    path(
        "notices/<uuid:pk>:publish",
        NoticeViewSet.as_view({"post": "publish"}),
        name="notices-publish",
    ),
    path(
        "notices/<uuid:pk>:acknowledge",
        NoticeViewSet.as_view({"post": "acknowledge"}),
        name="notices-acknowledge",
    ),
    *router.urls,
]
