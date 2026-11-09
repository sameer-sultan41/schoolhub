"""The collection screens' contract gaps: receipt-by-student, a payment's receipt id,
the refund requester, and the settlement upload's request shape.
"""

from __future__ import annotations

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status

from apps.fees_finance.models import PaymentStatus, Receipt, Refund, VoucherProvider
from apps.fees_finance.tests.base import FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import (
    CampusFactory,
    FeeInvoiceFactory,
    PaymentFactory,
    StudentFactory,
    TenantFactory,
    enable_feature,
)
from core.tenancy.context import tenant_context


class CollectionContractTestCase(FeesFinanceAPITestCase):
    def paid(self, student, suffix: str, *, receipt: bool = True):
        with tenant_context(self.tenant.id):
            invoice = FeeInvoiceFactory(
                tenant=self.tenant,
                student=student,
                academic_session=self.session,
                invoice_no=f"INV-CC-{suffix}",
            )
            payment = PaymentFactory(
                tenant=self.tenant,
                fee_invoice=invoice,
                student=student,
                status=PaymentStatus.CONFIRMED,
                paid_at=timezone.now(),
            )
            made = (
                Receipt.objects.create(
                    tenant=self.tenant,
                    payment=payment,
                    receipt_no=f"RCP-CC-{suffix}",
                    amount=payment.amount,
                )
                if receipt
                else None
            )
        return payment, made


class ReceiptStudentFilterTests(CollectionContractTestCase):
    def test_the_filter_returns_only_that_students_receipts(self) -> None:
        _, mine = self.paid(self.students[0], "1")
        self.paid(self.students[1], "2")

        response = self.client.get("/api/v1/receipts", {"student": str(self.students[0].pk)})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row["id"] for row in response.json()["data"]], [str(mine.pk)])

    def test_a_foreign_tenants_student_returns_nothing(self) -> None:
        self.paid(self.students[0], "1")
        other_tenant = TenantFactory()
        enable_feature(other_tenant, "module.fees_finance")
        with tenant_context(other_tenant.id):
            foreign = StudentFactory(tenant=other_tenant, campus=CampusFactory(tenant=other_tenant))

        response = self.client.get("/api/v1/receipts", {"student": str(foreign.pk)})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"], [])

    def test_the_list_query_count_does_not_grow_with_rows(self) -> None:
        self.paid(self.students[0], "1")
        with CaptureQueriesContext(connection) as one:
            self.client.get("/api/v1/receipts", {"student": str(self.students[0].pk)})
        for n in range(2, 5):
            self.paid(self.students[0], str(n))

        with self.assertNumQueries(len(one)):
            response = self.client.get("/api/v1/receipts", {"student": str(self.students[0].pk)})

        self.assertEqual(len(response.json()["data"]), 4)


class PaymentReceiptIdTests(CollectionContractTestCase):
    def test_a_payment_carries_its_receipt_id_or_null(self) -> None:
        with_receipt, receipt = self.paid(self.students[0], "1")
        without, _ = self.paid(self.students[1], "2", receipt=False)

        rows = {row["id"]: row for row in self.client.get("/api/v1/payments").json()["data"]}

        self.assertEqual(rows[str(with_receipt.pk)]["receipt"], str(receipt.pk))
        self.assertIsNone(rows[str(without.pk)]["receipt"])

    def test_the_list_query_count_does_not_grow_with_rows(self) -> None:
        self.paid(self.students[0], "1")
        with CaptureQueriesContext(connection) as one:
            self.client.get("/api/v1/payments")
        for n in range(2, 5):
            self.paid(self.students[0], str(n))

        with self.assertNumQueries(len(one)):
            response = self.client.get("/api/v1/payments")

        self.assertGreaterEqual(len(response.json()["data"]), 4)


class RefundRequesterTests(CollectionContractTestCase):
    def test_a_refund_exposes_who_requested_it(self) -> None:
        payment, _ = self.paid(self.students[0], "1")
        with tenant_context(self.tenant.id):
            refund = Refund.objects.create(
                tenant=self.tenant,
                payment=payment,
                student=payment.student,
                amount=payment.amount,
                reason="Duplicate",
                requested_by=self.user.pk,
            )

        response = self.client.get(f"/api/v1/refunds/{refund.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["requested_by"], str(self.user.pk))


class SettlementImportRequestTests(CollectionContractTestCase):
    def test_a_missing_file_is_refused_on_the_file_field(self) -> None:
        response = self.client.post(
            "/api/v1/voucher-collection-imports",
            {"provider": VoucherProvider.BANK_BRANCH},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("file", str(response.json()))

    def test_an_unknown_provider_is_refused_on_the_provider_field(self) -> None:
        response = self.client.post(
            "/api/v1/voucher-collection-imports",
            {"provider": "nope", "file": SimpleUploadedFile("s.csv", b"x", "text/csv")},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("provider", str(response.json()))
