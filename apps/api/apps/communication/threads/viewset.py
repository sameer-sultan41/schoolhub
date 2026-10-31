"""`MessageThreadViewSet` and `ThreadMessageViewSet` — request handling for
`/message-threads` and `/message-threads/{thread_pk}/messages`.

Thin: who may start which thread is `services/create.py`, who may post what is
`services/post_message.py`, the open/closed transitions are `services/close.py`
and `services/reopen.py`, read receipts are `services/mark_read.py`, and who a
thread can be addressed to is `routing.py`. See `notices/viewset.py`'s own
docstring for why actions stay plain methods on one class.
"""

from __future__ import annotations

from functools import cached_property

from django.db.models import Count, Q, QuerySet
from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.models import Message, MessageThread
from apps.communication.permission_classes import (
    FEATURE,
    OWN_PREFERENCE_PERMISSIONS,
    STAFF_PERMISSIONS,
)
from apps.communication.threads.filters import MessageThreadFilterSet
from apps.communication.threads.routing import search_recipients
from apps.communication.threads.serializers import (
    MarkReadResultSerializer,
    MessageCreateSerializer,
    MessageSerializer,
    MessageThreadCreateSerializer,
    MessageThreadSerializer,
    ThreadRecipientListResponseSerializer,
    ThreadRecipientSerializer,
)
from apps.communication.threads.services.close import close_thread
from apps.communication.threads.services.create import create_thread
from apps.communication.threads.services.mark_read import mark_thread_read
from apps.communication.threads.services.post_message import post_message
from apps.communication.threads.services.reopen import reopen_thread
from apps.student_management.models import Student
from core.api.pagination import CursorPagination
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.rbac.permissions import is_restricted_principal


class MessageThreadCursorPagination(CursorPagination):
    """Most recent activity first; `-id` makes the order total, so a page boundary
    between two threads with the same `last_message_at` never skips or repeats one."""

    ordering = ("-last_message_at", "-id")


class MessageCursorPagination(CursorPagination):
    """Newest first; `-id` breaks ties as on the inbox, so a page boundary between
    two messages sent in the same instant never skips or repeats one."""

    ordering = ("-sent_at", "-id")


def visible_threads(user, *, restricted: bool) -> QuerySet[MessageThread]:
    """Threads the caller takes part in — and only those, whatever their role scope.

    Deliberately not `scope_queryset`: membership *is* the authorization
    (ADR-0030). Record scope would show a scope-`all` admin every conversation
    in the school, and hand an `assigned`-scope class teacher nothing, since a
    thread has no section to be assigned through — while the class teacher a
    guardian's thread was routed to must see it. Reading threads one is not part
    of is `communication.thread.oversee`'s separate, audited endpoint.

    A guardian or student must also still own the thread's student: revoking a
    guardian's portal access cuts them off from the conversations about that
    child, not just from the child's record.

    Both viewsets resolve a thread through this one definition, so the inbox, a
    thread's messages and posting into it never disagree about who sees what.
    """
    queryset = MessageThread.participant_filter(MessageThread.objects.alive(), user)
    if restricted:
        owned = Student.filter_owned_by_user(Student.objects.alive(), user)
        queryset = queryset.filter(student__in=owned)
    return queryset


def unread_count(user, *, restricted: bool) -> Count:
    """Messages in the thread the caller neither sent nor has a `read_by` stamp on.

    A guardian or student never sees an internal note, so one cannot be unread
    for them either.
    """
    unread = ~Q(messages__sender_id=user.pk) & (
        Q(messages__read_by__isnull=True) | ~Q(messages__read_by__has_key=str(user.pk))
    )
    if restricted:
        unread &= Q(messages__is_internal_note=False)
    return Count("messages", filter=unread)


class MessageThreadViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`/message-threads` — the caller's own inbox.

    No `campus_id` column on this table, so `scope_campus_field = None`. It is
    unused in any case: `get_queryset` does not call `scope_queryset` at all.
    """

    permission_classes = OWN_PREFERENCE_PERMISSIONS
    queryset = MessageThread.objects
    serializer_class = MessageThreadSerializer
    filterset_class = MessageThreadFilterSet
    pagination_class = MessageThreadCursorPagination
    # Filters only: the cursor order is the inbox order, so no `?ordering=` may
    # replace it, and there is no free-text `?search=` over threads to offer.
    filter_backends = [DjangoFilterBackend]
    # The allowlist the ordering contract asks every list for: only the cursor's
    # own indexed, NOT NULL column. With no `OrderingFilter` above it widens
    # nothing; it records that nothing else is sortable.
    ordering_fields = ["last_message_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "communication.thread.view"
    required_permission_map = {
        "create": "communication.thread.create",
        "close": "communication.thread.close",
        "reopen": "communication.thread.close",
        "recipients": "communication.thread.create",
    }
    # `mark_read` keeps the default `thread.view`: stamping a receipt is reading.
    http_method_names = ["get", "post", "head", "options"]

    # Guardians and students hold `thread.view`/`thread.create` for their own
    # conversations; they never close one, nor browse the staff list.
    STAFF_ONLY_ACTIONS = frozenset({"close", "reopen", "recipients"})

    def get_permissions(self):
        if self.action in self.STAFF_ONLY_ACTIONS:
            return [permission() for permission in STAFF_PERMISSIONS]
        return [permission() for permission in OWN_PREFERENCE_PERMISSIONS]

    def get_serializer_class(self):
        if self.action == "create":
            return MessageThreadCreateSerializer
        if self.action == "recipients":
            return ThreadRecipientSerializer
        return MessageThreadSerializer

    def get_queryset(self):
        """The caller's `visible_threads`, each with its per-caller `unread_count`."""
        user = self.request.user
        restricted = is_restricted_principal(user)
        return visible_threads(user, restricted=restricted).annotate(
            unread_count=unread_count(user, restricted=restricted)
        )

    def _reread(self, thread: MessageThread) -> dict:
        """The thread as the inbox shows it, `unread_count` included."""
        return MessageThreadSerializer(self.get_queryset().get(pk=thread.pk)).data

    @extend_schema(request=MessageThreadCreateSerializer, responses={201: MessageThreadSerializer})
    def create(self, request: Request, *args, **kwargs) -> Response:
        """`POST /message-threads` — a thread and its first message, together."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        attachments = data["attachments"]

        thread = create_thread(
            actor=request.user,
            tenant_id=request.tenant.pk,
            subject=data["subject"],
            thread_type=data["thread_type"],
            student_id=data["student_id"],
            participant_user_ids=data["participant_user_ids"],
            body=data["body"],
            # The JSON column stores ids as strings, as `participant_user_ids` does.
            attachments=[str(file_id) for file_id in attachments] if attachments else None,
        )
        body = self._reread(thread)
        record_audit(request, "create", thread, after=body)
        return Response({"data": body}, status=201)

    @extend_schema(request=None, responses={200: MessageThreadSerializer})
    def close(self, request: Request, pk: str | None = None) -> Response:
        """`POST /message-threads/{id}:close` — open -> closed."""
        instance = self.get_object()
        before = MessageThreadSerializer(instance).data
        closed = close_thread(thread=instance, actor=request.user)
        after = self._reread(closed)
        record_audit(request, "close", closed, before=before, after=after)
        return ActionResponse.ok(after, message="Thread closed.")

    @extend_schema(request=None, responses={200: MessageThreadSerializer})
    def reopen(self, request: Request, pk: str | None = None) -> Response:
        """`POST /message-threads/{id}:reopen` — closed -> open."""
        instance = self.get_object()
        before = MessageThreadSerializer(instance).data
        reopened = reopen_thread(thread=instance, actor=request.user)
        after = self._reread(reopened)
        record_audit(request, "reopen", reopened, before=before, after=after)
        return ActionResponse.ok(after, message="Thread reopened.")

    @extend_schema(request=None, responses={200: MarkReadResultSerializer})
    def mark_read(self, request: Request, pk: str | None = None) -> Response:
        """`POST /message-threads/{id}:mark-read` — stamp every unread message as read.

        Not audited: a read receipt is the caller's own state, not a change to
        the conversation.
        """
        marked = mark_thread_read(thread=self.get_object(), user=request.user)
        return ActionResponse.ok({"marked": marked})

    @extend_schema(
        parameters=[
            OpenApiParameter("search", str, description="Matches first name, last name or email.")
        ],
        responses={200: ThreadRecipientListResponseSerializer},
    )
    def recipients(self, request: Request) -> Response:
        """`GET /message-threads/recipients?search=` — staff for an internal or group thread."""
        rows = search_recipients(
            tenant_id=request.tenant.pk,
            exclude_user_id=request.user.pk,
            search=request.query_params.get("search", ""),
        )
        return Response({"data": self.get_serializer(rows, many=True).data})


class ThreadMessageViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """`GET/POST /message-threads/{thread_pk}/messages` — one thread's conversation.

    The thread resolves through `visible_threads`, so a thread the caller does
    not take part in — or no longer owns the child of — is a 404 here exactly
    as on retrieve. Every post goes through `post_message`, which holds the same
    rules again for callers that never reach this view.
    """

    permission_classes = OWN_PREFERENCE_PERMISSIONS
    queryset = Message.objects
    serializer_class = MessageSerializer
    pagination_class = MessageCursorPagination
    # No filter backends: the route passes `filter_backends=[]` (threads/urls.py),
    # as `recipients` does — the cursor order is the conversation order, and there
    # is nothing to filter or search.
    # Only the cursor's own indexed, non-null column — see `MessageThreadViewSet`.
    ordering_fields = ["sent_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "communication.thread.view"
    required_permission_map = {"create": "communication.message.create"}
    http_method_names = ["get", "post", "head", "options"]

    @cached_property
    def restricted(self) -> bool:
        return is_restricted_principal(self.request.user)

    @cached_property
    def thread(self) -> MessageThread:
        return get_object_or_404(
            visible_threads(self.request.user, restricted=self.restricted),
            pk=self.kwargs["thread_pk"],
        )

    def get_serializer_class(self):
        if self.action == "create":
            return MessageCreateSerializer
        return MessageSerializer

    def get_queryset(self):
        """The thread's messages; a guardian or student never sees an internal note."""
        queryset = Message.objects.filter(thread=self.thread)
        if self.restricted:
            queryset = queryset.filter(is_internal_note=False)
        return queryset

    @extend_schema(request=MessageCreateSerializer, responses={201: MessageSerializer})
    def create(self, request: Request, *args, **kwargs) -> Response:
        """`POST /message-threads/{thread_pk}/messages` — a reply.

        Not audited: the message is itself an immutable, attributed record
        (append-only `messages`), so an audit row would only copy it.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        attachments = data["attachments"]

        message = post_message(
            thread=self.thread,
            sender=request.user,
            body=data["body"],
            # The JSON column stores ids as strings, as `participant_user_ids` does.
            attachments=[str(file_id) for file_id in attachments] if attachments else None,
            is_internal_note=data["is_internal_note"],
        )
        return Response({"data": MessageSerializer(message).data}, status=201)
