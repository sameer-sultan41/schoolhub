"""Credential encryption: round trip, key rotation, and the unknown-key failure."""

from __future__ import annotations

from io import StringIO
from unittest import mock

from cryptography.fernet import Fernet
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings

from apps.school_organization.tests.factories import TenantFactory
from core.integrations import crypto
from core.tenancy.context import get_current_tenant_id

OLD_KEY = Fernet.generate_key().decode()
NEW_KEY = Fernet.generate_key().decode()
CREDENTIALS = {"merchant_id": "M-12345", "secret": "test-secret"}


class CryptoTests(SimpleTestCase):
    @override_settings(INTEGRATIONS_ENCRYPTION_KEYS=[OLD_KEY])
    def test_encrypt_round_trip(self) -> None:
        token = crypto.encrypt(CREDENTIALS)

        self.assertNotIn(b"test-secret", token)
        self.assertEqual(crypto.decrypt(token), CREDENTIALS)

    def test_rotation_decrypts_old_and_re_encrypts_new(self) -> None:
        with override_settings(INTEGRATIONS_ENCRYPTION_KEYS=[OLD_KEY]):
            old_token = crypto.encrypt(CREDENTIALS)

        with override_settings(INTEGRATIONS_ENCRYPTION_KEYS=[NEW_KEY, OLD_KEY]):
            self.assertEqual(crypto.decrypt(old_token), CREDENTIALS)
            new_token = crypto.rotate(old_token)

        # The old key can be dropped once every token is rotated.
        with override_settings(INTEGRATIONS_ENCRYPTION_KEYS=[NEW_KEY]):
            self.assertEqual(crypto.decrypt(new_token), CREDENTIALS)
        with (
            override_settings(INTEGRATIONS_ENCRYPTION_KEYS=[OLD_KEY]),
            self.assertRaises(crypto.DecryptionError),
        ):
            crypto.decrypt(new_token)

    def test_decrypt_with_unknown_key_raises(self) -> None:
        with override_settings(INTEGRATIONS_ENCRYPTION_KEYS=[OLD_KEY]):
            token = crypto.encrypt(CREDENTIALS)

        with (
            override_settings(INTEGRATIONS_ENCRYPTION_KEYS=[NEW_KEY]),
            self.assertRaises(crypto.DecryptionError),
        ):
            crypto.decrypt(token)


class RotateCommandTests(TestCase):
    def test_rotate_command_re_encrypts_every_tenant(self) -> None:
        first = TenantFactory()
        second = TenantFactory()
        bound: list = []

        def rotator() -> int:
            bound.append(get_current_tenant_id())
            return 1

        with mock.patch.object(crypto, "_ROTATORS", [rotator]):
            out = StringIO()
            call_command("rotate_integration_credentials", stdout=out)

        # Each tenant was visited once, with that tenant bound for the rotator.
        self.assertIn(first.pk, bound)
        self.assertIn(second.pk, bound)
        self.assertEqual(len(bound), len(set(bound)))
        self.assertIn(f"Rotated {len(bound)} credential(s)", out.getvalue())
