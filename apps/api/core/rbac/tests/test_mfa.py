"""TOTP MFA for platform users: the `second_factor` sign-in step (auth-and-rbac §1, SEC-06).

Login answers a user with `mfa_enabled` with a signed challenge instead of tokens;
`/auth/mfa:verify` trades it, with a TOTP or a recovery code, for the normal pair carrying
`amr=["pwd","otp"]`. Enrolment (`:enroll`, `:confirm`) is platform-only in v1.
"""

from __future__ import annotations

import io
import time
from types import SimpleNamespace
from unittest import mock

import pyotp
from cryptography.fernet import Fernet
from django.conf import settings
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from apps.school_organization.tests.factories import TEST_PASSWORD, TenantFactory, UserFactory
from core.api.throttling import AuthEndpointThrottle
from core.integrations import crypto
from core.rbac import mfa
from core.rbac.models import MfaRecoveryCode, User
from core.rbac.permissions import IsPlatformPrincipal
from core.rbac.tests.test_platform_scope import bearer, platform_user
from core.rbac.views import (
    REFRESH_COOKIE_NAME,
    MfaConfirmView,
    MfaDisableView,
    MfaEnrollView,
    MfaVerifyView,
)

LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
VERIFY = "/api/v1/auth/mfa:verify"
ENROLL = "/api/v1/auth/mfa:enroll"
CONFIRM = "/api/v1/auth/mfa:confirm"
DISABLE = "/api/v1/auth/mfa:disable"
PASSWORD = "x-platform-pass-1"  # platform_user's password


def enable_mfa(user: User) -> pyotp.TOTP:
    """Enrol and switch on MFA for ``user`` without the HTTP round trip."""
    secret, _ = mfa.begin_enrolment(user)
    user.mfa_enabled = True
    user.save(update_fields=["mfa_enabled", "updated_at"])
    return pyotp.TOTP(secret)


def wrong_code(totp: pyotp.TOTP) -> str:
    return f"{(int(totp.now()) + 1) % 1_000_000:06d}"


def amr_of(raw_token: str) -> list[str] | None:
    return AccessToken(raw_token).get("amr")


class MfaTestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        # The auth throttle is keyed on the test client's one IP, across tests.
        cache.clear()
        self.user = platform_user()

    def login(self, user: User | None = None):
        user = user or self.user
        return self.client.post(
            LOGIN, {"identifier": user.email, "password": PASSWORD}, format="json"
        )

    def challenge(self) -> str:
        response = self.login()
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        return response.json()["data"]["mfa_token"]

    def verify(self, mfa_token: str, **factor: str):
        return self.client.post(VERIFY, {"mfa_token": mfa_token, **factor}, format="json")

    def assert_error(self, response, http_status: int, code: str) -> None:
        self.assertEqual(response.status_code, http_status, response.content)
        self.assertEqual(response.json()["error"]["code"], code)


class SecondFactorLoginTests(MfaTestCase):
    def test_login_with_mfa_returns_challenge_not_tokens(self) -> None:
        enable_mfa(self.user)

        response = self.login()

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        data = response.json()["data"]
        self.assertEqual(set(data), {"mfa_required", "mfa_token"})
        self.assertIs(data["mfa_required"], True)
        self.assertTrue(data["mfa_token"])
        self.assertNotIn(REFRESH_COOKIE_NAME, response.cookies)
        self.assertFalse(OutstandingToken.objects.filter(user=self.user).exists())

    def test_login_without_mfa_carries_pwd_amr(self) -> None:
        response = self.login()

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(amr_of(response.json()["data"]["access_token"]), ["pwd"])
        refresh = RefreshToken(response.cookies[REFRESH_COOKIE_NAME].value)
        self.assertEqual(refresh["amr"], ["pwd"])

    def test_tenant_login_carries_pwd_amr(self) -> None:
        tenant_user = UserFactory(tenant=TenantFactory())

        response = self.client.post(
            LOGIN, {"identifier": tenant_user.email, "password": TEST_PASSWORD}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(amr_of(response.json()["data"]["access_token"]), ["pwd"])

    def test_verify_issues_otp_amr(self) -> None:
        totp = enable_mfa(self.user)

        response = self.verify(self.challenge(), code=totp.now())

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        data = response.json()["data"]
        self.assertEqual(data["user"]["id"], str(self.user.pk))
        self.assertEqual(amr_of(data["access_token"]), ["pwd", "otp"])
        refresh = RefreshToken(response.cookies[REFRESH_COOKIE_NAME].value)
        self.assertEqual(refresh["amr"], ["pwd", "otp"])
        # The token Task 1's platform gate admits.
        request = SimpleNamespace(user=self.user, auth=AccessToken(data["access_token"]))
        self.assertTrue(IsPlatformPrincipal().has_permission(request, None))

    def test_wrong_code_is_refused(self) -> None:
        totp = enable_mfa(self.user)

        response = self.verify(self.challenge(), code=wrong_code(totp))

        self.assert_error(response, status.HTTP_400_BAD_REQUEST, "invalid_mfa_code")
        self.assertNotIn(REFRESH_COOKIE_NAME, response.cookies)

    def test_code_replay_rejected(self) -> None:
        totp = enable_mfa(self.user)
        code = totp.now()
        self.assertEqual(self.verify(self.challenge(), code=code).status_code, status.HTTP_200_OK)

        replay = self.verify(self.challenge(), code=code)

        self.assert_error(replay, status.HTTP_400_BAD_REQUEST, "invalid_mfa_code")

    def test_verify_stores_the_accepted_timecode(self) -> None:
        totp = enable_mfa(self.user)
        now = time.time()

        self.assertTrue(mfa.verify(self.user, totp.at(now)))

        self.user.refresh_from_db()
        self.assertEqual(self.user.mfa_last_timecode, totp.timecode(now))

    def test_recovery_code_single_use(self) -> None:
        enable_mfa(self.user)
        codes = mfa.generate_recovery_codes(self.user)
        self.assertEqual(len(codes), mfa.RECOVERY_CODE_COUNT)

        first = self.verify(self.challenge(), recovery_code=codes[0])

        self.assertEqual(first.status_code, status.HTTP_200_OK, first.content)
        self.assertEqual(amr_of(first.json()["data"]["access_token"]), ["pwd", "otp"])
        again = self.verify(self.challenge(), recovery_code=codes[0])
        self.assert_error(again, status.HTTP_400_BAD_REQUEST, "invalid_mfa_code")
        # The others still work, typed loosely.
        loose = codes[1].replace("-", "").lower()
        self.assertEqual(
            self.verify(self.challenge(), recovery_code=loose).status_code, status.HTTP_200_OK
        )

    def test_recovery_codes_are_stored_hashed(self) -> None:
        enable_mfa(self.user)
        codes = mfa.generate_recovery_codes(self.user)

        stored = set(
            MfaRecoveryCode.objects.filter(user=self.user).values_list("code_hash", flat=True)
        )

        self.assertEqual(len(stored), mfa.RECOVERY_CODE_COUNT)
        for code in codes:
            self.assertNotIn(code, stored)
            self.assertNotIn(code.replace("-", ""), stored)

    def test_verify_needs_exactly_one_factor(self) -> None:
        totp = enable_mfa(self.user)
        token = self.challenge()

        neither = self.verify(token)
        both = self.verify(token, code=totp.now(), recovery_code="AAAA-AAAA-AAAA-AAAA")

        self.assert_error(neither, status.HTTP_400_BAD_REQUEST, "validation_error")
        self.assert_error(both, status.HTTP_400_BAD_REQUEST, "validation_error")

    def test_challenge_expires(self) -> None:
        totp = enable_mfa(self.user)
        issued_at = time.time() - settings.MFA_CHALLENGE_TTL_SECONDS - 1
        with mock.patch("django.core.signing.time.time", return_value=issued_at):
            stale = mfa.issue_challenge(self.user)

        response = self.verify(stale, code=totp.now())

        self.assert_error(response, status.HTTP_400_BAD_REQUEST, "mfa_challenge_invalid")

    def test_tampered_challenge_is_refused(self) -> None:
        totp = enable_mfa(self.user)

        response = self.verify(self.challenge() + "x", code=totp.now())

        self.assert_error(response, status.HTTP_400_BAD_REQUEST, "mfa_challenge_invalid")

    def test_challenge_is_single_use(self) -> None:
        totp = enable_mfa(self.user)
        codes = mfa.generate_recovery_codes(self.user)
        token = self.challenge()
        self.assertEqual(self.verify(token, code=totp.now()).status_code, status.HTTP_200_OK)

        reuse = self.verify(token, recovery_code=codes[0])

        self.assert_error(reuse, status.HTTP_400_BAD_REQUEST, "mfa_challenge_invalid")

    def test_challenge_dies_after_too_many_wrong_codes(self) -> None:
        totp = enable_mfa(self.user)
        token = self.challenge()
        for _ in range(mfa.MAX_CHALLENGE_ATTEMPTS):
            self.assert_error(
                self.verify(token, code=wrong_code(totp)),
                status.HTTP_400_BAD_REQUEST,
                "invalid_mfa_code",
            )

        response = self.verify(token, code=totp.now())

        self.assert_error(response, status.HTTP_400_BAD_REQUEST, "mfa_challenge_invalid")

    def test_challenge_of_a_deactivated_user_is_refused(self) -> None:
        totp = enable_mfa(self.user)
        token = self.challenge()
        User.objects.filter(pk=self.user.pk).update(is_active=False)

        response = self.verify(token, code=totp.now())

        self.assert_error(response, status.HTTP_400_BAD_REQUEST, "mfa_challenge_invalid")

    def test_refresh_keeps_amr(self) -> None:
        totp = enable_mfa(self.user)
        verified = self.verify(self.challenge(), code=totp.now())
        self.assertEqual(verified.status_code, status.HTTP_200_OK, verified.content)

        response = self.client.post(REFRESH)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertEqual(amr_of(response.json()["data"]["access_token"]), ["pwd", "otp"])
        rotated = RefreshToken(response.cookies[REFRESH_COOKIE_NAME].value)
        self.assertEqual(rotated["amr"], ["pwd", "otp"])


class EnrolmentTests(MfaTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.client.credentials(HTTP_AUTHORIZATION=bearer(self.user, amr=["pwd"]))

    def test_enroll_returns_secret_and_otpauth_uri(self) -> None:
        response = self.client.post(ENROLL)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        data = response.json()["data"]
        expected_uri = pyotp.TOTP(data["secret"]).provisioning_uri(
            name=self.user.email, issuer_name=settings.MFA_ISSUER_NAME
        )
        self.assertEqual(data["otpauth_uri"], expected_uri)
        self.user.refresh_from_db()
        self.assertFalse(self.user.mfa_enabled)

    def test_secret_stored_encrypted(self) -> None:
        secret = self.client.post(ENROLL).json()["data"]["secret"]

        with connection.cursor() as cursor:
            cursor.execute("SELECT mfa_secret FROM users WHERE id = %s", [self.user.pk])
            raw = bytes(cursor.fetchone()[0])

        self.assertNotIn(secret.encode(), raw)
        self.assertEqual(crypto.decrypt(raw), {"secret": secret})

    def test_confirm_enables_mfa_and_returns_recovery_codes_and_otp_tokens(self) -> None:
        secret = self.client.post(ENROLL).json()["data"]["secret"]

        response = self.client.post(CONFIRM, {"code": pyotp.TOTP(secret).now()}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        data = response.json()["data"]
        self.assertEqual(len(set(data["recovery_codes"])), mfa.RECOVERY_CODE_COUNT)
        self.assertEqual(amr_of(data["access_token"]), ["pwd", "otp"])
        refresh = RefreshToken(response.cookies[REFRESH_COOKIE_NAME].value)
        self.assertEqual(refresh["amr"], ["pwd", "otp"])
        self.user.refresh_from_db()
        self.assertTrue(self.user.mfa_enabled)
        self.assertEqual(
            MfaRecoveryCode.objects.filter(user=self.user).count(), mfa.RECOVERY_CODE_COUNT
        )

    def test_confirm_with_wrong_code_leaves_mfa_off(self) -> None:
        secret = self.client.post(ENROLL).json()["data"]["secret"]

        response = self.client.post(
            CONFIRM, {"code": wrong_code(pyotp.TOTP(secret))}, format="json"
        )

        self.assert_error(response, status.HTTP_400_BAD_REQUEST, "invalid_mfa_code")
        self.user.refresh_from_db()
        self.assertFalse(self.user.mfa_enabled)

    def test_confirm_before_enroll_is_409(self) -> None:
        response = self.client.post(CONFIRM, {"code": "123456"}, format="json")

        self.assert_error(response, status.HTTP_409_CONFLICT, "conflict")

    def test_enroll_refused_when_mfa_already_enabled(self) -> None:
        """Ruling A2: a password-only token must never overwrite an enrolled secret."""
        totp = enable_mfa(self.user)
        before = bytes(User.objects.get(pk=self.user.pk).mfa_secret)

        response = self.client.post(ENROLL)

        self.assert_error(response, status.HTTP_409_CONFLICT, "mfa_already_enabled")
        self.assertEqual(bytes(User.objects.get(pk=self.user.pk).mfa_secret), before)
        self.assertTrue(mfa.verify(self.user, totp.now()))

    def test_confirm_refused_when_mfa_already_enabled(self) -> None:
        totp = enable_mfa(self.user)

        response = self.client.post(CONFIRM, {"code": totp.now()}, format="json")

        self.assert_error(response, status.HTTP_409_CONFLICT, "mfa_already_enabled")

    def test_tenant_user_cannot_enroll(self) -> None:
        """Tenant MFA is out of scope in v1 (deferred-work.md); the routes are platform-only."""
        tenant_user = UserFactory(tenant=TenantFactory())
        self.client.credentials(HTTP_AUTHORIZATION=bearer(tenant_user, amr=["pwd"]))

        self.assertEqual(self.client.post(ENROLL).status_code, status.HTTP_404_NOT_FOUND)
        tenant_user.refresh_from_db()
        self.assertIsNone(tenant_user.mfa_secret)

    def test_anonymous_cannot_enroll(self) -> None:
        self.client.credentials()

        self.assertEqual(self.client.post(ENROLL).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_platform_user_cannot_disable_mfa(self) -> None:
        enable_mfa(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=bearer(self.user, amr=["pwd", "otp"]))

        response = self.client.post(DISABLE)

        self.assert_error(response, status.HTTP_403_FORBIDDEN, "permission_denied")
        self.user.refresh_from_db()
        self.assertTrue(self.user.mfa_enabled)
        self.assertIsNotNone(self.user.mfa_secret)


class ThrottleTests(MfaTestCase):
    def test_mfa_routes_throttled(self) -> None:
        for view in (MfaVerifyView, MfaEnrollView, MfaConfirmView, MfaDisableView):
            with self.subTest(view=view.__name__):
                self.assertEqual(list(view.throttle_classes), [AuthEndpointThrottle])

        same_ip = {"REMOTE_ADDR": "203.0.113.9"}
        body = {"mfa_token": "nope", "code": "123456"}
        for _ in range(10):  # the `auth` rate, 10/min (tests/test_throttle_rates.py)
            response = self.client.post(VERIFY, body, format="json", **same_ip)
            self.assertNotEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

        throttled = self.client.post(VERIFY, body, format="json", **same_ip)

        self.assertEqual(throttled.status_code, status.HTTP_429_TOO_MANY_REQUESTS)


class ResetMfaCommandTests(MfaTestCase):
    def test_reset_mfa_clears_the_factor_and_ends_sessions(self) -> None:
        enable_mfa(self.user)
        mfa.generate_recovery_codes(self.user)
        RefreshToken.for_user(self.user)

        call_command(
            "create_platform_admin",
            email=self.user.email.upper(),
            reset_mfa=True,
            stdout=io.StringIO(),
        )

        self.user.refresh_from_db()
        self.assertFalse(self.user.mfa_enabled)
        self.assertIsNone(self.user.mfa_secret)
        self.assertIsNone(self.user.mfa_last_timecode)
        self.assertFalse(MfaRecoveryCode.objects.filter(user=self.user).exists())
        live = OutstandingToken.objects.filter(user=self.user, blacklistedtoken__isnull=True)
        self.assertFalse(live.exists())

    def test_reset_mfa_refuses_an_email_that_is_not_a_platform_user(self) -> None:
        tenant_user = UserFactory(tenant=TenantFactory())

        with self.assertRaises(CommandError):
            call_command(
                "create_platform_admin",
                email=tenant_user.email,
                reset_mfa=True,
                stdout=io.StringIO(),
            )


class RotateMfaSecretTests(MfaTestCase):
    def test_rotate_command_re_encrypts_mfa_secret(self) -> None:
        old_key = Fernet.generate_key().decode()
        new_key = Fernet.generate_key().decode()
        with override_settings(INTEGRATIONS_ENCRYPTION_KEYS=[old_key]):
            totp = enable_mfa(self.user)

        with override_settings(INTEGRATIONS_ENCRYPTION_KEYS=[new_key, old_key]):
            call_command("rotate_integration_credentials", stdout=io.StringIO())

        with override_settings(INTEGRATIONS_ENCRYPTION_KEYS=[new_key]):
            self.assertTrue(mfa.verify(self.user, totp.now()))
