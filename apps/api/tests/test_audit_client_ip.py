"""The audit row's IP follows `NUM_PROXIES`, never the spoofable left-most `X-Forwarded-For`."""

from __future__ import annotations

from django.conf import settings
from django.test import RequestFactory, SimpleTestCase, override_settings

from core.audit.services import _client_ip


class AuditClientIpTests(SimpleTestCase):
    def request(self):
        return RequestFactory().get(
            "/", HTTP_X_FORWARDED_FOR="6.6.6.6, 10.0.0.9", REMOTE_ADDR="10.0.0.1"
        )

    def test_forwarded_for_ignored_without_proxies(self) -> None:
        self.assertEqual(_client_ip(self.request()), "10.0.0.1")

    @override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 1})
    def test_forwarded_for_trusted_only_as_far_as_num_proxies(self) -> None:
        self.assertEqual(_client_ip(self.request()), "10.0.0.9")
