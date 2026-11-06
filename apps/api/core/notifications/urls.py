"""Routes for `/notifications`.

Colon-actions are declared before ``*router.urls``, as in `apps.staff_management.staff.urls`.
"""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from core.notifications.views import NotificationInboxViewSet

router = SimpleRouter(trailing_slash=False)
router.register("notifications", NotificationInboxViewSet, basename="notifications")

urlpatterns = [
    path(
        "notifications:unread-count",
        NotificationInboxViewSet.as_view(
            {"get": "unread_count"}, pagination_class=None, filter_backends=[]
        ),
        name="notifications-unread-count",
    ),
    path(
        "notifications:mark-all-read",
        NotificationInboxViewSet.as_view({"post": "mark_all_read"}, filter_backends=[]),
        name="notifications-mark-all-read",
    ),
    path(
        "notifications/<uuid:pk>:mark-read",
        NotificationInboxViewSet.as_view({"post": "mark_read"}),
        name="notifications-mark-read",
    ),
    *router.urls,
]
