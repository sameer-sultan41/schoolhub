"""The school's own gateway account: credentials go in and never come out (ADR-0034).

SEC-13: merchant credentials are encrypted at rest, and the API shows only the
adapter's masked merchant id. Both halves are asserted against the stored row and
the wire, not against what the serializer is supposed to do.
"""

from __future__ import annotations

from django.core.cache import cache

from apps.fees_finance.models import PaymentGatewayAccount
from apps.fees_finance.tests.base import FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import UserFactory, authenticate, grant
from core.audit.models import AuditLog
from core.integrations import crypto
from core.tenancy.context import tenant_context

URL = "/api/v1/payment-gateway-accounts/current"
SECRET = "very-secret-signing-key"
CREDENTIALS = {"merchant_id": "MERCHANT-987654", "secret": SECRET}


class GatewayAccountTests(FeesFinanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        cache.clear()

    def _save(self, **body):
        payload = {"provider": "fake", "credentials": CREDENTIALS, "is_active": True, **body}
        return self.client.put(URL, payload, format="json")

    def test_credentials_are_write_only_and_masked(self) -> None:
        saved = self._save()
        fetched = self.client.get(URL)

        for response in (saved, fetched):
            with self.subTest(method=response.request["REQUEST_METHOD"]):
                self.assertEqual(response.status_code, 200, response.content)
                data = response.json()["data"]
                self.assertEqual(data["merchant_id_masked"], "****7654")
                self.assertNotIn("credentials", data)
                self.assertNotIn(SECRET, response.content.decode())
                # From API_PUBLIC_URL (test settings), never the request's Host.
                self.assertTrue(
                    data["callback_url"].startswith(
                        "https://api.schoolhub.test/api/v1/public/payment-callbacks/"
                        f"{self.tenant.slug}/"
                    ),
                    data["callback_url"],
                )

    def test_credentials_stored_encrypted(self) -> None:
        self._save()

        with tenant_context(self.tenant.id):
            account = PaymentGatewayAccount.objects.get()
        ciphertext = bytes(account.credentials_ciphertext)

        self.assertNotIn(SECRET.encode(), ciphertext)
        self.assertNotIn(b"MERCHANT-987654", ciphertext)
        self.assertEqual(crypto.decrypt(ciphertext), CREDENTIALS)

    def test_the_audit_trail_never_holds_the_credentials(self) -> None:
        self._save()

        logged = list(AuditLog.objects.filter(tenant=self.tenant).values_list("after", flat=True))
        self.assertTrue(logged)
        self.assertNotIn(SECRET, str(logged))

    def test_updating_without_credentials_keeps_them_and_the_callback_url(self) -> None:
        first = self._save().json()["data"]
        second = self.client.put(URL, {"provider": "fake", "is_active": False}, format="json")

        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(second.json()["data"]["callback_url"], first["callback_url"])
        self.assertFalse(second.json()["data"]["is_active"])
        with tenant_context(self.tenant.id):
            account = PaymentGatewayAccount.objects.get()
        self.assertEqual(crypto.decrypt(bytes(account.credentials_ciphertext)), CREDENTIALS)

    def test_a_new_account_needs_credentials(self) -> None:
        response = self.client.put(URL, {"provider": "fake", "is_active": True}, format="json")

        self.assertEqual(response.status_code, 422)

    def test_an_unknown_provider_is_refused(self) -> None:
        response = self._save(provider="no-such-provider")

        self.assertEqual(response.status_code, 422)

    def test_nothing_configured_reads_as_null(self) -> None:
        response = self.client.get(URL)

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["data"])

    def test_managing_the_gateway_needs_its_key(self) -> None:
        clerk = UserFactory(tenant=self.tenant)
        grant(clerk, "fees.invoice.view", "fees.payment.collect")
        authenticate(self.client, clerk)

        self.assertEqual(self.client.get(URL).status_code, 403)
        self.assertEqual(self._save().status_code, 403)
