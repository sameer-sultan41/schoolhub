"""Authentication endpoints.

These sit outside the tenant middleware's requirements: a user must be able to
authenticate before a tenant context exists. The tenant is derived from the account
and carried in the token thereafter.

Cookie contract (matches apps/dashboard/src/lib/auth.ts and packages/api-client):
  - The access token never touches a cookie — it's returned in the JSON body only,
    for the SPA to hold in memory.
  - ``REFRESH_COOKIE_NAME`` carries the rotating refresh token. HttpOnly, scoped to
    ``REFRESH_COOKIE_PATH`` so it's only ever sent to the auth endpoints that need it.
    Host-only (no explicit Domain): every refresh call targets this API's own fixed
    host regardless of which dashboard subdomain the browser tab is on, so it never
    needs to cross a subdomain boundary.
  - The dashboard's own presence-only session marker (``sh_session``, read by its Next
    proxy) is deliberately **not** set here. This API's own host and the dashboard's
    host are never the same host once tenant subdomains are involved
    (``<slug>.PLATFORM_DOMAIN:3000`` vs. this API's fixed host), so sharing it would
    need an explicit ``Domain`` — which browsers reject outright when PLATFORM_DOMAIN
    has no dot, as "localhost" does in local dev (RFC 6265's public-suffix check
    treats a single-label host as its own effective TLD, the same rule that blocks
    ``Domain=.com``). The dashboard sets and clears that cookie itself instead, from
    JS already running on whichever host the browser is on — see
    ``apps/dashboard/src/lib/auth.ts``.
"""

from __future__ import annotations

import contextlib
from datetime import timedelta
from typing import cast

from django.conf import settings
from django.http import HttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from core.api.throttling import AuthEndpointThrottle
from core.audit.services import record_security_event
from core.rbac.serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    UserSerializer,
)

REFRESH_COOKIE_NAME = "sh_refresh"
REFRESH_COOKIE_PATH = "/api/v1/auth"


def _access_token_lifetime_seconds() -> int:
    lifetime = cast(timedelta, settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"])
    return int(lifetime.total_seconds())


def _refresh_token_lifetime_seconds() -> int:
    lifetime = cast(timedelta, settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"])
    return int(lifetime.total_seconds())


def _set_auth_cookies(response: HttpResponse, *, refresh_token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        refresh_token,
        max_age=_refresh_token_lifetime_seconds(),
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        # secure=False only in DEBUG: local dev serves plain HTTP, and a Secure cookie
        # is silently dropped by the browser over HTTP.
        secure=not settings.DEBUG,
        samesite="Lax",
    )


def _clear_auth_cookies(response: HttpResponse) -> None:
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [AuthEndpointThrottle]
    serializer_class = LoginSerializer

    @extend_schema(request=LoginSerializer, responses={200: UserSerializer})
    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            record_security_event(
                request, "auth.login.failed", identifier=request.data.get("identifier")
            )
            return Response(
                {
                    "error": {
                        "code": "invalid_credentials",
                        "message": "Incorrect credentials.",
                        "details": [],
                        "request_id": getattr(request, "request_id", None),
                    }
                },
                status=status.HTTP_401_UNAUTHORIZED,
            )

        record_security_event(request, "auth.login.succeeded")
        validated = serializer.validated_data
        response = Response(
            {
                "data": {
                    "access_token": validated["access"],
                    "expires_in": _access_token_lifetime_seconds(),
                    "user": validated["user"],
                }
            }
        )
        _set_auth_cookies(response, refresh_token=validated["refresh"])
        return response


class RefreshView(APIView):
    """Rotating refresh. Reuse of a rotated token invalidates the family (theft detection).

    The refresh token travels only in ``REFRESH_COOKIE_NAME`` — never in the request
    body — so this cannot reuse ``TokenRefreshView`` (which reads the body) even though
    it delegates the actual rotation logic to simplejwt's own serializer.
    """

    permission_classes = [AllowAny]
    throttle_classes = [AuthEndpointThrottle]

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        raw_token = request.COOKIES.get(REFRESH_COOKIE_NAME)
        if not raw_token:
            return Response(status=status.HTTP_401_UNAUTHORIZED)

        serializer = TokenRefreshSerializer(data={"refresh": raw_token})
        try:
            serializer.is_valid(raise_exception=True)
        except InvalidToken, TokenError:
            response = Response(status=status.HTTP_401_UNAUTHORIZED)
            _clear_auth_cookies(response)
            return response

        response = Response(
            {
                "data": {
                    "access_token": serializer.validated_data["access"],
                    "expires_in": _access_token_lifetime_seconds(),
                }
            }
        )
        _set_auth_cookies(response, refresh_token=serializer.validated_data["refresh"])
        return response


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        raw_token = request.COOKIES.get(REFRESH_COOKIE_NAME)
        if raw_token:
            # An already-invalid token means the session is gone, which is the
            # outcome the caller wanted; surfacing an error helps nobody.
            with contextlib.suppress(TokenError):
                RefreshToken(raw_token).blacklist()
        record_security_event(request, "auth.logout")
        response = Response(status=status.HTTP_204_NO_CONTENT)
        _clear_auth_cookies(response)
        return response


class MeView(APIView):
    """The authenticated principal, with effective permissions for UI gating."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: UserSerializer})
    def get(self, request):
        return Response({"data": UserSerializer(request.user).data})


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [AuthEndpointThrottle]

    @extend_schema(request=ChangePasswordSerializer, responses={204: None})
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        record_security_event(request, "auth.password.changed")
        return Response(status=status.HTTP_204_NO_CONTENT)
