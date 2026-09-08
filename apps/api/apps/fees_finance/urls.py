"""Routes for the fees-finance module — fees-finance.md §16.

Explicit `path()` entries come before `*router.urls` so a colon-action is not
swallowed by the router's detail pattern (`fee-structures/<pk>` matches
`<uuid>:activate` quite happily otherwise), matching every other module.

`:post-journal` is a *collection* colon-action rather than a detail one, because
the thing being created is a whole balanced posting rather than a change to one
entry. `LedgerEntryViewSet` has no create route for the same reason.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.fees_finance.views import (
    DiscountViewSet,
    FeeHeadViewSet,
    FeeInvoiceViewSet,
    FeeScheduleViewSet,
    FeeStructureViewSet,
    FeeVoucherViewSet,
    FineViewSet,
    LedgerAccountViewSet,
    LedgerEntryViewSet,
    PaymentViewSet,
    ReceiptViewSet,
    RefundViewSet,
    ScholarshipViewSet,
    VoucherCollectionImportViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("ledger-accounts", LedgerAccountViewSet, basename="ledger-accounts")
router.register("ledger-entries", LedgerEntryViewSet, basename="ledger-entries")
router.register("fee-heads", FeeHeadViewSet, basename="fee-heads")
router.register("fee-structures", FeeStructureViewSet, basename="fee-structures")
router.register("fee-schedules", FeeScheduleViewSet, basename="fee-schedules")
router.register("fee-invoices", FeeInvoiceViewSet, basename="fee-invoices")
router.register("discounts", DiscountViewSet, basename="discounts")
router.register("scholarships", ScholarshipViewSet, basename="scholarships")
router.register("fines", FineViewSet, basename="fines")
router.register("payments", PaymentViewSet, basename="payments")
router.register("receipts", ReceiptViewSet, basename="receipts")
router.register("refunds", RefundViewSet, basename="refunds")
router.register("vouchers", FeeVoucherViewSet, basename="vouchers")
router.register(
    "voucher-collection-imports",
    VoucherCollectionImportViewSet,
    basename="voucher-collection-imports",
)

urlpatterns = [
    path(
        "ledger-entries:post-journal",
        LedgerEntryViewSet.as_view({"post": "post_journal"}),
        name="ledger-entries-post-journal",
    ),
    path(
        "fee-structures/<uuid:pk>:activate",
        FeeStructureViewSet.as_view({"post": "activate"}),
        name="fee-structures-activate",
    ),
    path(
        "fee-structures/<uuid:pk>:archive",
        FeeStructureViewSet.as_view({"post": "archive"}),
        name="fee-structures-archive",
    ),
    path(
        "fee-invoices:generate",
        FeeInvoiceViewSet.as_view({"post": "generate"}),
        name="fee-invoices-generate",
    ),
    path(
        "fee-invoices/<uuid:pk>:cancel",
        FeeInvoiceViewSet.as_view({"post": "cancel"}),
        name="fee-invoices-cancel",
    ),
    path(
        "discounts/<uuid:pk>:revoke",
        DiscountViewSet.as_view({"post": "revoke"}),
        name="discounts-revoke",
    ),
    path(
        "fines/<uuid:pk>:waive",
        FineViewSet.as_view({"post": "waive"}),
        name="fines-waive",
    ),
    path(
        "payments:record",
        PaymentViewSet.as_view({"post": "record"}),
        name="payments-record",
    ),
    path(
        "receipts/<uuid:pk>/download",
        ReceiptViewSet.as_view({"get": "download"}),
        name="receipts-download",
    ),
    # `/refunds` as a collection colon-action rather than a plain POST: the
    # request carries a rule about the *payment* (its refundable remainder),
    # which is not a field on the refund being created.
    path(
        "refunds:create",
        RefundViewSet.as_view({"post": "request_refund"}),
        name="refunds-create",
    ),
    path(
        "refunds/<uuid:pk>:approve",
        RefundViewSet.as_view({"post": "approve"}),
        name="refunds-approve",
    ),
    path(
        "refunds/<uuid:pk>:reject",
        RefundViewSet.as_view({"post": "reject"}),
        name="refunds-reject",
    ),
    path(
        "refunds/<uuid:pk>:process",
        RefundViewSet.as_view({"post": "process"}),
        name="refunds-process",
    ),
    # Nested under the invoice, as §16 declares: a voucher is meaningless apart
    # from the invoice it collects, and its amount is that invoice's balance.
    path(
        "fee-invoices/<uuid:pk>/vouchers",
        FeeVoucherViewSet.as_view({"post": "issue"}),
        name="fee-invoices-vouchers",
    ),
    path(
        "vouchers/<uuid:pk>/download",
        FeeVoucherViewSet.as_view({"get": "download"}),
        name="vouchers-download",
    ),
    path(
        "vouchers/<uuid:pk>:void",
        FeeVoucherViewSet.as_view({"post": "void"}),
        name="vouchers-void",
    ),
    *router.urls,
]
