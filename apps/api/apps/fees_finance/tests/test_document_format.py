"""Document downloads: `?format=pdf|thermal` reaches the view; a guardian gets only theirs.

DRF reads `format` as its renderer override by default and 404s when no renderer
matches, so these pin `URL_FORMAT_OVERRIDE = None`. Rendering is stubbed: the
assertions are about routing and scope, not the PDF engine.
"""

from __future__ import annotations

from unittest import mock

from django.utils import timezone
from rest_framework import status

from apps.fees_finance.models import FeeVoucher, PaymentStatus, Receipt
from apps.fees_finance.tests.base import FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import (
    FeeInvoiceFactory,
    FeeVoucherFactory,
    PaymentFactory,
)
from apps.school_organization.tests.factories import authenticate, grant
from core.rbac.models import RecordScope
from core.rbac.registry import registry as permission_registry
from core.tenancy.context import tenant_context

PDF = b"%PDF-1.7 stub"


class DocumentsTestCase(FeesFinanceAPITestCase):
    """An issued voucher and a receipt for the guardian's child (``students[0]``)."""

    def setUp(self) -> None:
        super().setUp()
        self.voucher, self.receipt = self.documents_for(self.students[0], "1")

    def documents_for(self, student, suffix: str) -> tuple[FeeVoucher, Receipt]:
        """An issued voucher and a receipt on a new invoice of ``student``."""
        with tenant_context(self.tenant.id):
            invoice = FeeInvoiceFactory(
                tenant=self.tenant,
                student=student,
                academic_session=self.session,
                invoice_no=f"INV-FMT-{suffix}",
            )
            voucher = FeeVoucherFactory(tenant=self.tenant, fee_invoice=invoice, student=student)
            payment = PaymentFactory(
                tenant=self.tenant,
                fee_invoice=invoice,
                student=student,
                status=PaymentStatus.CONFIRMED,
                paid_at=timezone.now(),
            )
            receipt = Receipt.objects.create(
                tenant=self.tenant,
                payment=payment,
                receipt_no=f"RCP-FMT-{suffix}",
                amount=payment.amount,
            )
        return voucher, receipt


class DocumentFormatTests(DocumentsTestCase):
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


class GuardianDocumentScopeTests(DocumentsTestCase):
    """The seeded guardian role downloads its own child's slips, and another family's are 404."""

    def setUp(self) -> None:
        super().setUp()
        self.their_voucher, self.their_receipt = self.documents_for(self.students[1], "2")
        # The guardian role's real keys, flagged restricted as the seeded role is.
        grant(
            self.guardian_user,
            *permission_registry.keys_for_role("guardian"),
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )
        authenticate(self.client, self.guardian_user)

    def download(self, kind: str, pk) -> int:
        with (
            mock.patch("apps.fees_finance.views.documents.render_voucher", return_value=PDF),
            mock.patch("apps.fees_finance.views.documents.render_receipt", return_value=PDF),
        ):
            return self.client.get(f"/api/v1/{kind}/{pk}/download", {"format": "pdf"}).status_code

    def test_another_family_s_voucher_and_receipt_are_404(self) -> None:
        not_found = status.HTTP_404_NOT_FOUND
        self.assertEqual(self.download("vouchers", self.their_voucher.pk), not_found)
        self.assertEqual(self.download("receipts", self.their_receipt.pk), not_found)

    def test_their_own_child_s_voucher_and_receipt_download(self) -> None:
        self.assertEqual(self.download("vouchers", self.voucher.pk), status.HTTP_200_OK)
        self.assertEqual(self.download("receipts", self.receipt.pk), status.HTTP_200_OK)
