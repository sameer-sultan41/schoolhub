"""Routes for `/delivery-logs`."""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.communication.delivery.viewset import DeliveryLogViewSet

router = SimpleRouter(trailing_slash=False)
router.register("delivery-logs", DeliveryLogViewSet, basename="delivery-logs")

urlpatterns = [
    path(
        "delivery-logs:summary",
        DeliveryLogViewSet.as_view({"get": "summary"}),
        name="delivery-logs-summary",
    ),
    *router.urls,
]
