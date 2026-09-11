"""`NoticeViewSet` — request handling for `/notices`.

Thin: every rule lives in `services/<action>.py` (`notices/services/submit.py`,
`publish.py`, `return_to_draft.py`, `acknowledge.py`), one function per action
— this resource has five genuinely distinct state transitions, each worth its
own file, independently unit-testable and reusable outside HTTP. Sibling
resource packages split `services/` at whatever granularity their own actions
warrant (`preferences/services/` groups by concern rather than one file per
function, since it has none of this kind of per-action state machine); this
file's own shape isn't a claim that every package matches it. `viewset.py`
itself stays one file per resource everywhere, matching the convention the
HackSoft Django Styleguide itself uses, rather than a further mixin-per-action
split on the view side, which buys little here since a `ViewSet` already
gives every action a clearly-bounded method.
"""

from __future__ import annotations

from django.http import HttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.models import Notice
from apps.communication.notices import documents
from apps.communication.notices.filters import NoticeFilterSet
from apps.communication.notices.serializers import NoticeSerializer
from apps.communication.notices.services.acknowledge import acknowledge_notice
from apps.communication.notices.services.publish import publish_notice
from apps.communication.notices.services.return_to_draft import return_notice_to_draft
from apps.communication.notices.services.submit import submit_notice
from apps.communication.permission_classes import (
    FEATURE,
    OWN_PREFERENCE_PERMISSIONS,
    STAFF_PERMISSIONS,
)
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit


class NoticeViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
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

    @extend_schema(request=None, responses={200: NoticeSerializer})
    def submit(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notices/{id}:submit` — draft -> pending_approval."""
        instance = self.get_object()
        before = self.get_serializer(instance).data
        submitted = submit_notice(instance, actor_id=request.user.pk)
        after = self.get_serializer(submitted).data
        record_audit(request, "submit", submitted, before=before, after=after)
        return ActionResponse.ok(after, message="Notice submitted for approval.")

    @extend_schema(request=None, responses={200: NoticeSerializer})
    def publish(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notices/{id}:publish` — pending_approval -> published."""
        instance = self.get_object()
        before = self.get_serializer(instance).data
        published = publish_notice(instance, actor_id=request.user.pk)
        after = self.get_serializer(published).data
        record_audit(request, "publish", published, before=before, after=after)
        return ActionResponse.ok(after, message="Notice published.")

    @extend_schema(request=None, responses={200: NoticeSerializer})
    def return_to_draft(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notices/{id}:return-to-draft` — pending_approval -> draft, with comments."""
        instance = self.get_object()
        before = self.get_serializer(instance).data
        returned = return_notice_to_draft(instance, actor_id=request.user.pk)
        after = self.get_serializer(returned).data
        record_audit(request, "return_to_draft", returned, before=before, after=after)
        return ActionResponse.ok(after, message="Notice returned to draft.")

    @extend_schema(request=None, responses={200: None})
    def acknowledge(self, request: Request, pk: str | None = None) -> Response:
        """`POST /notices/{id}:acknowledge`. Idempotent — see `services.acknowledge`."""
        instance = self.get_object()
        acknowledge_notice(instance, actor_id=request.user.pk)
        return ActionResponse.ok({}, message="Acknowledged.")

    @extend_schema(responses={200: None})
    def download(self, request: Request, pk: str | None = None) -> Response:
        """`GET /notices/{id}/download` — the notice rendered as a PDF document."""
        instance = self.get_object()
        data = documents.render_notice(notice=instance, school_name=request.tenant.name)
        response = HttpResponse(data, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'inline; filename="notice-{instance.notice_no or instance.pk}.pdf"'
        )
        return response
