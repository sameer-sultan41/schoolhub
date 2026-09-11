"""`AnnouncementViewSet` — request handling for `/announcements`.

Thin: every rule lives in `services/publish.py`. See `notices/viewset.py`'s
own docstring for why actions stay as plain methods on this one class
rather than a further mixin-per-action split.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.announcements.filters import AnnouncementFilterSet
from apps.communication.announcements.serializers import AnnouncementSerializer
from apps.communication.announcements.services.publish import publish_announcement
from apps.communication.models import Announcement
from apps.communication.permission_classes import FEATURE, STAFF_PERMISSIONS
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit


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
        published = publish_announcement(instance, actor_id=request.user.pk)
        after = self.get_serializer(published).data
        record_audit(request, "publish", published, before=before, after=after)
        return ActionResponse.ok(after, message="Announcement published.")
