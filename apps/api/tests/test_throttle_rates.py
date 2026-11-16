"""The rate limits production runs (api-architecture.md §2.5).

`base.py` fixes them (production inherits that); only `config.settings.dev` reads
`THROTTLE_RATE_*` overrides, for the throwaway e2e-live stack. This pins the base values, so
an override can't become the shipped limit, and checks every throttle class reads its rate
from settings rather than a class attribute.
"""

from __future__ import annotations

import importlib
import sys
from unittest import mock

from cryptography.fernet import Fernet
from django.conf import settings
from django.test import SimpleTestCase

from core.api.throttling import (
    AIRequestThrottle,
    AuthEndpointThrottle,
    InvitationIPThrottle,
    PasswordResetEmailThrottle,
    PasswordResetIPThrottle,
    PaymentCallbackFailureThrottle,
    PaymentCallbackThrottle,
    PublicFileThrottle,
    PublicFormTenantThrottle,
    PublicFormThrottle,
    TenantRateThrottle,
    UserRateThrottle,
)
from core.rbac.machine import MachineClientThrottle

DEFAULT_RATES = {
    "tenant": "600/min",
    "user": "60/min",
    "anon": "20/min",
    "auth": "10/min",
    "public_form": "5/min",
    "public_form_tenant": "200/hour",
    "ai": "10/min",
    "payment_callback": "600/min",
    "payment_callback_failure": "30/min",
    "password_reset_email": "5/hour",
    "password_reset_ip": "20/hour",
    "invitation_ip": "60/hour",
    "machine_client": "1200/min",
    "public_file": "120/min",
}


class ThrottleRateTests(SimpleTestCase):
    def test_the_defaults_are_the_documented_limits(self) -> None:
        self.assertEqual(settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], DEFAULT_RATES)

    def test_every_throttle_reads_its_rate_from_settings(self) -> None:
        for throttle in (
            TenantRateThrottle,
            UserRateThrottle,
            AuthEndpointThrottle,
            PublicFormThrottle,
            PublicFormTenantThrottle,
            AIRequestThrottle,
            PaymentCallbackThrottle,
            PaymentCallbackFailureThrottle,
            PasswordResetEmailThrottle,
            PasswordResetIPThrottle,
            InvitationIPThrottle,
            MachineClientThrottle,
            PublicFileThrottle,
        ):
            with self.subTest(throttle=throttle.__name__):
                self.assertNotIn("rate", vars(throttle))
                self.assertEqual(throttle().get_rate(), DEFAULT_RATES[throttle.scope])


class NumProxiesWiringTests(SimpleTestCase):
    """`NUM_PROXIES` (env, base.py) reaches DRF, whose `get_ident` every per-IP throttle uses."""

    def test_drf_reads_the_num_proxies_setting(self) -> None:
        from rest_framework.settings import api_settings

        self.assertIn("NUM_PROXIES", settings.REST_FRAMEWORK)
        self.assertEqual(settings.REST_FRAMEWORK["NUM_PROXIES"], settings.NUM_PROXIES)
        self.assertEqual(api_settings.NUM_PROXIES, settings.NUM_PROXIES)

    def test_base_settings_pass_the_variable_through(self) -> None:
        from config.settings import base

        self.assertIs(base.REST_FRAMEWORK["NUM_PROXIES"], base.NUM_PROXIES)


class ProductionNumProxiesTests(SimpleTestCase):
    """`config.settings.prod` refuses to boot without `NUM_PROXIES` (0 = direct is allowed)."""

    def load_prod(self, **extra: str):
        from config.settings import base

        # django-environ reads `Env.ENVIRON`; swapping it keeps the test off `os.environ`.
        environ = {
            "INTEGRATIONS_ENCRYPTION_KEYS": Fernet.generate_key().decode(),
            "API_PUBLIC_URL": "https://api.example.com",
            **extra,
        }
        with mock.patch.object(base.env, "ENVIRON", environ):
            sys.modules.pop("config.settings.prod", None)
            try:
                return importlib.import_module("config.settings.prod")
            finally:
                sys.modules.pop("config.settings.prod", None)

    def test_missing_num_proxies_fails_at_import(self) -> None:
        from django.core.exceptions import ImproperlyConfigured

        with self.assertRaises(ImproperlyConfigured):
            self.load_prod()

    def test_zero_is_allowed_and_reaches_drf(self) -> None:
        prod = self.load_prod(NUM_PROXIES="0")

        self.assertEqual(prod.NUM_PROXIES, 0)
        self.assertEqual(prod.REST_FRAMEWORK["NUM_PROXIES"], 0)

    def test_negative_is_refused(self) -> None:
        from django.core.exceptions import ImproperlyConfigured

        with self.assertRaises(ImproperlyConfigured):
            self.load_prod(NUM_PROXIES="-1")
