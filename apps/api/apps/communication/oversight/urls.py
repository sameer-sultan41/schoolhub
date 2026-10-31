"""Routes for `/message-thread-oversight`."""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.communication.oversight.viewset import (
    ThreadOversightMessageViewSet,
    ThreadOversightViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register(
    "message-thread-oversight", ThreadOversightViewSet, basename="message-thread-oversight"
)

urlpatterns = [
    path(
        "message-thread-oversight/<uuid:pk>/attachments/<uuid:file_id>:download",
        ThreadOversightViewSet.as_view({"post": "download_attachment"}),
        name="message-thread-oversight-attachment-download",
    ),
    path(
        "message-thread-oversight/<uuid:thread_pk>/messages",
        # No filters: the cursor order is the conversation order, nothing to search.
        ThreadOversightMessageViewSet.as_view({"get": "list"}, filter_backends=[]),
        name="message-thread-oversight-messages",
    ),
    *router.urls,
]
