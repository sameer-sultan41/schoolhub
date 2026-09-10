"""`announcements/views/publish.py` — the `:publish` action mixin."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.action_mixin import ActionMixinBase
from apps.communication.announcements.serializers import AnnouncementSerializer
from apps.communication.announcements.services.publish import publish_announcement
from core.api.viewsets import ActionResponse
from core.audit.services import record_audit


class PublishActionMixin(ActionMixinBase):
    @extend_schema(request=None, responses={200: AnnouncementSerializer})
    def publish(self, request: Request, pk: str | None = None) -> Response:
        """`POST /announcements/{id}:publish`."""
        instance = self.get_object()
        before = self.get_serializer(instance).data
        published = publish_announcement(instance, actor_id=request.user.pk)
        after = self.get_serializer(published).data
        record_audit(request, "publish", published, before=before, after=after)
        return ActionResponse.ok(after, message="Announcement published.")
