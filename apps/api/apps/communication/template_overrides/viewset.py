"""`NotificationTemplateOverrideViewSet` — request handling for `/notification-templates`.

Thin: every rule lives in `services/validate.py`/`services/resolve.py`. See
`notices/viewset.py`'s own docstring for why actions stay as plain methods
on this one class rather than a further mixin-per-action split.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.models import NotificationTemplateOverride
from apps.communication.permission_classes import FEATURE, STAFF_PERMISSIONS
from apps.communication.template_overrides.filters import NotificationTemplateOverrideFilterSet
from apps.communication.template_overrides.serializers import (
    NotificationTemplateOverrideSerializer,
    NotificationTemplatePreviewSerializer,
)
from apps.communication.template_overrides.services.resolve import template_from_override
from core.api.viewsets import TenantScopedViewSetMixin


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
