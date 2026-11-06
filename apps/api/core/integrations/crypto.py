"""Encryption of third-party credentials at rest (SEC-13).

Each school pays through its own merchant account, so SchoolHub stores that school's
gateway credentials. They are encrypted with ``MultiFernet`` over
``settings.INTEGRATIONS_ENCRYPTION_KEYS`` (comma-separated, newest first): the first key
encrypts, every key can decrypt, and ``rotate`` re-encrypts a token under the newest key.
That is Fernet's documented rotation mechanism: add a key at the front, re-encrypt, then
drop the old key.

Fernet has no associated data, so a ciphertext is not bound to a tenant; Row-Level
Security is the tenant boundary (ADR-0034). ``encrypt``/``decrypt`` are the seam a KMS
would replace.

``core`` never imports an app (ADR-0013), so the models that hold ciphertext register a
*rotator* from their ``AppConfig.ready``; ``rotate_integration_credentials`` calls each
one inside a bound tenant transaction.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

# Each rotator re-encrypts the current tenant's rows and returns how many it touched.
_ROTATORS: list[Callable[[], int]] = []


class DecryptionError(Exception):
    """The token was not produced by any configured key (or is corrupt)."""


def _fernet() -> MultiFernet:
    keys = settings.INTEGRATIONS_ENCRYPTION_KEYS
    if not keys:
        raise ImproperlyConfigured("INTEGRATIONS_ENCRYPTION_KEYS must hold at least one key.")
    return MultiFernet([Fernet(key) for key in keys])


def encrypt(data: dict[str, Any]) -> bytes:
    return _fernet().encrypt(json.dumps(data, sort_keys=True).encode("utf-8"))


def decrypt(token: bytes) -> dict[str, Any]:
    try:
        plaintext = _fernet().decrypt(bytes(token))
    except InvalidToken as exc:
        raise DecryptionError("Credentials cannot be decrypted with the configured keys.") from exc
    return json.loads(plaintext)


def rotate(token: bytes) -> bytes:
    """Re-encrypt ``token`` under the newest key."""
    try:
        return _fernet().rotate(bytes(token))
    except InvalidToken as exc:
        raise DecryptionError("Credentials cannot be decrypted with the configured keys.") from exc


def register_rotator(fn: Callable[[], int]) -> None:
    if fn not in _ROTATORS:
        _ROTATORS.append(fn)


def registered_rotators() -> list[Callable[[], int]]:
    return list(_ROTATORS)
