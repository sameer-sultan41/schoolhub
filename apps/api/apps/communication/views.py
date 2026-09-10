"""HTTP layer for the communication module. Thin: every rule lives in `services`."""

from __future__ import annotations

from django.http import HttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.communication import documents, reports, services
from apps.communication.filters import (
    AnnouncementFilterSet,
    DeliveryLogFilterSet,
    NoticeFilterSet,
    NotificationTemplateOverrideFilterSet,
)
from apps.communication.models import Announcement, Notice, NotificationTemplateOverride
from apps.communication.serializers import (
    AnnouncementSerializer,
    DeliveryLogSerializer,
    DeliveryReportResponseSerializer,
    NoticeSerializer,
    NotificationPreferenceRowSerializer,
    NotificationPreferenceUpdateSerializer,
    NotificationTemplateOverrideSerializer,
    NotificationTemplatePreviewSerializer,
)
from apps.communication.templates_service import template_from_override
from core.api.exceptions import DomainRuleViolation
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.notifications.models import DeliveryLog
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

    @extend_schema(request=None, responses={200: NotificationTemplatePreviewSerializer})
    def preview(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notification-templates/{id}:preview` — renders with sample data.

        Never persists. Sample values are `[variable]`, one per declared
        placeholder, so a missing-variable render error (the real renderer's
        loudest failure mode) can never happen here — every declared variable
        always has a value, which is the point of a preview.
        """
        instance: NotificationTemplateOverride = self.get_object()
        template = template_from_override(instance)
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

    @extend_schema(responses={200: DeliveryReportResponseSerializer})
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


class AnnouncementViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/announcements` — feed-style posts with audience targeting.

    §3 does not list guardians/students among announcement authors, approvers
    or browsers of drafts — drafting, publishing and this endpoint's own reads
    are staff-only; `communication.announcement.view`'s default roles (§4)
    already narrow who actually holds the key.
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = Announcement.objects
    serializer_class = AnnouncementSerializer
    filterset_class = AnnouncementFilterSet
    search_fields = ["title", "body"]
    ordering_fields = ["publish_at", "created_at"]
    scope_campus_field = "campus_id"
    scope_campus_allows_null = True
    required_feature = FEATURE
    required_permission = "communication.announcement.view"
    required_permission_map = {
        "create": "communication.announcement.create",
        "update": "communication.announcement.update",
        "partial_update": "communication.announcement.update",
        "destroy": "communication.announcement.delete",
        "publish": "communication.announcement.publish",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    @extend_schema(request=None, responses={200: AnnouncementSerializer})
    def publish(self, request: Request, pk: str | None = None) -> Response:
        """`POST /announcements/{id}:publish`."""
        instance = self.get_object()
        before = self.get_serializer(instance).data
        published = services.publish_announcement(instance, actor_id=request.user.pk)
        after = self.get_serializer(published).data
        record_audit(request, "publish", published, before=before, after=after)
        return ActionResponse.ok(after, message="Announcement published.")


class NoticeViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/notices` — formal, sequence-numbered notices with a publish-approval gate.

    No `campus_id` column on this table (entities/communication.md) —
    `scope_campus_field = None`, stated explicitly rather than left at the
    mixin's default `campus_id`, which does not exist here.
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = Notice.objects
    serializer_class = NoticeSerializer
    filterset_class = NoticeFilterSet
    search_fields = ["title", "body", "notice_no"]
    ordering_fields = ["publish_at", "created_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "communication.notice.view"
    required_permission_map = {
        "create": "communication.notice.create",
        "update": "communication.notice.update",
        "partial_update": "communication.notice.update",
        "submit": "communication.notice.update",
        "publish": "communication.notice.publish",
        "return_to_draft": "communication.notice.publish",
        "acknowledge": "communication.notice.acknowledge",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        # `communication.notice.acknowledge` is held by guardians/students
        # (§4) — `STAFF_PERMISSIONS`' `DenyRestrictedPrincipals` would block
        # every one of them before `HasPermissionKey` is even consulted.
        if self.action == "acknowledge":
            return [permission() for permission in OWN_PREFERENCE_PERMISSIONS]
        return [permission() for permission in STAFF_PERMISSIONS]

    @extend_schema(request=None, responses={200: NoticeSerializer})
    def return_to_draft(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notices/{id}:return-to-draft` — pending_approval -> draft, with comments."""
        instance = self.get_object()
        before = self.get_serializer(instance).data
        returned = services.return_notice_to_draft(instance, actor_id=request.user.pk)
        after = self.get_serializer(returned).data
        record_audit(request, "return_to_draft", returned, before=before, after=after)
        return ActionResponse.ok(after, message="Notice returned to draft.")

    @extend_schema(responses={200: None})
    def download(self, request: Request, pk: str | None = None) -> Response:
        """`GET /notices/{id}/download` — the notice rendered as a PDF document."""
        instance = self.get_object()
        data = documents.render_notice(notice=instance, school_name=request.tenant.name)
        response = HttpResponse(data, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'inline; filename="notice-{instance.notice_no or instance.pk}.pdf"'
        )
        return response

    @extend_schema(request=None, responses={200: NoticeSerializer})
    def submit(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notices/{id}:submit` — draft -> pending_approval."""
        instance = self.get_object()
        before = self.get_serializer(instance).data
        submitted = services.submit_notice(instance, actor_id=request.user.pk)
        after = self.get_serializer(submitted).data
        record_audit(request, "submit", submitted, before=before, after=after)
        return ActionResponse.ok(after, message="Notice submitted for approval.")

    @extend_schema(request=None, responses={200: NoticeSerializer})
    def publish(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notices/{id}:publish` — pending_approval -> published."""
        instance = self.get_object()
        before = self.get_serializer(instance).data
        published = services.publish_notice(instance, actor_id=request.user.pk)
        after = self.get_serializer(published).data
        record_audit(request, "publish", published, before=before, after=after)
        return ActionResponse.ok(after, message="Notice published.")

    @extend_schema(request=None, responses={200: None})
    def acknowledge(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notices/{id}:acknowledge`. Idempotent — see `services.acknowledge_notice`."""
        instance = self.get_object()
        services.acknowledge_notice(instance, actor_id=request.user.pk)
        return ActionResponse.ok({}, message="Acknowledged.")
