"""HTTP layer for the communication module. Thin: every rule lives in `services`."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.communication import reports, services
from apps.communication.filters import DeliveryLogFilterSet, NotificationTemplateOverrideFilterSet
from apps.communication.models import NotificationTemplateOverride
from apps.communication.serializers import (
    DeliveryLogSerializer,
    NotificationPreferenceRowSerializer,
    NotificationPreferenceUpdateSerializer,
    NotificationTemplateOverrideSerializer,
    NotificationTemplatePreviewSerializer,
)
from core.api.exceptions import DomainRuleViolation
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import TenantScopedViewSetMixin
from core.notifications.models import DeliveryLog
from core.notifications.templates import NotificationTemplate
from core.rbac.permissions import DenyRestrictedPrincipals, HasPermissionKey

FEATURE = "module.communication"

# The delivery dashboard and template management are staff-only — §3 does not
# list guardians/students among this pair's users.
STAFF_PERMISSIONS = [
    IsAuthenticated,
    RequiresModuleFeature,
    HasPermissionKey,
    DenyRestrictedPrincipals,
]

# Every tenant role reaches `NotificationPreferenceView` — §4's "all roles
# (scope own)" — including guardians and students managing their own channels.
OWN_PREFERENCE_PERMISSIONS = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]


class NotificationTemplateOverrideViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/notification-templates` — tenant overrides of the platform defaults."""

    permission_classes = STAFF_PERMISSIONS
    queryset = NotificationTemplateOverride.objects
    serializer_class = NotificationTemplateOverrideSerializer
    filterset_class = NotificationTemplateOverrideFilterSet
    search_fields = ["code", "name"]
    ordering_fields = ["code", "channel", "created_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "communication.template.view"
    required_permission_map = {
        "create": "communication.template.update",
        "update": "communication.template.update",
        "partial_update": "communication.template.update",
        "destroy": "communication.template.update",
        "preview": "communication.template.view",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    @extend_schema(responses={200: NotificationTemplatePreviewSerializer})
    def preview(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notification-templates/{id}:preview` — renders with sample data.

        Never persists. Sample values are `[variable]`, one per declared
        placeholder, so a missing-variable render error (the real renderer's
        loudest failure mode) can never happen here — every declared variable
        always has a value, which is the point of a preview.
        """
        instance: NotificationTemplateOverride = self.get_object()
        template = NotificationTemplate(
            code=instance.code,
            channel=instance.channel,
            subject=instance.subject,
            body=instance.body,
            variables=frozenset(instance.variables),
        )
        sample_context: dict[str, object] = {
            variable: f"[{variable}]" for variable in instance.variables
        }
        subject, body = template.render(sample_context)
        return Response(
            NotificationTemplatePreviewSerializer({"subject": subject or None, "body": body}).data
        )


class NotificationPreferenceView(TenantScopedViewSetMixin, APIView):
    """`GET/PATCH /notification-preferences` — the caller's own channel matrix.

    No `pk` in the path: this always resolves to `request.user`. §4 grants the
    key to every tenant role at `own` scope, and "own" here means "the caller,
    always" — there is no other user's matrix this endpoint could address.

    `TenantScopedViewSetMixin` is mixed in for its `initial()`/`finalize_response()`
    tenant binding alone — a plain `APIView` never gets `request.tenant` under real
    JWT auth (only `TenantMiddleware`, session-only, and this mixin's `initial()`
    ever set it; see the mixin's own docstring). Without it every real request 403s:
    `RequiresModuleFeature` fails closed on `request.tenant is None`. The mixin's
    other methods (`get_queryset`, `perform_create`) are `GenericAPIView`-only and
    are never called here, so nothing else about mixing it into a bare `APIView`
    matters.
    """

    permission_classes = OWN_PREFERENCE_PERMISSIONS
    required_feature = FEATURE
    required_permission = "communication.notification-preference.update"

    @extend_schema(responses={200: NotificationPreferenceRowSerializer(many=True)})
    def get(self, request: Request) -> Response:
        matrix = services.materialize_preference_matrix(
            user_id=request.user.pk, tenant_id=request.tenant.pk
        )
        return Response(NotificationPreferenceRowSerializer(matrix, many=True).data)

    @extend_schema(
        request=NotificationPreferenceUpdateSerializer(many=True),
        responses={200: NotificationPreferenceRowSerializer(many=True)},
    )
    def patch(self, request: Request) -> Response:
        serializer = NotificationPreferenceUpdateSerializer(
            data=request.data if isinstance(request.data, list) else [request.data], many=True
        )
        serializer.is_valid(raise_exception=True)
        services.save_preferences(
            user_id=request.user.pk, tenant_id=request.tenant.pk, rows=serializer.validated_data
        )
        matrix = services.materialize_preference_matrix(
            user_id=request.user.pk, tenant_id=request.tenant.pk
        )
        return Response(NotificationPreferenceRowSerializer(matrix, many=True).data)


class DeliveryLogViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`/delivery-logs` — the delivery dashboard, read-only.

    List/retrieve only: nothing here should let a caller edit delivery
    history, and every write to this table already happens inside
    `core.notifications` (`notify()`, `deliver_notifications`).
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = DeliveryLog.objects
    serializer_class = DeliveryLogSerializer
    filterset_class = DeliveryLogFilterSet
    ordering_fields = ["created_at", "last_attempt_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "communication.delivery-log.view"
    required_permission_map = {"summary": "communication.delivery-log.view"}
    http_method_names = ["get", "head", "options"]

    @extend_schema(responses={200: None})
    def summary(self, request: Request) -> Response:
        """`GET /delivery-logs:summary?group_by=channel|status|provider` — §13's delivery report."""
        group_by = request.query_params.get("group_by", "channel")
        if group_by not in reports.GROUP_BY_FIELDS:
            raise DomainRuleViolation(
                f"group_by must be one of {sorted(reports.GROUP_BY_FIELDS)}.",
                meta={"group_by": group_by},
            )
        rows = reports.delivery_report(self.filter_queryset(self.get_queryset()), group_by=group_by)
        return Response({"data": rows})
