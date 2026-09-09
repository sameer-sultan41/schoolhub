"""Routes for the communication module — communication.md §16.

Explicit `path()` entries come before `*router.urls`, matching every other
module: a colon-action would otherwise be swallowed by the router's detail
pattern.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.communication.views import (
    DeliveryLogViewSet,
    NotificationPreferenceView,
    NotificationTemplateOverrideViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register(
    "notification-templates", NotificationTemplateOverrideViewSet, basename="notification-templates"
)
router.register("delivery-logs", DeliveryLogViewSet, basename="delivery-logs")

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
    *router.urls,
]
