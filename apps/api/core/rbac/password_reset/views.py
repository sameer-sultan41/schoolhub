"""``POST /auth/password-reset`` and ``POST /auth/password-reset:confirm``."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response

from core.api.throttling import PasswordResetEmailThrottle, PasswordResetIPThrottle
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
    """Ask for a password-reset link by email.

    Unauthenticated. Answers 204 to every well-formed body, whether or not the address
    has an account, so the answer reveals nothing; a link goes only to an active member
    of the named school.
    """

    throttle_classes = [PasswordResetIPThrottle, PasswordResetEmailThrottle]

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
    """Set a new password from a reset link, and sign out every device.

    Unauthenticated. A password the validators refuse is 400 `validation_error`; an
    unusable link (wrong school, used or expired token, inactive account) is 400
    `invalid_link`.
    """

    throttle_classes = [PasswordResetIPThrottle]

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
