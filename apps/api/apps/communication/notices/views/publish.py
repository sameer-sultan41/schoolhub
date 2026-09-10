"""`POST /notices/{id}:publish`."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.notices.serializers import NoticeSerializer
from apps.communication.notices.services.publish import publish_notice
from core.api.viewsets import ActionResponse
from core.audit.services import record_audit


class PublishActionMixin:
    @extend_schema(request=None, responses={200: NoticeSerializer})
    def publish(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notices/{id}:publish` — pending_approval -> published."""
        instance = self.get_object()
        before = self.get_serializer(instance).data
        published = publish_notice(instance, actor_id=request.user.pk)
        after = self.get_serializer(published).data
        record_audit(request, "publish", published, before=before, after=after)
        return ActionResponse.ok(after, message="Notice published.")
