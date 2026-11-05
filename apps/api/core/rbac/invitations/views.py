"""``POST /auth/invitations:preview`` and ``POST /auth/invitations:accept``."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response

from core.api.throttling import InvitationIPThrottle
from core.audit.services import record_security_event
from core.rbac.invitations import services
from core.rbac.invitations.serializers import (
    InvitationAcceptSerializer,
    InvitationLinkSerializer,
    InvitationPreviewSerializer,
)
from core.rbac.link_views import EmailedLinkView
from core.tenancy.context import tenant_context


class InvitationPreviewView(EmailedLinkView):
    """Show who an invitation is for and which school sent it, before a password is set.

    Unauthenticated. Any unusable link (unknown school, unknown, used, revoked or expired
    token) is 400 `invalid_link`.
    """

    throttle_classes = [InvitationIPThrottle]

    @extend_schema(request=InvitationLinkSerializer, responses={200: InvitationPreviewSerializer})
    def post(self, request):
        serializer = InvitationLinkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tenant = self.link_tenant(request, serializer.validated_data["school"])
        with tenant_context(tenant.id):
            preview = services.preview_invitation(
                tenant=tenant, raw_token=serializer.validated_data["token"]
            )
        return Response({"data": InvitationPreviewSerializer(preview).data})


class InvitationAcceptView(EmailedLinkView):
    """Accept an invitation: set a password and activate the account.

    Unauthenticated. A password the validators refuse is 400 `validation_error`; any
    unusable link is 400 `invalid_link`.
    """

    throttle_classes = [InvitationIPThrottle]

    @extend_schema(request=InvitationAcceptSerializer, responses={204: None})
    def post(self, request):
        serializer = InvitationAcceptSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tenant = self.link_tenant(request, serializer.validated_data["school"])
        with tenant_context(tenant.id):
            user = services.accept_invitation(
                tenant=tenant,
                raw_token=serializer.validated_data["token"],
                password=serializer.validated_data["password"],
            )
        record_security_event(
            request, "auth.invitation.accepted", tenant=tenant, user_id=str(user.id)
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
