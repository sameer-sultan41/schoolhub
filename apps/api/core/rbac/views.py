"""Authentication endpoints.

These sit outside the tenant middleware's requirements: a user must be able to
authenticate before a tenant context exists. The tenant is derived from the account
and carried in the token thereafter.
"""

from __future__ import annotations

import contextlib

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from core.api.throttling import AuthEndpointThrottle
from core.audit.services import record_security_event
from core.rbac.serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    UserSerializer,
)


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
        return Response({"data": serializer.validated_data})


class RefreshView(TokenRefreshView):
    """Rotating refresh. Reuse of a rotated token invalidates the family (theft detection)."""

    # simplejwt annotates both of these as empty tuples, so any override is a type
    # error in the library's stubs rather than here.
    permission_classes = (AllowAny,)  # type: ignore[assignment]
    throttle_classes = (AuthEndpointThrottle,)  # type: ignore[assignment]


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        token = request.data.get("refresh")
        if token:
            # An already-invalid token means the session is gone, which is the
            # outcome the caller wanted; surfacing an error helps nobody.
            with contextlib.suppress(TokenError):
                RefreshToken(token).blacklist()
        record_security_event(request, "auth.logout")
        return Response(status=status.HTTP_204_NO_CONTENT)


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
