"""Routes for `/notification-templates`."""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.communication.template_overrides.viewset import NotificationTemplateOverrideViewSet

router = SimpleRouter(trailing_slash=False)
router.register(
    "notification-templates",
    NotificationTemplateOverrideViewSet,
    basename="notification-templates",
)

urlpatterns = [
    path(
        "notification-templates/<uuid:pk>:preview",
        NotificationTemplateOverrideViewSet.as_view({"post": "preview"}),
        name="notification-templates-preview",
    ),
    *router.urls,
]
