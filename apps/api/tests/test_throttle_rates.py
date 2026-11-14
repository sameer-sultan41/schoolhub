"""The rate limits production runs (api-architecture.md §2.5).

`base.py` fixes them (production inherits that); only `config.settings.dev` reads
`THROTTLE_RATE_*` overrides, for the throwaway e2e-live stack. This pins the base values, so
an override can't become the shipped limit, and checks every throttle class reads its rate
from settings rather than a class attribute.
"""

from __future__ import annotations

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
    PublicFormThrottle,
    TenantRateThrottle,
    UserRateThrottle,
)

DEFAULT_RATES = {
    "tenant": "600/min",
    "user": "60/min",
    "anon": "20/min",
    "auth": "10/min",
    "public_form": "5/min",
    "ai": "10/min",
    "payment_callback": "600/min",
    "payment_callback_failure": "30/min",
    "password_reset_email": "5/hour",
    "password_reset_ip": "20/hour",
    "invitation_ip": "60/hour",
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
            AIRequestThrottle,
            PaymentCallbackThrottle,
            PaymentCallbackFailureThrottle,
            PasswordResetEmailThrottle,
            PasswordResetIPThrottle,
            InvitationIPThrottle,
        ):
            with self.subTest(throttle=throttle.__name__):
                self.assertNotIn("rate", vars(throttle))
                self.assertEqual(throttle().get_rate(), DEFAULT_RATES[throttle.scope])
