"""`?format=pdf|thermal` on a document download reaches the view (§16).

DRF reads `format` as its renderer override by default and 404s when no renderer
matches, so these pin `URL_FORMAT_OVERRIDE = None`. Rendering is stubbed: the
assertion is about routing, not the PDF engine.
"""

from __future__ import annotations

from unittest import mock

from django.utils import timezone
from rest_framework import status

from apps.fees_finance.models import PaymentStatus, Receipt
from apps.fees_finance.tests.base import FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import (
    FeeInvoiceFactory,
    FeeVoucherFactory,
    PaymentFactory,
)
from core.tenancy.context import tenant_context

PDF = b"%PDF-1.7 stub"


class DocumentFormatTests(FeesFinanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        student = self.students[0]
        with tenant_context(self.tenant.id):
            invoice = FeeInvoiceFactory(
                tenant=self.tenant,
                student=student,
                academic_session=self.session,
                invoice_no="INV-FMT-1",
            )
            self.voucher = FeeVoucherFactory(
                tenant=self.tenant, fee_invoice=invoice, student=student
            )
            payment = PaymentFactory(
                tenant=self.tenant,
                fee_invoice=invoice,
                student=student,
                status=PaymentStatus.CONFIRMED,
                paid_at=timezone.now(),
            )
            self.receipt = Receipt.objects.create(
                tenant=self.tenant, payment=payment, receipt_no="RCP-FMT-1", amount=payment.amount
            )

    def test_a_voucher_downloads_with_each_format(self) -> None:
        for fmt in ("pdf", "thermal"):
            with mock.patch("apps.fees_finance.views.documents.render_voucher", return_value=PDF):
                response = self.client.get(
                    f"/api/v1/vouchers/{self.voucher.pk}/download", {"format": fmt}
                )

            self.assertEqual(response.status_code, status.HTTP_200_OK, fmt)
            self.assertEqual(response["Content-Type"], "application/pdf")

    def test_a_receipt_downloads_with_each_format(self) -> None:
        for fmt in ("pdf", "thermal"):
            with mock.patch("apps.fees_finance.views.documents.render_receipt", return_value=PDF):
                response = self.client.get(
                    f"/api/v1/receipts/{self.receipt.pk}/download", {"format": fmt}
                )

            self.assertEqual(response.status_code, status.HTTP_200_OK, fmt)
            self.assertEqual(response["Content-Type"], "application/pdf")
