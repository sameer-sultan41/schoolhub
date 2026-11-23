"""TOTP MFA for platform users: the `second_factor` sign-in step (auth-and-rbac §1, SEC-06).

Login answers a user with `mfa_enabled` with a signed challenge instead of tokens;
`/auth/mfa:verify` trades it, with a TOTP or a recovery code, for the normal pair carrying
`amr=["pwd","otp"]`. Enrolment (`:enroll`, `:confirm`) is platform-only in v1.
"""

from __future__ import annotations

import io
import time
from datetime import timedelta
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
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from apps.school_organization.tests.factories import TEST_PASSWORD, TenantFactory, UserFactory
from core.api.throttling import AuthEndpointThrottle
from core.integrations import crypto
from core.rbac import mfa
from core.rbac.models import MfaRecoveryCode, User
from core.rbac.permissions import IsPlatformPrincipal, MfaRequired
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
        self.user = platform_user(mfa_enabled=False)

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
        for _ in range(settings.MFA_CHALLENGE_MAX_ATTEMPTS):
            self.assert_error(
                self.verify(token, code=wrong_code(totp)),
                status.HTTP_400_BAD_REQUEST,
                "invalid_mfa_code",
            )

        response = self.verify(token, code=totp.now())

        self.assert_error(response, status.HTTP_400_BAD_REQUEST, "mfa_challenge_invalid")

    def test_challenge_counts_each_redemption_before_the_code_is_checked(self) -> None:
        """Increment-first: parallel requests on one challenge can't all pass a read of it."""
        enable_mfa(self.user)
        token = mfa.issue_challenge(self.user)
        for _ in range(settings.MFA_CHALLENGE_MAX_ATTEMPTS):
            mfa.redeem_challenge(token)

        with self.assertRaises(mfa.MfaChallengeInvalid):
            mfa.redeem_challenge(token)

    def test_an_older_step_is_refused_after_a_newer_one(self) -> None:
        """Replay inside the ±1 window: accept step T+1, then a code for step T is refused."""
        totp = enable_mfa(self.user)
        now = time.time()

        self.assertTrue(mfa.verify(self.user, totp.at(now + totp.interval)))

        self.assertFalse(mfa.verify(self.user, totp.at(now)))

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

    def test_enroll_on_a_stale_user_never_replaces_an_enrolled_factor(self) -> None:
        """The enroll/confirm race: `request.user` was loaded before a confirm committed."""
        stale = User.objects.get(pk=self.user.pk)
        totp = enable_mfa(self.user)
        before = bytes(User.objects.get(pk=self.user.pk).mfa_secret)

        with self.assertRaises(mfa.MfaAlreadyEnabled):
            mfa.begin_enrolment(stale)

        self.assertEqual(bytes(User.objects.get(pk=self.user.pk).mfa_secret), before)
        self.assertTrue(mfa.verify(self.user, totp.now()))

    def test_a_second_confirm_keeps_the_first_recovery_codes(self) -> None:
        """Two racing confirms: the loser is refused and the codes already shown stay valid."""
        secret = self.client.post(ENROLL).json()["data"]["secret"]
        stale = User.objects.get(pk=self.user.pk)
        totp = pyotp.TOTP(secret)
        now = time.time()
        first = self.client.post(CONFIRM, {"code": totp.at(now)}, format="json")
        self.assertEqual(first.status_code, status.HTTP_200_OK, first.content)
        shown = set(
            MfaRecoveryCode.objects.filter(user=self.user).values_list("code_hash", flat=True)
        )

        with self.assertRaises(mfa.MfaAlreadyEnabled):
            mfa.confirm_enrolment(stale, totp.at(now + totp.interval))

        kept = set(
            MfaRecoveryCode.objects.filter(user=self.user).values_list("code_hash", flat=True)
        )
        self.assertEqual(kept, shown)

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


@override_settings(MFA_MAX_FAILED_ATTEMPTS=3, MFA_LOCKOUT_SECONDS=900)
class SecondFactorLockoutTests(MfaTestCase):
    """Per-account limit on second-factor guesses (NIST SP 800-63B §5.2.2).

    A password holder mints a fresh challenge with every login, so the per-challenge cap alone
    bounds nothing; the per-IP throttle can be rotated.
    """

    def test_wrong_codes_across_fresh_challenges_lock_the_account(self) -> None:
        totp = enable_mfa(self.user)
        for _ in range(3):
            self.assert_error(
                self.verify(self.challenge(), code=wrong_code(totp)),
                status.HTTP_400_BAD_REQUEST,
                "invalid_mfa_code",
            )

        locked = self.verify(self.challenge(), code=totp.now())

        self.assert_error(locked, status.HTTP_429_TOO_MANY_REQUESTS, "mfa_locked")
        self.assertNotIn(REFRESH_COOKIE_NAME, locked.cookies)

    def test_a_correct_code_is_refused_until_the_lockout_expires(self) -> None:
        totp = enable_mfa(self.user)
        codes = mfa.generate_recovery_codes(self.user)
        for _ in range(3):
            self.assertFalse(mfa.verify(self.user, wrong_code(totp)))

        with self.assertRaises(mfa.MfaLockedOut):
            mfa.verify(self.user, totp.now())
        with self.assertRaises(mfa.MfaLockedOut):
            mfa.use_recovery_code(self.user, codes[0])

        User.objects.filter(pk=self.user.pk).update(
            mfa_locked_until=timezone.now() - timedelta(seconds=1)
        )
        self.assertTrue(mfa.verify(self.user, totp.now()))

    def test_a_success_resets_the_count(self) -> None:
        totp = enable_mfa(self.user)
        now = time.time()
        self.assertFalse(mfa.verify(self.user, wrong_code(totp)))
        self.assertFalse(mfa.verify(self.user, wrong_code(totp)))
        self.assertTrue(mfa.verify(self.user, totp.at(now)))

        self.assertFalse(mfa.verify(self.user, wrong_code(totp)))
        self.assertFalse(mfa.verify(self.user, wrong_code(totp)))

        # Four failures in all, but never three in a row: not locked.
        self.assertTrue(mfa.verify(self.user, totp.at(now + totp.interval)))

    def expire_lock(self) -> None:
        User.objects.filter(pk=self.user.pk).update(
            mfa_locked_until=timezone.now() - timedelta(seconds=1)
        )

    def locked_for(self) -> float:
        self.user.refresh_from_db()
        assert self.user.mfa_locked_until is not None
        return (self.user.mfa_locked_until - timezone.now()).total_seconds()

    def test_a_lockout_keeps_the_failure_count(self) -> None:
        totp = enable_mfa(self.user)
        for _ in range(3):
            mfa.verify(self.user, wrong_code(totp))

        self.user.refresh_from_db()
        self.assertEqual(self.user.mfa_failed_attempts, 3)
        self.assertIsNotNone(self.user.mfa_locked_until)

    def test_each_lockout_is_twice_as_long_as_the_last(self) -> None:
        totp = enable_mfa(self.user)
        for expected in (900, 1800, 3600):
            self.expire_lock()
            for _ in range(3):
                mfa.verify(self.user, wrong_code(totp))
            self.assertAlmostEqual(self.locked_for(), expected, delta=5)

    @override_settings(MFA_PERMANENT_LOCKOUT_ATTEMPTS=9)
    def test_the_permanent_threshold_locks_until_an_operator_unlocks(self) -> None:
        totp = enable_mfa(self.user)
        for _ in range(3):
            for _ in range(3):
                mfa.verify(self.user, wrong_code(totp))
            self.expire_lock()

        self.user.refresh_from_db()
        self.assertEqual(self.user.mfa_failed_attempts, 9)
        # The timed lock has passed, and a right code is still refused.
        with self.assertRaises(mfa.MfaLockedOut):
            mfa.verify(self.user, totp.now())

    def test_a_locked_response_carries_retry_after(self) -> None:
        totp = enable_mfa(self.user)
        for _ in range(3):
            mfa.verify(self.user, wrong_code(totp))

        response = self.verify(self.challenge(), code=totp.now())

        self.assert_error(response, status.HTTP_429_TOO_MANY_REQUESTS, "mfa_locked")
        self.assertIn(int(response["Retry-After"]), range(895, 901))

    @override_settings(MFA_PERMANENT_LOCKOUT_ATTEMPTS=3)
    def test_a_permanent_lock_has_no_retry_after(self) -> None:
        totp = enable_mfa(self.user)
        for _ in range(3):
            mfa.verify(self.user, wrong_code(totp))

        response = self.verify(self.challenge(), code=totp.now())

        self.assert_error(response, status.HTTP_429_TOO_MANY_REQUESTS, "mfa_locked")
        self.assertNotIn("Retry-After", response)

    def test_a_locked_account_is_refused_on_confirm_too(self) -> None:
        secret, _ = mfa.begin_enrolment(self.user)
        totp = pyotp.TOTP(secret)
        User.objects.filter(pk=self.user.pk).update(
            mfa_locked_until=timezone.now() + timedelta(minutes=5)
        )
        self.client.credentials(HTTP_AUTHORIZATION=bearer(self.user, amr=["pwd"]))

        response = self.client.post(CONFIRM, {"code": totp.now()}, format="json")

        self.assert_error(response, status.HTTP_429_TOO_MANY_REQUESTS, "mfa_locked")
        self.user.refresh_from_db()
        self.assertFalse(self.user.mfa_enabled)


class ResetMfaCommandTests(MfaTestCase):
    def test_reset_mfa_clears_the_factor_and_ends_sessions(self) -> None:
        enable_mfa(self.user)
        mfa.generate_recovery_codes(self.user)
        RefreshToken.for_user(self.user)
        User.objects.filter(pk=self.user.pk).update(
            mfa_failed_attempts=2, mfa_locked_until=timezone.now() + timedelta(minutes=5)
        )

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
        self.assertEqual(self.user.mfa_failed_attempts, 0)
        self.assertIsNone(self.user.mfa_locked_until)
        self.assertFalse(MfaRecoveryCode.objects.filter(user=self.user).exists())
        live = OutstandingToken.objects.filter(user=self.user, blacklistedtoken__isnull=True)
        self.assertFalse(live.exists())

    def test_reset_mfa_cuts_console_access_at_once(self) -> None:
        enable_mfa(self.user)
        # An access token minted before the reset carries "otp" until it expires.
        token = AccessToken.for_user(self.user)
        token["amr"] = ["pwd", "otp"]
        request = SimpleNamespace(user=self.user, auth=token)
        self.assertTrue(IsPlatformPrincipal().has_permission(request, None))

        call_command(
            "create_platform_admin", email=self.user.email, reset_mfa=True, stdout=io.StringIO()
        )

        self.user.refresh_from_db()
        request = SimpleNamespace(user=self.user, auth=token)
        with self.assertRaises(MfaRequired):
            IsPlatformPrincipal().has_permission(request, None)

    def test_unlock_mfa_lifts_the_lock_and_keeps_the_factor(self) -> None:
        totp = enable_mfa(self.user)
        codes = mfa.generate_recovery_codes(self.user)
        User.objects.filter(pk=self.user.pk).update(
            mfa_failed_attempts=100, mfa_locked_until=timezone.now() + timedelta(hours=1)
        )

        call_command(
            "create_platform_admin", email=self.user.email, unlock_mfa=True, stdout=io.StringIO()
        )

        self.user.refresh_from_db()
        self.assertEqual(self.user.mfa_failed_attempts, 0)
        self.assertIsNone(self.user.mfa_locked_until)
        self.assertTrue(self.user.mfa_enabled)
        self.assertEqual(MfaRecoveryCode.objects.filter(user=self.user).count(), len(codes))
        self.assertTrue(mfa.verify(self.user, totp.now()))

    def test_unlock_mfa_refuses_an_email_that_is_not_a_platform_user(self) -> None:
        tenant_user = UserFactory(tenant=TenantFactory())

        with self.assertRaises(CommandError):
            call_command(
                "create_platform_admin",
                email=tenant_user.email,
                unlock_mfa=True,
                stdout=io.StringIO(),
            )

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
