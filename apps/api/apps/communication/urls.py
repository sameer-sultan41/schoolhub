"""Routes for the communication module — communication.md §16.

Explicit `path()` entries come before `*router.urls`, matching every other
module: a colon-action would otherwise be swallowed by the router's detail
pattern.
"""

from django.urls import include, path
from rest_framework.routers import SimpleRouter

from apps.communication.views import DeliveryLogViewSet, NotificationPreferenceView

router = SimpleRouter(trailing_slash=False)
router.register("delivery-logs", DeliveryLogViewSet, basename="delivery-logs")

urlpatterns = [
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
    path("", include("apps.communication.template_overrides.urls")),
    path("", include("apps.communication.announcements.urls")),
    path("", include("apps.communication.notices.urls")),
    *router.urls,
]
