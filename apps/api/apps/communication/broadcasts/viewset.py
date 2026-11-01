"""`BroadcastViewSet` — `GET /broadcasts:scope`, `POST /broadcasts:preview` and
`POST /broadcasts:emergency`.

Thin: where the caller may broadcast is `services/scope.py`, what a broadcast
would reach is `services/preview.py`, the confirmed send is `services/dispatch.py`,
and the fan-out is `tasks.send_emergency_broadcast_task`.
"""

from __future__ import annotations

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.broadcasts.serializers import (
    BroadcastPreviewResponseSerializer,
    BroadcastQueuedResponseSerializer,
    BroadcastRequestSerializer,
    BroadcastScopeResponseSerializer,
    BroadcastScopeSerializer,
    BroadcastSendSerializer,
)
from apps.communication.broadcasts.services.dispatch import dispatch_emergency_broadcast
from apps.communication.broadcasts.services.preview import preview_broadcast
from apps.communication.broadcasts.services.scope import (
    assert_sender_may_target,
    sender_campus_ids,
)
from apps.communication.permission_classes import FEATURE, STAFF_PERMISSIONS
from apps.communication.permissions import BROADCAST_SEND
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.idempotency.services import replay_or_execute

EMERGENCY_IDEMPOTENCY_ENDPOINT = "broadcasts:emergency"


class BroadcastViewSet(TenantScopedViewSetMixin, viewsets.GenericViewSet):
    """Staff-only: `STAFF_PERMISSIONS` refuses a guardian or student even if a role
    grants them the key.

    No table of its own, so `scope_campus_field = None` and `scope_queryset` never
    runs. The sender's record scope is enforced on the audience instead, by
    `assert_sender_may_target`, in both POST actions; `scope` reads the same rule.
    """

    permission_classes = STAFF_PERMISSIONS
    serializer_class = BroadcastRequestSerializer
    scope_campus_field = None
    required_feature = FEATURE
    # Previewing reads who would be reached — still only for those who may send.
    required_permission = BROADCAST_SEND
    required_permission_map = {
        # A read of the caller's own sending scope; mapped explicitly, not left to the fallback.
        "scope": BROADCAST_SEND,
    }
    # Colon actions only: `scope` is a GET, the rest are POSTs.
    http_method_names = ["get", "post", "head", "options"]

    @extend_schema(
        summary="The campuses the caller may broadcast to",
        responses={200: BroadcastScopeResponseSerializer},
    )
    def scope(self, request: Request) -> Response:
        """`GET /broadcasts:scope` — `campus_ids` is null when unrestricted.

        `sender_campus_ids`, the rule `preview` and `emergency` enforce, so the
        screen can offer only the campuses a send will accept. An empty list is
        a 200, not a 404: this reads the caller's own capability, not a record.
        """
        allowed = sender_campus_ids(request.user)
        campus_ids = None if allowed is None else sorted(allowed, key=str)
        return ActionResponse.ok(BroadcastScopeSerializer({"campus_ids": campus_ids}).data)

    @extend_schema(
        summary="Preview an emergency broadcast's audience and channels",
        request=BroadcastRequestSerializer,
        responses={
            200: BroadcastPreviewResponseSerializer,
            404: OpenApiResponse(
                description=(
                    "A targeting id is not this school's, `campus_id` (or a named user) "
                    "is outside a campus-scoped sender's campuses, or the sender's scope "
                    "reaches no campus at all."
                )
            ),
            422: OpenApiResponse(
                description=(
                    "The audience resolves to nobody, or a campus-scoped sender gave no "
                    "`campus_id`."
                )
            ),
        },
    )
    def preview(self, request: Request) -> Response:
        """`POST /broadcasts:preview` — the count, digest and channels a send must repeat back."""
        serializer = BroadcastRequestSerializer(
            data=request.data, context={"tenant_id": request.tenant.pk}
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        self._assert_in_scope(request, data)
        result = preview_broadcast(
            tenant_id=request.tenant.pk,
            audience_type=data["audience_type"],
            audience_filter=data["audience_filter"],
            campus_id=data["campus_id"],
        )
        return ActionResponse.ok(result)

    @extend_schema(
        summary="Send an emergency broadcast",
        request=BroadcastSendSerializer,
        responses={
            202: BroadcastQueuedResponseSerializer,
            404: OpenApiResponse(
                description=(
                    "A targeting id is not this school's, `campus_id` (or a named user) "
                    "is outside a campus-scoped sender's campuses, or the sender's scope "
                    "reaches no campus at all."
                )
            ),
            409: OpenApiResponse(
                description=(
                    "`audience_changed`: the count or digest no longer matches; "
                    "`error.meta` carries the current `recipient_count` and `audience_digest`."
                )
            ),
            422: OpenApiResponse(
                description=(
                    "The audience resolves to nobody, or a campus-scoped sender gave no "
                    "`campus_id`; or `idempotency_key_reused`: the `Idempotency-Key` was "
                    "already used with a different body."
                )
            ),
        },
    )
    def emergency(self, request: Request) -> Response:
        """`POST /broadcasts:emergency` — 202 + job; poll `GET /jobs/{id}`.

        Accepts `Idempotency-Key`: a repeat with the same body within 24 hours
        replays the first 202 and its `job_id`; the same key with a different body
        (a corrected message) is a 422. A 409 is raised, not returned, so it is
        never stored and a retry with the same key re-checks the audience.
        """
        serializer = BroadcastSendSerializer(
            data=request.data, context={"tenant_id": request.tenant.pk}
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        self._assert_in_scope(request, data)

        def execute() -> Response:
            job = dispatch_emergency_broadcast(request=request, data=data)
            return ActionResponse.accepted(str(job.pk), message="Emergency broadcast queued.")

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint=EMERGENCY_IDEMPOTENCY_ENDPOINT,
            request_data=request.data,
            execute=execute,
        )

    @staticmethod
    def _assert_in_scope(request: Request, data: dict) -> None:
        assert_sender_may_target(
            user=request.user,
            tenant_id=request.tenant.pk,
            audience_type=data["audience_type"],
            audience_filter=data["audience_filter"],
            campus_id=data["campus_id"],
        )
