"""The school-side impersonation routes (§16), under ``/api/v1/auth/`` (ruling A6).

- ``POST auth/impersonation:exchange``: the school's dashboard trades the handoff code for the
  access token. Anonymous, like login, and throttled the same way.
- ``POST auth/impersonation:end``: the impersonated session releases its own grant.
"""

from __future__ import annotations

from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import exceptions
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.platform_admin.impersonation import events, services
from apps.platform_admin.impersonation.serializers import (
    ImpersonationExchangeResponseSerializer,
    ImpersonationExchangeSerializer,
)
from core.api.exceptions import InvalidLink, refusal_response
from core.api.throttling import AuthEndpointThrottle
from core.rbac.impersonation import end_impersonation, is_impersonated


class ImpersonationExchangeView(APIView):
    """Spend a handoff code (single use, ``PLATFORM_HANDOFF_CODE_TTL_SECONDS``) for
    ``{access, expires_in}``: an access token of the user, with no refresh token or cookie,
    that expires with the grant. An unknown, spent or expired code, or a grant that is no longer
    live, is a 400 ``invalid_link``.
    """

    # Anonymous: a stale token in the tab must not stop a new handoff.
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [AuthEndpointThrottle]

    @extend_schema(
        request=ImpersonationExchangeSerializer,
        responses={
            200: ImpersonationExchangeResponseSerializer,
            400: OpenApiResponse(description="invalid_link"),
        },
        auth=[],
    )
    def post(self, request: Request) -> Response:
        payload = ImpersonationExchangeSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        result = services.exchange(payload.validated_data["code"])
        grant, token = result.grant, result.token
        if token is None or grant is None:
            events.exchange_refused(request, result.grant)
            if result.revoked is not None:
                events.ended(result.revoked, request=request)
            # Returned, not raised: a raise would roll back the refusal's audit rows.
            return refusal_response(request, InvalidLink())
        events.exchanged(request, grant)
        expires_in = max(int((grant.expires_at - timezone.now()).total_seconds()), 0)
        return Response({"data": {"access": str(token), "expires_in": expires_in}})


class ImpersonationEndView(APIView):
    """End the impersonated session's own grant; 404 when the session is not impersonated."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=None, responses={204: None, 404: OpenApiResponse(description="not_found")}
    )
    def post(self, request: Request) -> Response:
        if not is_impersonated(request):
            raise exceptions.NotFound()
        end_impersonation(request)
        return Response(status=204)
