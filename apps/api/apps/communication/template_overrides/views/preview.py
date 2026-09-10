"""`template_overrides/views/preview.py` — the `:preview` action mixin."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.action_mixin import ActionMixinBase
from apps.communication.models import NotificationTemplateOverride
from apps.communication.template_overrides.serializers import NotificationTemplatePreviewSerializer
from apps.communication.template_overrides.services.resolve import template_from_override


class PreviewActionMixin(ActionMixinBase):
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
