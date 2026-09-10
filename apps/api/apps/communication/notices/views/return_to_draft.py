"""`POST /notices/{id}:return-to-draft`."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.notices.serializers import NoticeSerializer
from apps.communication.notices.services.return_to_draft import return_notice_to_draft
from core.api.viewsets import ActionResponse
from core.audit.services import record_audit


class ReturnToDraftActionMixin:
    @extend_schema(request=None, responses={200: NoticeSerializer})
    def return_to_draft(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notices/{id}:return-to-draft` — pending_approval -> draft, with comments."""
        instance = self.get_object()
        before = self.get_serializer(instance).data
        returned = return_notice_to_draft(instance, actor_id=request.user.pk)
        after = self.get_serializer(returned).data
        record_audit(request, "return_to_draft", returned, before=before, after=after)
        return ActionResponse.ok(after, message="Notice returned to draft.")
