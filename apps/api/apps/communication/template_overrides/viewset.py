"""Assembles `NotificationTemplateOverrideViewSet` from its per-action mixins
under `views/` — same composition mechanism as `notices.viewset.NoticeViewSet`.
"""

from __future__ import annotations

from rest_framework import viewsets

from apps.communication.models import NotificationTemplateOverride
from apps.communication.permission_classes import FEATURE, STAFF_PERMISSIONS
from apps.communication.template_overrides.filters import NotificationTemplateOverrideFilterSet
from apps.communication.template_overrides.serializers import NotificationTemplateOverrideSerializer
from apps.communication.template_overrides.views.preview import PreviewActionMixin
from core.api.viewsets import TenantScopedViewSetMixin


class NotificationTemplateOverrideViewSet(
    PreviewActionMixin, TenantScopedViewSetMixin, viewsets.ModelViewSet
):
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
