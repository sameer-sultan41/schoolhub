"""`POST /notices/{id}:submit`."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.action_mixin import ActionMixinBase
from apps.communication.notices.serializers import NoticeSerializer
from apps.communication.notices.services.submit import submit_notice
from core.api.viewsets import ActionResponse
from core.audit.services import record_audit


class SubmitActionMixin(ActionMixinBase):
    @extend_schema(request=None, responses={200: NoticeSerializer})
    def submit(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notices/{id}:submit` — draft -> pending_approval."""
        instance = self.get_object()
        before = self.get_serializer(instance).data
        submitted = submit_notice(instance, actor_id=request.user.pk)
        after = self.get_serializer(submitted).data
        record_audit(request, "submit", submitted, before=before, after=after)
        return ActionResponse.ok(after, message="Notice submitted for approval.")
