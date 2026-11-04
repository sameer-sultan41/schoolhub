"""`/notifications` — the caller's own in-app inbox."""

from __future__ import annotations

from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from core.api.pagination import CursorPagination
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.notifications.filters import NotificationFilterSet
from core.notifications.models import Notification
from core.notifications.serializers import (
    MarkAllReadRequestSerializer,
    MarkAllReadResultSerializer,
    NotificationMarkReadResultSerializer,
    NotificationSerializer,
    UnreadCountSerializer,
)
from core.notifications.services import own_notifications, unread_notification_count

VIEW_KEY = "platform.notification.view"


class NotificationCursorPagination(CursorPagination):
    # `id` breaks ties between rows created in the same instant.
    ordering = ("-created_at", "-id")


class NotificationInboxViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """The caller's own notifications, the same rows for every role and scope."""

    queryset = Notification.objects
    serializer_class = NotificationSerializer
    filterset_class = NotificationFilterSet
    pagination_class = NotificationCursorPagination
    # Filters only: the cursor order is the inbox order, so no `?ordering=` may replace it.
    filter_backends = [DjangoFilterBackend]
    ordering_fields = ["created_at"]
    scope_campus_field = None
    required_permission = VIEW_KEY
    # Writes are mapped explicitly (L28); they stamp the caller's own `read_at`, which the
    # view key already covers, so the key is the same by choice.
    required_permission_map = {
        "mark_read": VIEW_KEY,
        "mark_all_read": VIEW_KEY,
        "unread_count": VIEW_KEY,
    }
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        """Own rows only — `services.own_notifications` says why it is not `scope_queryset`."""
        return own_notifications(self.request.user)

    @extend_schema(
        request=None,
        responses={200: UnreadCountSerializer},
        tags=["notifications"],
        operation_id="notifications_unread_count",
    )
    def unread_count(self, request: Request) -> Response:
        """`GET /notifications:unread-count`."""
        return ActionResponse.ok({"unread": unread_notification_count(request.user)})

    @extend_schema(request=None, responses={200: NotificationMarkReadResultSerializer})
    def mark_read(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notifications/{id}:mark-read` — idempotent, keeps the first `read_at`."""
        notification = self.get_object()
        if notification.read_at is None:
            self.get_queryset().filter(pk=notification.pk, read_at__isnull=True).update(
                read_at=timezone.now()
            )
            notification.refresh_from_db(fields=["read_at"])
        return ActionResponse.ok({"read_at": notification.read_at})

    @extend_schema(
        request=MarkAllReadRequestSerializer,
        responses={200: MarkAllReadResultSerializer},
        tags=["notifications"],
        operation_id="notifications_mark_all_read",
    )
    def mark_all_read(self, request: Request) -> Response:
        """`POST /notifications:mark-all-read` — rows at or before `before` (default now).

        The bound keeps a notification that arrived after the client rendered its list
        unread, instead of marking it unseen.
        """
        serializer = MarkAllReadRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        now = timezone.now()
        before = serializer.validated_data.get("before", now)
        marked = (
            self.get_queryset()
            .filter(read_at__isnull=True, created_at__lte=before)
            .update(read_at=now)
        )
        return ActionResponse.ok({"marked": marked})
