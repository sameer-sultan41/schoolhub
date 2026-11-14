"""`POST /fee-invoices/{id}:initiate-payment` and the rules a pending checkout imposes.

A guardian pays the invoice's whole *available* balance: what is due less any
checkout still pending. While one is pending the cashier is refused past it too,
so a family paying online and a cashier taking cash cannot both take the same
money. An abandoned checkout is failed after its TTL, by the sweep or by the
next initiation, whichever comes first.
"""

from __future__ import annotations

from decimal import Decimal
from unittest import mock

from django.test import override_settings
from rest_framework.test import APIClient

from apps.fees_finance import services, tasks
from apps.fees_finance.models import InvoiceStatus, Payment, PaymentMethod, PaymentStatus
from apps.fees_finance.tests.factories import (
    FeeInvoiceFactory,
    UserFactory,
    authenticate,
    disable_feature,
    jwt_only_client,
)
from apps.fees_finance.tests.online_base import ONLINE_FEATURE, OnlinePaymentsTestCase
from apps.school_organization.tests.factories import grant_default_role
from core.api.exceptions import DomainRuleViolation
from core.audit.models import AuditLog
from core.integrations.payments.base import GatewayUnavailable
from core.tenancy.context import tenant_context


class InitiateTests(OnlinePaymentsTestCase):
    def _counter(self, amount: str) -> Payment:
        with tenant_context(self.tenant.id):
            return services.record_payment(
                invoice=self.invoice,
                amount=Decimal(amount),
                method=PaymentMethod.CASH,
                reference_no=None,
                gateway_provider=None,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )

    def test_initiate_creates_pending_payment_for_available_balance(self) -> None:
        self._counter("400.00")

        response = self.initiate()

        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()["data"]
        with tenant_context(self.tenant.id):
            payment = Payment.objects.get(pk=data["payment_id"])
        self.assertEqual(payment.status, PaymentStatus.PENDING)
        self.assertEqual(payment.method, PaymentMethod.ONLINE_GATEWAY)
        self.assertEqual(payment.amount, Decimal("600.00"))
        self.assertEqual(payment.gateway_provider, "fake")
        self.assertIsNone(payment.received_by)
        self.assertRegex(payment.reference_no, services.ORDER_ID_PATTERN)
        self.assertEqual(
            data["redirect_url"], f"https://fake-gateway.invalid/pay/{payment.reference_no}"
        )
        # A pending checkout moves nothing.
        self.assertEqual(self.invoice_now().paid_total, Decimal("400.00"))

    def test_initiate_returns_stored_redirect_when_adapter_cannot_reinitiate(self) -> None:
        first = self.initiate(key="first").json()["data"]

        with mock.patch.object(self.adapter, "initiate") as initiate:
            second = self.initiate(key="second")

        self.assertEqual(second.status_code, 201, second.content)
        self.assertEqual(second.json()["data"], first)
        initiate.assert_not_called()
        with tenant_context(self.tenant.id):
            self.assertEqual(Payment.objects.count(), 1)

    def test_initiate_works_under_a_bearer_token_alone(self) -> None:
        """No session for `TenantMiddleware`: the action reads `request.tenant`, which the
        viewset binds after JWT authentication (agent-lessons L63)."""
        response = self.initiate(client=jwt_only_client(self.guardian_user))

        self.assertEqual(response.status_code, 201, response.content)

    def test_the_same_idempotency_key_returns_the_same_checkout(self) -> None:
        first = self.initiate(key="same").json()["data"]
        second = self.initiate(key="same")

        self.assertEqual(second.status_code, 201)
        self.assertEqual(second.json()["data"], first)

    def test_initiate_after_ttl_before_sweep_replaces_stale_pending(self) -> None:
        stale = self.pending_payment(key="first")
        self.age(stale, minutes=61)

        response = self.initiate(key="second")

        self.assertEqual(response.status_code, 201, response.content)
        self.assertNotEqual(response.json()["data"]["payment_id"], str(stale.pk))
        self.assertEqual(self.reload(stale).status, PaymentStatus.FAILED)

    def test_initiate_provider_error_fails_payment_and_is_503(self) -> None:
        with mock.patch.object(self.adapter, "initiate", side_effect=GatewayUnavailable("down")):
            response = self.initiate()

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "gateway_unavailable")
        with tenant_context(self.tenant.id):
            payment = Payment.objects.get()
        self.assertEqual(payment.status, PaymentStatus.FAILED)

    def test_initiate_without_account_is_409(self) -> None:
        with tenant_context(self.tenant.id):
            type(self.account).objects.filter(pk=self.account.pk).update(is_active=False)

        response = self.initiate()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "gateway_not_configured")

    def test_initiate_on_paid_invoice_is_409_nothing_due(self) -> None:
        self._counter("1000.00")

        response = self.initiate()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "nothing_due")

    def test_initiate_on_invoice_of_other_family_is_404(self) -> None:
        with tenant_context(self.tenant.id):
            theirs = FeeInvoiceFactory(
                tenant=self.tenant,
                student=self.students[1],
                academic_session=self.session,
                period_label="2026-09",
            )

        response = self.initiate(invoice=theirs)

        self.assertEqual(response.status_code, 404)

    def test_return_path_outside_portal_is_400(self) -> None:
        for path in ("https://evil.example/portal/", "//evil.example/portal/", "/dashboard"):
            with self.subTest(path=path):
                response = self.initiate(return_path=path, key=f"key-{len(path)}")
                self.assertEqual(response.status_code, 400)

    def test_initiate_requires_idempotency_key(self) -> None:
        response = self.initiate(key=None)

        self.assertEqual(response.status_code, 400)
        with tenant_context(self.tenant.id):
            self.assertFalse(Payment.objects.exists())

    def test_staff_cannot_initiate_for_guardian(self) -> None:
        accountant = UserFactory(tenant=self.tenant)
        grant_default_role(accountant, "accountant")
        client = APIClient()
        authenticate(client, accountant)

        response = self.initiate(client=client)

        self.assertEqual(response.status_code, 403)

    def test_flag_off_is_403(self) -> None:
        disable_feature(self.tenant, ONLINE_FEATURE)

        response = self.initiate()

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "module_disabled")


class PendingCheckoutRuleTests(OnlinePaymentsTestCase):
    def test_counter_payment_respects_pending_online(self) -> None:
        pending = self.pending_payment()

        response = self.client.post(
            "/api/v1/payments:record",
            {"fee_invoice": str(self.invoice.pk), "amount": "1000.00", "method": "cash"},
            format="json",
        )

        self.assertEqual(response.status_code, 422)
        error = response.json()["error"]
        self.assertEqual(error["details"][0]["field"], "amount")
        self.assertEqual(error["meta"]["pending_online_payment_id"], str(pending.pk))

    def test_confirm_failed_payment_refused_without_allow_failed(self) -> None:
        payment = self.pending_payment()
        with tenant_context(self.tenant.id):
            services.fail_payment(payment=payment, reason="test")
            with self.assertRaises(DomainRuleViolation):
                services.confirm_payment(
                    payment=payment, actor_id=self.user.pk, tenant_id=self.tenant.pk
                )

        self.assertEqual(self.reload(payment).status, PaymentStatus.FAILED)

    def test_fail_payment_never_undoes_a_confirmed_payment(self) -> None:
        payment = self.pending_payment()
        with tenant_context(self.tenant.id):
            services.confirm_payment(payment=payment, actor_id=None, tenant_id=self.tenant.pk)
            services.fail_payment(payment=payment, reason="late failure")

        self.assertEqual(self.reload(payment).status, PaymentStatus.CONFIRMED)

    def test_expire_sweep_fails_stale_pending_only(self) -> None:
        stale = self.pending_payment()
        self.age(stale, minutes=61)
        with tenant_context(self.tenant.id):
            other_invoice = FeeInvoiceFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                period_label="2026-10",
            )
        fresh = self.pending_payment(invoice=other_invoice, key="fresh")

        summary = tasks.expire_pending_online_payments()

        self.assertEqual(self.reload(stale).status, PaymentStatus.FAILED)
        self.assertEqual(self.reload(fresh).status, PaymentStatus.PENDING)
        self.assertGreaterEqual(summary["affected"], 1)


class ConcurrentInitiateTests(OnlinePaymentsTestCase):
    """Two requests for one invoice, and a provider outage, never strand or fail a checkout."""

    def _pending_without_checkout(self) -> Payment:
        """What another request leaves while its provider call is in flight."""
        with tenant_context(self.tenant.id):
            return Payment.objects.create(
                tenant=self.tenant,
                fee_invoice=self.invoice,
                student_id=self.invoice.student_id,
                amount=Decimal("1000.00"),
                method=PaymentMethod.ONLINE_GATEWAY,
                reference_no=f"SH-{self.invoice.invoice_no}-0a1b2c3d",
                gateway_provider="fake",
                gateway_account=self.account,
                status=PaymentStatus.PENDING,
                idempotency_key=f"{services.PAY_ONLINE_KEY_PREFIX}in-flight",
            )

    def test_a_pending_payment_with_no_checkout_yet_is_409_and_calls_no_provider(self) -> None:
        in_flight = self._pending_without_checkout()

        with mock.patch.object(self.adapter, "initiate") as initiate:
            response = self.initiate(key="second")

        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["error"]["code"], "checkout_in_progress")
        initiate.assert_not_called()
        self.assertEqual(self.reload(in_flight).status, PaymentStatus.PENDING)
        with tenant_context(self.tenant.id):
            self.assertEqual(Payment.objects.count(), 1)

    def test_the_same_key_while_its_checkout_is_starting_is_409(self) -> None:
        self._pending_without_checkout()

        with mock.patch.object(self.adapter, "initiate") as initiate:
            response = self.initiate(key="in-flight")

        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["error"]["code"], "checkout_in_progress")
        initiate.assert_not_called()

    def test_a_provider_error_never_fails_a_payment_this_request_did_not_create(self) -> None:
        first = self.pending_payment(key="first")

        with (
            mock.patch.object(self.adapter, "can_reinitiate", True),
            mock.patch.object(self.adapter, "initiate", side_effect=GatewayUnavailable("down")),
        ):
            response = self.initiate(key="second")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.reload(first).status, PaymentStatus.PENDING)

    def test_a_503_releases_the_key_so_the_same_key_starts_again(self) -> None:
        with mock.patch.object(self.adapter, "initiate", side_effect=GatewayUnavailable("down")):
            failed = self.initiate(key="retry-me")
        self.assertEqual(failed.status_code, 503)

        retried = self.initiate(key="retry-me")

        self.assertEqual(retried.status_code, 201, retried.content)
        with tenant_context(self.tenant.id):
            old = Payment.objects.get(status=PaymentStatus.FAILED)
            new = Payment.objects.get(pk=retried.json()["data"]["payment_id"])
        self.assertEqual(old.gateway_payload["failure_reason"], "gateway_unavailable")
        self.assertIsNone(old.idempotency_key)
        self.assertEqual(new.status, PaymentStatus.PENDING)
        self.assertEqual(new.idempotency_key, f"{services.PAY_ONLINE_KEY_PREFIX}retry-me")

    def test_only_the_request_that_created_the_payment_audits_it(self) -> None:
        payment = self.pending_payment(key="same")
        self.assertEqual(self.initiate(key="same").status_code, 201)
        self.assertEqual(self.initiate(key="other").status_code, 201)

        audits = AuditLog.objects.filter(
            tenant=self.tenant, action="create", resource_id=payment.pk
        )
        self.assertEqual(audits.count(), 1)

    @override_settings(API_PUBLIC_URL="https://api.schools.example/")
    def test_the_callback_url_comes_from_api_public_url_not_the_host_header(self) -> None:
        with mock.patch.object(self.adapter, "initiate", wraps=self.adapter.initiate) as initiate:
            response = self.guardian_client.post(
                f"/api/v1/fee-invoices/{self.invoice.pk}:initiate-payment",
                {"return_path": "/portal/fees"},
                format="json",
                HTTP_IDEMPOTENCY_KEY="host-header",
                HTTP_X_FORWARDED_HOST="evil.example",
            )

        self.assertEqual(response.status_code, 201, response.content)
        checkout = initiate.call_args.args[0]
        self.assertEqual(
            checkout.callback_url,
            "https://api.schools.example/api/v1/public/payment-callbacks/"
            f"{self.tenant.slug}/{self.account.callback_token}",
        )


class CancelDuringCheckoutTests(OnlinePaymentsTestCase):
    def cancel(self):
        return self.client.post(
            f"/api/v1/fee-invoices/{self.invoice.pk}:cancel",
            {"reason": "Billed twice"},
            format="json",
        )

    def test_cancel_is_refused_while_an_online_checkout_is_pending(self) -> None:
        pending = self.pending_payment()

        response = self.cancel()

        self.assertEqual(response.status_code, 409, response.content)
        error = response.json()["error"]
        self.assertEqual(error["code"], "pending_online_payment")
        self.assertIn(pending.reference_no, error["message"])
        self.assertEqual(error["meta"]["pending_online_payment_id"], str(pending.pk))
        self.assertNotEqual(self.invoice_now().status, InvoiceStatus.CANCELED)

    def test_cancel_goes_through_once_the_checkout_has_failed(self) -> None:
        pending = self.pending_payment()
        with tenant_context(self.tenant.id):
            services.fail_payment(payment=pending, reason="expired")

        response = self.cancel()

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.invoice_now().status, InvoiceStatus.CANCELED)
