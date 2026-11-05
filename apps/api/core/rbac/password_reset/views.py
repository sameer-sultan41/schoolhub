"""``POST /auth/password-reset`` and ``POST /auth/password-reset:confirm``."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response

from core.audit.services import record_security_event
from core.rbac.account_links import tenant_for_slug
from core.rbac.link_views import EmailedLinkView
from core.rbac.password_reset import services
from core.rbac.password_reset.serializers import (
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
)
from core.tenancy.context import tenant_context


class PasswordResetView(EmailedLinkView):
    """204 for every well-formed body, so the answer says nothing about the address."""

    @extend_schema(request=PasswordResetRequestSerializer, responses={204: None})
    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # An unknown school queues nothing but answers the same; the task looks up the user.
        tenant = tenant_for_slug(serializer.validated_data["school"])
        if tenant is not None:
            services.request_password_reset(tenant=tenant, email=serializer.validated_data["email"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordResetConfirmView(EmailedLinkView):
    @extend_schema(request=PasswordResetConfirmSerializer, responses={204: None})
    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        tenant = self.link_tenant(request, data["school"])
        with tenant_context(tenant.id):
            user = services.confirm_password_reset(
                tenant=tenant,
                uid=data["uid"],
                token=data["token"],
                new_password=data["new_password"],
            )
        record_security_event(request, "auth.password.reset", tenant=tenant, user_id=str(user.id))
        return Response(status=status.HTTP_204_NO_CONTENT)
