"""`notices/views/acknowledge.py` — the `:acknowledge` action mixin."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.action_mixin import ActionMixinBase
from apps.communication.notices.services.acknowledge import acknowledge_notice
from core.api.viewsets import ActionResponse


class AcknowledgeActionMixin(ActionMixinBase):
    @extend_schema(request=None, responses={200: None})
    def acknowledge(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notices/{id}:acknowledge`. Idempotent — see `services.acknowledge_notice`."""
        instance = self.get_object()
        acknowledge_notice(instance, actor_id=request.user.pk)
        return ActionResponse.ok({}, message="Acknowledged.")
