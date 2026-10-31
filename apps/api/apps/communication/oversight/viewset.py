"""`ThreadOversightViewSet` and `ThreadOversightMessageViewSet` — read-only,
audited access to every thread in the school for `communication.thread.oversee`.

Deliberately not `visible_threads`: an overseer reads conversations they take
no part in. That is exactly why every read of a thread or its messages writes an
audit row, and why nothing here stamps `read_by` or notifies anyone — the
overseer is never a participant. The audit is fail-open, like `record_audit`'s
never-raise contract: a logging failure does not block the read. The list is not
audited (it exposes subjects and ids, not conversation content).
"""

from __future__ import annotations

from functools import cached_property

from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.models import Message, MessageThread
from apps.communication.oversight.filters import ThreadOversightFilterSet
from apps.communication.oversight.serializers import ThreadOversightSerializer
from apps.communication.permission_classes import FEATURE, STAFF_PERMISSIONS
from apps.communication.threads.serializers import MessageSerializer
from apps.communication.threads.viewset import (
    MessageCursorPagination,
    MessageThreadCursorPagination,
)
from core.api.viewsets import TenantScopedViewSetMixin
from core.audit.services import record_audit

OVERSIGHT_PERMISSION = "communication.thread.oversee"
AUDIT_OVERSIGHT_VIEW = "oversight_view"
AUDIT_OVERSIGHT_VIEW_MESSAGES = "oversight_view_messages"


class ThreadOversightViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`/message-thread-oversight` — every alive thread in the tenant, read-only."""

    permission_classes = STAFF_PERMISSIONS
    queryset = MessageThread.objects
    serializer_class = ThreadOversightSerializer
    filterset_class = ThreadOversightFilterSet
    pagination_class = MessageThreadCursorPagination
    # Filters only: the cursor order is the oversight order — see `MessageThreadViewSet`.
    filter_backends = [DjangoFilterBackend]
    ordering_fields = ["last_message_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = OVERSIGHT_PERMISSION
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        """Not `scope_queryset`, not participant-filtered: the permission is the authorization."""
        return MessageThread.objects.alive()

    @extend_schema(responses={200: ThreadOversightSerializer})
    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        """`GET /message-thread-oversight/{id}` — one thread; writes an audit row."""
        thread = self.get_object()
        record_audit(request, AUDIT_OVERSIGHT_VIEW, thread)
        return Response({"data": self.get_serializer(thread).data})


class ThreadOversightMessageViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """`GET /message-thread-oversight/{thread_pk}/messages` — the whole conversation.

    Internal notes included; each request writes an audit row. Never stamps
    `read_by`.
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = Message.objects
    serializer_class = MessageSerializer
    pagination_class = MessageCursorPagination
    # No filter backends: the route passes `filter_backends=[]` (oversight/urls.py).
    ordering_fields = ["sent_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = OVERSIGHT_PERMISSION
    http_method_names = ["get", "head", "options"]

    @cached_property
    def thread(self) -> MessageThread:
        return get_object_or_404(MessageThread.objects.alive(), pk=self.kwargs["thread_pk"])

    def get_queryset(self):
        return Message.objects.filter(thread=self.thread)

    def list(self, request: Request, *args, **kwargs) -> Response:
        # The cursor says which page was read; null for the first.
        record_audit(
            request,
            AUDIT_OVERSIGHT_VIEW_MESSAGES,
            self.thread,
            after={"cursor": request.query_params.get("cursor")},
        )
        return super().list(request, *args, **kwargs)
