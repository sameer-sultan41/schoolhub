"""The audit log takes its IP from `client_ip`, which follows `NUM_PROXIES`."""

from __future__ import annotations

from django.test import SimpleTestCase

from core.api.client_ip import client_ip
from core.audit import services


class AuditClientIpTests(SimpleTestCase):
    def test_audit_uses_the_shared_client_ip_derivation(self) -> None:
        self.assertIs(services.client_ip, client_ip)
