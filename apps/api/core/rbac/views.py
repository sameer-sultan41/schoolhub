"""Authentication endpoints.

These sit outside the tenant middleware's requirements: a user must be able to
authenticate before a tenant context exists. The tenant is derived from the account
and carried in the token thereafter.

Cookie contract (matches apps/dashboard/src/lib/auth.ts and packages/api-client):
  - The access token never touches a cookie — it's returned in the JSON body only,
    for the SPA to hold in memory.
  - ``REFRESH_COOKIE_NAME`` carries the rotating refresh token. HttpOnly, scoped to
    ``REFRESH_COOKIE_PATH``. The dashboard never calls these endpoints directly —
    it proxies login/refresh/logout through its own ``/api/auth/*`` (see its
    next.config.ts) — so from the browser's perspective this cookie is always
    same-origin with whatever dashboard host it's currently on, host-only, no
    SameSite/cross-site concern at all. That proxy exists because a direct
    cross-origin call would put a tenant subdomain (``<slug>.PLATFORM_DOMAIN``) and
    this API's own fixed host on different "sites" for SameSite purposes in local
    dev: "localhost" has no further public-suffix structure, so browsers treat it as
    its own effective TLD, the same rule that makes an explicit ``Domain=.localhost``
    on a cookie be rejected outright (RFC 6265's public-suffix check, same as
    ``Domain=.com``) — a ``SameSite=Lax`` cookie set on one such "site" is never sent
    back on a fetch to the other.
  - The dashboard's own presence-only session marker (``sh_session``, read by its Next
    proxy for route protection) is deliberately **not** set here at all — it can't be,
    since it needs to exist even before any API call happens. The dashboard sets and
    clears it itself from JS already running on whichever host the browser is on —
    see ``apps/dashboard/src/lib/auth.ts``.
"""

from __future__ import annotations

import contextlib
from datetime import timedelta
from typing import cast

from django.conf import settings
from django.http import HttpResponse
from drf_spectacular.utils import PolymorphicProxySerializer, extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException, AuthenticationFailed, PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from core.api.throttling import AuthEndpointThrottle
from core.audit.services import record_security_event
from core.rbac import mfa
from core.rbac.models import User
from core.rbac.permissions import FIRST_FACTOR_AMR, OTP_AMR, IsPlatformUser
from core.rbac.serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    MfaChallengeResponseSerializer,
    MfaConfirmResponseSerializer,
    MfaConfirmSerializer,
    MfaEnrollResponseSerializer,
    MfaVerifySerializer,
    RefreshResponseSerializer,
    SignedInResponseSerializer,
    UserSerializer,
    issue_token_pair,
)

REFRESH_COOKIE_NAME = "sh_refresh"
# Matches the dashboard's own public proxy path (/api/auth/*, see its next.config.ts),
# NOT this API's internal /api/v1/auth/* route — a cookie's Path is matched against
# whatever URL the browser actually requests, and since the dashboard never calls this
# API directly (see the module docstring), the browser only ever requests /api/auth/*.
REFRESH_COOKIE_PATH = "/api/auth"


def _simple_jwt_lifetime_seconds(key: str) -> int:
    lifetime = cast(timedelta, settings.SIMPLE_JWT[key])
    return int(lifetime.total_seconds())


def _set_auth_cookies(response: HttpResponse, *, refresh_token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        refresh_token,
        max_age=_simple_jwt_lifetime_seconds("REFRESH_TOKEN_LIFETIME"),
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        # secure=False only in DEBUG: local dev serves plain HTTP, and a Secure cookie
        # is silently dropped by the browser over HTTP.
        secure=not settings.DEBUG,
        samesite="Lax",
    )


def _clear_auth_cookies(response: HttpResponse) -> None:
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)


def _error_response(request, code: str, message: str, http_status: int) -> Response:
    """The error envelope, returned rather than raised.

    Under ``ATOMIC_REQUESTS`` a raised exception rolls back the request's transaction, and with
    it the security event just recorded; a refused sign-in must keep its audit row.
    """
    return Response(
        {
            "error": {
                "code": code,
                "message": message,
                "details": [],
                "request_id": getattr(request, "request_id", None),
            }
        },
        status=http_status,
    )


def _refusal(request, exc: APIException) -> Response:
    response = _error_response(request, str(exc.default_code), str(exc.detail), exc.status_code)
    # As DRF's own handler does for a throttled request (RFC 9110 §10.2.3).
    wait = getattr(exc, "wait", None)
    if wait:
        response["Retry-After"] = str(wait)
    return response


def _signed_in_response(
    *, access: str, refresh: str, user: dict, extra: dict[str, object] | None = None
) -> Response:
    """A completed sign-in: the access token in the body, the refresh token in the cookie."""
    response = Response(
        {
            "data": {
                "access_token": access,
                "expires_in": _simple_jwt_lifetime_seconds("ACCESS_TOKEN_LIFETIME"),
                "user": user,
                **(extra or {}),
            }
        }
    )
    _set_auth_cookies(response, refresh_token=refresh)
    return response


def _second_factor_response(user: User, extra: dict[str, object] | None = None) -> Response:
    """Tokens for a user who passed the password and a second factor."""
    refresh = issue_token_pair(user, amr=[FIRST_FACTOR_AMR, OTP_AMR])
    return _signed_in_response(
        access=str(refresh.access_token),
        refresh=str(refresh),
        user=UserSerializer(user).data,
        extra=extra,
    )


class LoginView(APIView):
    """Password sign-in: the first step of the login state machine (auth-and-rbac §1).

    A user with ``mfa_enabled`` gets a challenge (``mfa_required``, ``mfa_token``) and no token
    or cookie; ``MfaVerifyView`` completes the sign-in. Everyone else gets the token pair with
    ``amr=["pwd"]``.
    """

    permission_classes = [AllowAny]
    throttle_classes = [AuthEndpointThrottle]
    serializer_class = LoginSerializer

    @extend_schema(
        request=LoginSerializer,
        responses={
            200: PolymorphicProxySerializer(
                component_name="LoginResponse",
                serializers=[SignedInResponseSerializer, MfaChallengeResponseSerializer],
                resource_type_field_name=None,
            )
        },
    )
    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            record_security_event(
                request, "auth.login.failed", identifier=request.data.get("identifier")
            )
            return _error_response(
                request,
                "invalid_credentials",
                "Incorrect credentials.",
                status.HTTP_401_UNAUTHORIZED,
            )

        validated = serializer.validated_data
        if validated.get("mfa_required"):
            record_security_event(request, "auth.login.mfa_challenged")
            return Response({"data": {"mfa_required": True, "mfa_token": validated["mfa_token"]}})

        record_security_event(request, "auth.login.succeeded")
        return _signed_in_response(
            access=validated["access"], refresh=validated["refresh"], user=validated["user"]
        )


class MfaVerifyView(APIView):
    """``POST /auth/mfa:verify``: the ``second_factor`` step, completing a challenged login.

    Trades login's ``mfa_token`` and either a TOTP ``code`` or a ``recovery_code`` for the token
    pair with ``amr=["pwd","otp"]``. A wrong code is a 400 ``invalid_mfa_code``. Every attempt
    counts against the challenge (``MFA_CHALLENGE_MAX_ATTEMPTS``; past it, or once used, a 400
    ``mfa_challenge_invalid`` and the client signs in again) and against the account
    (``MFA_MAX_FAILED_ATTEMPTS`` consecutive failures lock it: 429 ``mfa_locked`` with
    ``Retry-After``, which is absent once only an operator can lift the lock).
    """

    permission_classes = [AllowAny]
    throttle_classes = [AuthEndpointThrottle]

    @extend_schema(request=MfaVerifySerializer, responses={200: SignedInResponseSerializer})
    def post(self, request):
        serializer = MfaVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            challenge = mfa.redeem_challenge(data["mfa_token"])
        except mfa.MfaChallengeInvalid as exc:
            record_security_event(request, "auth.mfa.failed", reason="challenge")
            return _refusal(request, exc)

        user = challenge.user
        method = "totp" if "code" in data else "recovery_code"
        try:
            if method == "totp":
                passed = mfa.verify(user, data["code"])
            else:
                passed = mfa.use_recovery_code(user, data["recovery_code"])
        except mfa.MfaLockedOut as exc:
            record_security_event(request, "auth.mfa.locked", user_id=str(user.pk), method=method)
            return _refusal(request, exc)
        if not passed:
            record_security_event(request, "auth.mfa.failed", user_id=str(user.pk), method=method)
            return _refusal(request, mfa.InvalidMfaCode())

        mfa.close_challenge(challenge)
        record_security_event(request, "auth.login.succeeded", user_id=str(user.pk), method=method)
        return _second_factor_response(user)


class MfaEnrollView(APIView):
    """``POST /auth/mfa:enroll``: a new TOTP secret, stored encrypted and not yet enabled.

    Platform users only in v1 (a tenant principal gets 404). Refused 409
    ``mfa_already_enabled`` once MFA is on, so a password-only token can never replace an
    enrolled factor (ruling A2); an operator who lost theirs is reset with
    ``create_platform_admin --reset-mfa``.
    """

    permission_classes = [IsAuthenticated, IsPlatformUser]
    throttle_classes = [AuthEndpointThrottle]

    @extend_schema(request=None, responses={200: MfaEnrollResponseSerializer})
    def post(self, request):
        secret, otpauth_uri = mfa.begin_enrolment(request.user)
        record_security_event(request, "auth.mfa.enrolment_started")
        return Response({"data": {"secret": secret, "otpauth_uri": otpauth_uri}})


class MfaConfirmView(APIView):
    """``POST /auth/mfa:confirm``: a first code turns MFA on.

    Returns ten single-use recovery codes, shown this once, and a fresh token pair whose
    ``amr`` carries ``"otp"``, so the console opens without signing in again.
    """

    permission_classes = [IsAuthenticated, IsPlatformUser]
    throttle_classes = [AuthEndpointThrottle]

    @extend_schema(request=MfaConfirmSerializer, responses={200: MfaConfirmResponseSerializer})
    def post(self, request):
        serializer = MfaConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            recovery_codes = mfa.confirm_enrolment(request.user, serializer.validated_data["code"])
        except mfa.MfaLockedOut as exc:
            record_security_event(request, "auth.mfa.locked", method="totp")
            return _refusal(request, exc)
        if recovery_codes is None:
            record_security_event(request, "auth.mfa.failed", method="totp")
            return _refusal(request, mfa.InvalidMfaCode())

        record_security_event(request, "auth.mfa.enabled")
        return _second_factor_response(request.user, {"recovery_codes": recovery_codes})


class MfaDisableView(APIView):
    """``POST /auth/mfa:disable``: refused for every platform user (SEC-06).

    The console requires a second factor, so a platform account never turns it off; an operator
    who lost their authenticator and recovery codes is reset out of band with
    ``create_platform_admin --reset-mfa``. Tenant principals get 404 until tenant MFA ships
    (docs/deferred-work.md), which is when this route gains a path that succeeds.
    """

    permission_classes = [IsAuthenticated, IsPlatformUser]
    throttle_classes = [AuthEndpointThrottle]

    @extend_schema(request=None, responses={403: None})
    def post(self, request):
        record_security_event(request, "auth.mfa.disable_refused")
        return _refusal(
            request,
            PermissionDenied(
                "A platform account cannot turn off two-factor authentication. "
                "An operator resets it with create_platform_admin --reset-mfa."
            ),
        )


class RefreshView(APIView):
    """Rotating refresh. Reuse of a rotated token invalidates the family (theft detection).

    The refresh token travels only in ``REFRESH_COOKIE_NAME`` — never in the request
    body — so this cannot reuse ``TokenRefreshView`` (which reads the body) even though
    it delegates the actual rotation logic to simplejwt's own serializer.
    """

    permission_classes = [AllowAny]
    throttle_classes = [AuthEndpointThrottle]

    @extend_schema(request=None, responses={200: RefreshResponseSerializer})
    def post(self, request):
        raw_token = request.COOKIES.get(REFRESH_COOKIE_NAME)
        if not raw_token:
            return Response(status=status.HTTP_401_UNAUTHORIZED)

        serializer = TokenRefreshSerializer(data={"refresh": raw_token})
        try:
            serializer.is_valid(raise_exception=True)
        # AuthenticationFailed: the token is valid but `USER_AUTHENTICATION_RULE` refuses
        # the user (inactive, or a suspended school); clear the cookie so the client stops.
        except InvalidToken, TokenError, AuthenticationFailed:
            response = Response(status=status.HTTP_401_UNAUTHORIZED)
            _clear_auth_cookies(response)
            return response

        response = Response(
            {
                "data": {
                    "access_token": serializer.validated_data["access"],
                    "expires_in": _simple_jwt_lifetime_seconds("ACCESS_TOKEN_LIFETIME"),
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
