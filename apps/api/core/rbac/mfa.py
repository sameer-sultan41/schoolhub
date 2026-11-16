"""TOTP multi-factor authentication (RFC 6238; auth-and-rbac §1, SEC-06).

The login state machine's ``second_factor`` step. Login answers a user with ``mfa_enabled``
with a signed, short-lived challenge instead of tokens (``issue_challenge``); the client trades
it at ``/auth/mfa:verify``, with a TOTP code or a recovery code, for the normal token pair.

- **The secret** is ``pyotp.random_base32()``, encrypted at rest with
  ``core.integrations.crypto`` and re-encrypted by ``rotate_integration_credentials``.
- **Every code check runs under the user's row lock** (``_attempt``), so concurrent attempts
  are serialised until their request commits. Under it:
  - **The per-account limit** (NIST SP 800-63B §5.2.2): the attempt is counted
    (``users.mfa_failed_attempts``) before the code is checked; ``MFA_MAX_FAILED_ATTEMPTS``
    consecutive failures lock the second factor for ``MFA_LOCKOUT_SECONDS``
    (``users.mfa_locked_until``), during which even a right code is refused (``MfaLockedOut``).
    A success resets the count. The count lives in the row, not the cache, because production
    Redis evicts keys (``allkeys-lru``) and a password holder mints a fresh challenge per login.
  - **Replay prevention** is pyotp's documented pattern: ``verify_and_get_timecode`` with a
    one-step window, accepting only a time step later than the last accepted one.
  - **Recovery codes** are stored as SHA-256 hashes and spent by a conditional update.
- **The challenge** is a ``django.core.signing`` token (salted, timestamped, ``max_age``
  ``MFA_CHALLENGE_TTL_SECONDS``). Each redemption increments its cache counter first; past
  ``MFA_CHALLENGE_MAX_ATTEMPTS``, or after its one successful use, it is dead.

v1 enforces MFA for platform users only; tenant MFA is deferred (docs/deferred-work.md).
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta

import pyotp
from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from pyotp.exceptions import OTPVerificationError
from rest_framework import status

from core.api.exceptions import CodedAPIException, Conflict
from core.integrations import crypto
from core.rbac.models import MfaRecoveryCode, User
from core.tenancy.access import user_may_authenticate

RECOVERY_CODE_COUNT = 10
# Steps either side of now a code is accepted from (clock drift), as pyotp's docs recommend.
VALID_WINDOW = 1

_CHALLENGE_SALT = "core.rbac.mfa.challenge"
_RECOVERY_CODE_BYTES = 10  # 80 bits, 16 base32 characters


class InvalidMfaCode(CodedAPIException):
    """A TOTP or recovery code that did not match, or was already used."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "That code is not valid. Try the current code from your authenticator."
    default_code = "invalid_mfa_code"


class MfaChallengeInvalid(CodedAPIException):
    """The sign-in challenge is expired, tampered with, used up, or its user can't sign in."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This sign-in has expired. Sign in again with your password."
    default_code = "mfa_challenge_invalid"


class MfaAlreadyEnabled(CodedAPIException):
    """Ruling A2: a password-only token never replaces an enrolled second factor."""

    status_code = status.HTTP_409_CONFLICT
    default_detail = "Two-factor authentication is already on for this account."
    default_code = "mfa_already_enabled"


class MfaLockedOut(CodedAPIException):
    """Too many consecutive wrong codes: every code is refused until the lockout lifts."""

    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    default_detail = "Too many wrong codes. Wait a few minutes, then try again."
    default_code = "mfa_locked"


# ---------------------------------------------------------------- the secret


def _totp(secret: str) -> pyotp.TOTP:
    return pyotp.TOTP(secret)


def secret_for(user: User) -> str | None:
    if user.mfa_secret is None:
        return None
    return str(crypto.decrypt(bytes(user.mfa_secret))["secret"])


def begin_enrolment(user: User) -> tuple[str, str]:
    """Store a new, not yet enabled secret; return it and its ``otpauth://`` URI.

    Refused once MFA is on (``MfaAlreadyEnabled``), judged by the row, not by ``user`` as loaded
    at authentication: the write is conditional on ``mfa_enabled=False``, so an enrol racing a
    confirm can never replace the confirmed secret. Calling it again before confirming replaces
    the pending secret, so a user who lost the QR code can start over.
    """
    secret = pyotp.random_base32()
    ciphertext = crypto.encrypt({"secret": secret})
    replaced = User.objects.filter(pk=user.pk, mfa_enabled=False).update(
        mfa_secret=ciphertext, mfa_last_timecode=None, updated_at=timezone.now()
    )
    if not replaced:
        raise MfaAlreadyEnabled()
    user.mfa_secret = ciphertext
    user.mfa_last_timecode = None
    uri = _totp(secret).provisioning_uri(name=user.email, issuer_name=settings.MFA_ISSUER_NAME)
    return secret, uri


def confirm_enrolment(user: User, code: str) -> list[str] | None:
    """Turn MFA on with a first code from the pending secret.

    Returns the new recovery codes, or None when the code is wrong (MFA stays off). Refused
    once MFA is on, and before ``begin_enrolment``. The row is locked first, so of two racing
    confirms the second sees MFA on and is refused, and the codes the first showed stay valid.
    """
    with transaction.atomic():
        locked = User.objects.select_for_update().get(pk=user.pk)
        if locked.mfa_enabled:
            raise MfaAlreadyEnabled()
        if locked.mfa_secret is None:
            raise Conflict("Start enrolment first: POST /auth/mfa:enroll.")
        if not verify(locked, code):
            return None
        User.objects.filter(pk=locked.pk).update(mfa_enabled=True, updated_at=timezone.now())
        user.mfa_enabled = True
        return generate_recovery_codes(user)


def verify(user: User, code: str) -> bool:
    """True when ``code`` is the user's TOTP for now (± one step) and newer than the last one.

    Counted against the per-account limit; raises ``MfaLockedOut`` while the user is locked.
    """

    def check(locked: User) -> bool:
        secret = secret_for(locked)
        if secret is None:
            return False
        try:
            timecode = _totp(secret).verify_and_get_timecode(code, valid_window=VALID_WINDOW)
        except OTPVerificationError:
            return False
        if locked.mfa_last_timecode is not None and timecode <= locked.mfa_last_timecode:
            return False
        User.objects.filter(pk=locked.pk).update(mfa_last_timecode=timecode)
        user.mfa_last_timecode = timecode
        return True

    return _attempt(user, check)


def _attempt(user: User, check: Callable[[User], bool]) -> bool:
    """Run one second-factor check under the row lock and the per-account limit.

    The lock serialises concurrent attempts, so the count read here is the latest; it is
    incremented before ``check`` runs and compared with the threshold after a failure.
    """
    with transaction.atomic():
        locked = User.objects.select_for_update().get(pk=user.pk)
        now = timezone.now()
        if locked.mfa_locked_until is not None and locked.mfa_locked_until > now:
            raise MfaLockedOut()
        failures = locked.mfa_failed_attempts + 1
        User.objects.filter(pk=locked.pk).update(mfa_failed_attempts=failures)
        if check(locked):
            User.objects.filter(pk=locked.pk).update(mfa_failed_attempts=0, mfa_locked_until=None)
            return True
        if failures >= settings.MFA_MAX_FAILED_ATTEMPTS:
            User.objects.filter(pk=locked.pk).update(
                mfa_failed_attempts=0,
                mfa_locked_until=now + timedelta(seconds=settings.MFA_LOCKOUT_SECONDS),
            )
        return False


def reset(user: User) -> None:
    """Turn MFA off, forget the secret and recovery codes, and lift any lockout."""
    user.mfa_enabled = False
    user.mfa_secret = None
    user.mfa_last_timecode = None
    user.mfa_failed_attempts = 0
    user.mfa_locked_until = None
    user.save(
        update_fields=[
            "mfa_enabled",
            "mfa_secret",
            "mfa_last_timecode",
            "mfa_failed_attempts",
            "mfa_locked_until",
            "updated_at",
        ]
    )
    MfaRecoveryCode.objects.filter(user=user).delete()


def rotate_mfa_secrets() -> int:
    """Re-encrypt every stored TOTP secret under the newest key (a global rotator)."""
    rotated = 0
    enrolled = User.objects.select_for_update().filter(mfa_secret__isnull=False)
    for user in enrolled:
        if user.mfa_secret is None:  # excluded by the filter; narrows the type
            continue
        user.mfa_secret = crypto.rotate(bytes(user.mfa_secret))
        user.save(update_fields=["mfa_secret"])
        rotated += 1
    return rotated


# ---------------------------------------------------------------- recovery codes


def _normalise(code: str) -> str:
    return "".join(code.split()).replace("-", "").upper()


def _hash(code: str) -> str:
    return hashlib.sha256(_normalise(code).encode()).hexdigest()


def generate_recovery_codes(user: User) -> list[str]:
    """Replace the user's recovery codes with ``RECOVERY_CODE_COUNT`` new ones; return them.

    The raw codes exist only in this return value; the caller shows them once.
    """
    codes: list[str] = []
    while len(codes) < RECOVERY_CODE_COUNT:
        raw = base64.b32encode(secrets.token_bytes(_RECOVERY_CODE_BYTES)).decode()
        code = "-".join(raw[i : i + 4] for i in range(0, len(raw), 4))
        if code not in codes:
            codes.append(code)
    MfaRecoveryCode.objects.filter(user=user).delete()
    MfaRecoveryCode.objects.bulk_create(
        [MfaRecoveryCode(user=user, code_hash=_hash(code)) for code in codes]
    )
    return codes


def use_recovery_code(user: User, code: str) -> bool:
    """Spend one unused recovery code; False when it is unknown or already spent.

    Counted against the per-account limit like a TOTP code; raises ``MfaLockedOut``.
    """

    def check(locked: User) -> bool:
        if not _normalise(code):
            return False
        spent = MfaRecoveryCode.objects.filter(
            user=locked, code_hash=_hash(code), used_at__isnull=True
        ).update(used_at=timezone.now())
        return spent == 1

    return _attempt(user, check)


# ---------------------------------------------------------------- the sign-in challenge


@dataclass(frozen=True)
class Challenge:
    user: User
    challenge_id: str


def _attempts_key(challenge_id: str) -> str:
    return f"mfa-challenge:{challenge_id}"


def issue_challenge(user: User) -> str:
    """The ``mfa_token`` login returns in place of tokens, valid ``MFA_CHALLENGE_TTL_SECONDS``."""
    payload = {"sub": str(user.pk), "cid": secrets.token_urlsafe(16)}
    return signing.dumps(payload, salt=_CHALLENGE_SALT)


def _count_redemption(challenge_id: str) -> int:
    """Increment the challenge's counter and return the new value (atomic on Redis)."""
    key = _attempts_key(challenge_id)
    cache.add(key, 0, timeout=settings.MFA_CHALLENGE_TTL_SECONDS)
    try:
        return int(cache.incr(key))
    except ValueError:  # expired between the two calls
        cache.set(key, 1, timeout=settings.MFA_CHALLENGE_TTL_SECONDS)
        return 1


def redeem_challenge(token: str) -> Challenge:
    """The challenge's user, if it is genuine, current, not used up, and the user may sign in.

    Each call counts as one attempt on the challenge, before any code is checked, so parallel
    requests cannot all pass a read of the count. Raises ``MfaChallengeInvalid`` otherwise; one
    error for every reason, so the response tells a guesser nothing.
    """
    try:
        payload = signing.loads(
            token, salt=_CHALLENGE_SALT, max_age=settings.MFA_CHALLENGE_TTL_SECONDS
        )
        user_id = uuid.UUID(payload["sub"])
        challenge_id = str(payload["cid"])
    except (signing.BadSignature, KeyError, TypeError, ValueError) as exc:
        raise MfaChallengeInvalid() from exc
    if _count_redemption(challenge_id) > settings.MFA_CHALLENGE_MAX_ATTEMPTS:
        raise MfaChallengeInvalid()
    user = User.objects.filter(pk=user_id, deleted_at__isnull=True).first()
    if user is None or not user.mfa_enabled or not user_may_authenticate(user):
        raise MfaChallengeInvalid()
    return Challenge(user=user, challenge_id=challenge_id)


def close_challenge(challenge: Challenge) -> None:
    """A challenge signs in once."""
    cache.set(
        _attempts_key(challenge.challenge_id),
        settings.MFA_CHALLENGE_MAX_ATTEMPTS,
        timeout=settings.MFA_CHALLENGE_TTL_SECONDS,
    )
