"""Routes for `/message-threads`."""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.communication.threads.viewset import MessageThreadViewSet, ThreadMessageViewSet

router = SimpleRouter(trailing_slash=False)
router.register("message-threads", MessageThreadViewSet, basename="message-threads")

urlpatterns = [
    # Ahead of the router: its detail route would otherwise read "recipients" as an id.
    # No pagination or filters — a capped type-ahead list, not the inbox.
    path(
        "message-threads/recipients",
        MessageThreadViewSet.as_view(
            {"get": "recipients"}, pagination_class=None, filter_backends=[]
        ),
        name="message-threads-recipients",
    ),
    path(
        "message-threads/<uuid:pk>:close",
        MessageThreadViewSet.as_view({"post": "close"}),
        name="message-threads-close",
    ),
    path(
        "message-threads/<uuid:pk>:reopen",
        MessageThreadViewSet.as_view({"post": "reopen"}),
        name="message-threads-reopen",
    ),
    path(
        "message-threads/<uuid:pk>:mark-read",
        MessageThreadViewSet.as_view({"post": "mark_read"}),
        name="message-threads-mark-read",
    ),
    path(
        "message-threads/<uuid:thread_pk>/messages",
        ThreadMessageViewSet.as_view({"get": "list", "post": "create"}),
        name="message-threads-messages",
    ),
    *router.urls,
]
