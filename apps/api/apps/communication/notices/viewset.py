"""Assembles `NoticeViewSet` from its per-action mixins under `views/` — one
small file per capability, composed here via multiple inheritance (DRF's own
idiom for exactly this: it's how `mixins.ListModelMixin`/`CreateModelMixin`
already work). `apps/communication/urls.py` registers only this one class,
exactly as it registered the monolithic `NoticeViewSet` before this split —
routing and permissions are unchanged.
"""

from __future__ import annotations

from rest_framework import viewsets

from apps.communication.models import Notice
from apps.communication.notices.filters import NoticeFilterSet
from apps.communication.notices.serializers import NoticeSerializer
from apps.communication.notices.views.acknowledge import AcknowledgeActionMixin
from apps.communication.notices.views.download import DownloadActionMixin
from apps.communication.notices.views.publish import PublishActionMixin
from apps.communication.notices.views.return_to_draft import ReturnToDraftActionMixin
from apps.communication.notices.views.submit import SubmitActionMixin
from apps.communication.permission_classes import (
    FEATURE,
    OWN_PREFERENCE_PERMISSIONS,
    STAFF_PERMISSIONS,
)
from core.api.viewsets import TenantScopedViewSetMixin


class NoticeViewSet(
    SubmitActionMixin,
    PublishActionMixin,
    ReturnToDraftActionMixin,
    AcknowledgeActionMixin,
    DownloadActionMixin,
    TenantScopedViewSetMixin,
    viewsets.ModelViewSet,
):
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
