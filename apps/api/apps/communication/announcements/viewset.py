"""Assembles `AnnouncementViewSet` from its per-action mixins under `views/` —
same composition mechanism as `notices.viewset.NoticeViewSet`.
"""

from __future__ import annotations

from rest_framework import viewsets

from apps.communication.announcements.filters import AnnouncementFilterSet
from apps.communication.announcements.serializers import AnnouncementSerializer
from apps.communication.announcements.views.publish import PublishActionMixin
from apps.communication.models import Announcement
from apps.communication.permission_classes import FEATURE, STAFF_PERMISSIONS
from core.api.viewsets import TenantScopedViewSetMixin


class AnnouncementViewSet(PublishActionMixin, TenantScopedViewSetMixin, viewsets.ModelViewSet):
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
